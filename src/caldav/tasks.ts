import ICAL from 'ical.js'
import { CalDAVError, AuthenticationError, NotFoundError, ConflictError } from './errors'
import { buildTaskQuery } from './xml-builder'
import { parseEvents } from './xml-parser'
import { authenticatedFetch } from './auth'
import {
  addTimeProperty,
  collectReferencedTimezones,
  findVTimezone,
  getLocalTimezone,
  isUTCTimezone,
  registerKnownTimezone,
  registerTimezones,
  resolveWriteTimezone,
  toZonedTime,
  type WriteTimezone
} from './timezone'
import type { Task, TaskFormData, TaskPriority, TaskStatus } from '../types/task'

/**
 * Tasks (VTODO, RFC 5545 3.6.2) on CalDAV collections that support them.
 *
 * Writing modifies the parsed source object in place, so properties and components the app
 * doesn't know (alarms, X- properties, RELATED-TO, …) survive a round-trip.
 *
 * Recurring tasks: the list shows the first occurrence that hasn't been completed or cancelled
 * by an override (a VTODO with RECURRENCE-ID, as written by e.g. Thunderbird). Completing it adds
 * such an override; editing always changes the whole series.
 */

const STATUSES: TaskStatus[] = ['NEEDS-ACTION', 'IN-PROCESS', 'COMPLETED', 'CANCELLED']
/** Upper bound for the occurrences searched for the next open one */
const MAX_OCCURRENCES = 1000

// ---------------------------------------------------------------------------------------------
// Priority and status helpers
// ---------------------------------------------------------------------------------------------

export function priorityLevel(priority: number): TaskPriority {
  if (!priority || priority < 1 || priority > 9) return 'none'
  if (priority < 5) return 'high'
  if (priority === 5) return 'medium'
  return 'low'
}

const PRIORITY_VALUES: Record<TaskPriority, number> = { none: 0, high: 1, medium: 5, low: 9 }

export function priorityValue(level: TaskPriority): number {
  return PRIORITY_VALUES[level]
}

export function isTaskDone(task: Pick<Task, 'status'>): boolean {
  return task.status === 'COMPLETED' || task.status === 'CANCELLED'
}

function readStatus(component: ICAL.Component): TaskStatus {
  const value = String(component.getFirstPropertyValue('status') ?? '').toUpperCase()
  if ((STATUSES as string[]).includes(value)) return value as TaskStatus
  // Some clients only set COMPLETED
  return component.hasProperty('completed') ? 'COMPLETED' : 'NEEDS-ACTION'
}

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

function parseCalendar(icsData: string): ICAL.Component {
  const calendar = new ICAL.Component(ICAL.parse(icsData))
  // Must happen before any time value is read, so TZIDs resolve to their zone
  registerTimezones(calendar)
  for (const tzid of collectReferencedTimezones(calendar.getAllSubcomponents('vtodo'))) {
    if (!ICAL.TimezoneService.has(tzid) && !findVTimezone(calendar, tzid)) {
      registerKnownTimezone(tzid)
    }
  }
  return calendar
}

function getTime(component: ICAL.Component, name: string): ICAL.Time | undefined {
  const value = component.getFirstPropertyValue(name)
  return value instanceof ICAL.Time ? value : undefined
}

function getTzid(component: ICAL.Component): string | null {
  for (const name of ['dtstart', 'due']) {
    const tzid = component.getFirstProperty(name)?.getParameter('tzid')
    if (typeof tzid === 'string' && tzid) return tzid
  }
  return null
}

function findMaster(calendar: ICAL.Component): ICAL.Component | null {
  const vtodos = calendar.getAllSubcomponents('vtodo')
  return vtodos.find((v) => !v.hasProperty('recurrence-id')) ?? vtodos[0] ?? null
}

function isRecurringMaster(master: ICAL.Component): boolean {
  return master.hasProperty('rrule') || master.hasProperty('rdate')
}

function findOverride(calendar: ICAL.Component, occurrence: ICAL.Time): ICAL.Component | null {
  const time = occurrence.toUnixTime()
  return (
    calendar
      .getAllSubcomponents('vtodo')
      .find((v) => getTime(v, 'recurrence-id')?.toUnixTime() === time) ?? null
  )
}

interface Occurrence {
  recurrenceId: ICAL.Time
  start?: ICAL.Time
  due?: ICAL.Time
  override: ICAL.Component | null
}

/**
 * The first occurrence of a recurring task that isn't completed or cancelled by an override,
 * null if all occurrences are done.
 */
function findOpenOccurrence(calendar: ICAL.Component, master: ICAL.Component): Occurrence | null {
  const start = getTime(master, 'dtstart')
  const due = getTime(master, 'due')
  const base = start ?? due
  if (!base) return null
  const duration = start && due ? due.subtractDate(start) : null

  const expansion = new ICAL.RecurExpansion({ component: master, dtstart: base })
  for (let i = 0; i < MAX_OCCURRENCES; i++) {
    const next = expansion.next()
    if (!next) return null
    const override = findOverride(calendar, next)
    if (override && isTaskDone({ status: readStatus(override) })) continue

    let occurrenceDue: ICAL.Time | undefined
    if (start && due && duration) {
      occurrenceDue = next.clone()
      occurrenceDue.addDuration(duration)
    }
    return {
      recurrenceId: next,
      start: start ? next : undefined,
      due: start ? occurrenceDue : next,
      override
    }
  }
  return null
}

function toTask(
  component: ICAL.Component,
  meta: { href: string; etag: string; calendarHref: string; icsData: string },
  overrides: Partial<Task> = {}
): Task {
  const start = getTime(component, 'dtstart')
  const due = getTime(component, 'due')
  const completed = getTime(component, 'completed')
  const description = component.getFirstPropertyValue('description')
  const percent = Number(component.getFirstPropertyValue('percent-complete') ?? 0)
  return {
    uid: String(component.getFirstPropertyValue('uid') ?? ''),
    calendarHref: meta.calendarHref,
    href: meta.href,
    etag: meta.etag,
    summary: String(component.getFirstPropertyValue('summary') ?? ''),
    description: description ? String(description) : undefined,
    due: due?.toJSDate(),
    start: start?.toJSDate(),
    allDay: !!(due ?? start)?.isDate,
    priority: Number(component.getFirstPropertyValue('priority') ?? 0) || 0,
    status: readStatus(component),
    percentComplete: Number.isFinite(percent) ? percent : 0,
    completed: completed?.toJSDate(),
    categories: component
      .getAllProperties('categories')
      .flatMap((p) => p.getValues().map(String))
      .filter(Boolean),
    isRecurring: false,
    icsData: meta.icsData,
    ...overrides
  }
}

/**
 * Parses the VTODO of a calendar object resource. Returns null if it contains no task.
 */
export function parseTask(
  icsData: string,
  href: string,
  etag: string,
  calendarHref: string
): Task | null {
  let calendar: ICAL.Component
  try {
    calendar = parseCalendar(icsData)
  } catch (e) {
    console.warn(`Failed to parse task ${href}:`, e)
    return null
  }
  const master = findMaster(calendar)
  if (!master) return null
  const meta = { href, etag, calendarHref, icsData }

  if (!isRecurringMaster(master)) {
    return toTask(master, meta)
  }
  if (isTaskDone({ status: readStatus(master) })) {
    // The whole series was completed or cancelled
    return toTask(master, meta, { isRecurring: true })
  }

  const occurrence = findOpenOccurrence(calendar, master)
  if (!occurrence) {
    // All occurrences are done, show the series as completed
    const lastCompleted = calendar
      .getAllSubcomponents('vtodo')
      .map((v) => getTime(v, 'completed'))
      .filter((t): t is ICAL.Time => !!t)
      .sort((a, b) => a.compare(b))
      .pop()
    return toTask(master, meta, {
      isRecurring: true,
      status: readStatus(master) === 'CANCELLED' ? 'CANCELLED' : 'COMPLETED',
      completed: lastCompleted?.toJSDate() ?? getTime(master, 'completed')?.toJSDate()
    })
  }

  const recurrenceId = occurrence.recurrenceId.toString()
  if (occurrence.override) {
    return toTask(occurrence.override, meta, { isRecurring: true, occurrenceId: recurrenceId })
  }
  return toTask(master, meta, {
    isRecurring: true,
    occurrenceId: recurrenceId,
    start: occurrence.start?.toJSDate(),
    due: occurrence.due?.toJSDate()
  })
}

/**
 * The form data of a task. For recurring tasks the dates are those of the series (the master
 * component), since edits apply to the whole series.
 */
export function taskToFormData(task: Task): TaskFormData {
  let source: Task = task
  if (task.isRecurring) {
    try {
      const master = findMaster(parseCalendar(task.icsData))
      if (master) {
        source = toTask(master, task)
      }
    } catch {
      // keep the occurrence values
    }
  }
  return {
    calendarHref: task.calendarHref,
    summary: source.summary,
    description: source.description ?? '',
    due: source.due ?? null,
    start: source.start ?? null,
    allDay: source.allDay,
    priority: priorityLevel(source.priority),
    status: source.status,
    percentComplete: source.percentComplete,
    categories: [...source.categories]
  }
}

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

function toDateValue(date: Date): ICAL.Time {
  return ICAL.Time.fromData({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    isDate: true
  })
}

function utcNow(): ICAL.Time {
  return ICAL.Time.fromJSDate(new Date(), true)
}

/**
 * Zone date-time values are written in: the TZID the task already uses, else the browser's.
 * Null for UTC.
 */
function resolveTaskTimezone(
  preferredTzid: string | null,
  date: Date,
  calendar: ICAL.Component
): WriteTimezone | null {
  const fromYear = date.getUTCFullYear() - 1
  if (preferredTzid) {
    if (isUTCTimezone(preferredTzid)) return null
    const preferred = resolveWriteTimezone(preferredTzid, fromYear, calendar)
    if (preferred) return preferred
  }
  return resolveWriteTimezone(getLocalTimezone(), fromYear, calendar)
}

/** Adds the VTIMEZONE unless present, in front of the other components */
function ensureTaskVTimezone(calendar: ICAL.Component, timezone: WriteTimezone): void {
  if (findVTimezone(calendar, timezone.tzid)) return
  const others = calendar.getAllSubcomponents().filter((c) => c.name !== 'vtimezone')
  for (const component of others) calendar.removeSubcomponent(component)
  calendar.addSubcomponent(timezone.vtimezone)
  for (const component of others) calendar.addSubcomponent(component)
}

function setText(component: ICAL.Component, name: string, value: string | undefined): void {
  if (value) {
    component.updatePropertyWithValue(name, value)
  } else {
    component.removeAllProperties(name)
  }
}

function setDates(
  calendar: ICAL.Component,
  component: ICAL.Component,
  data: Pick<TaskFormData, 'due' | 'start' | 'allDay'>
): void {
  const preferredTzid = getTzid(component)
  component.removeAllProperties('dtstart')
  component.removeAllProperties('due')
  const dates = [
    ['dtstart', data.start],
    ['due', data.due]
  ] as const
  const first = data.start ?? data.due
  if (!first) return

  if (data.allDay) {
    for (const [name, date] of dates) {
      if (date) addTimeProperty(component, name, toDateValue(date), null)
    }
    return
  }

  const timezone = resolveTaskTimezone(preferredTzid, first, calendar)
  if (timezone) ensureTaskVTimezone(calendar, timezone)
  const tzid = timezone?.tzid ?? null
  for (const [name, date] of dates) {
    if (date) addTimeProperty(component, name, toZonedTime(date, timezone), tzid)
  }
}

/** Sets STATUS and keeps COMPLETED / PERCENT-COMPLETE consistent with it */
function applyStatus(component: ICAL.Component, status: TaskStatus, percentComplete?: number) {
  component.updatePropertyWithValue('status', status)
  if (status === 'COMPLETED') {
    if (!component.hasProperty('completed')) {
      component.updatePropertyWithValue('completed', utcNow())
    }
    component.updatePropertyWithValue('percent-complete', 100)
    return
  }

  component.removeAllProperties('completed')
  let percent = percentComplete ?? Number(component.getFirstPropertyValue('percent-complete') ?? 0)
  if (percent >= 100) percent = 0
  if (percent > 0) {
    component.updatePropertyWithValue('percent-complete', Math.round(percent))
  } else {
    component.removeAllProperties('percent-complete')
  }
}

function touch(component: ICAL.Component, isUpdate: boolean): void {
  const now = utcNow()
  component.updatePropertyWithValue('dtstamp', now)
  component.updatePropertyWithValue('last-modified', now)
  if (isUpdate && component.hasProperty('sequence')) {
    component.updatePropertyWithValue(
      'sequence',
      Number(component.getFirstPropertyValue('sequence') ?? 0) + 1
    )
  }
}

function applyFormData(calendar: ICAL.Component, vtodo: ICAL.Component, data: TaskFormData): void {
  vtodo.updatePropertyWithValue('summary', data.summary)
  setText(vtodo, 'description', data.description.trim())
  setDates(calendar, vtodo, data)

  // Keep the exact value if the level didn't change (e.g. PRIORITY:3 stays 3)
  const currentPriority = Number(vtodo.getFirstPropertyValue('priority') ?? 0) || 0
  if (priorityLevel(currentPriority) !== data.priority) {
    if (data.priority === 'none') {
      vtodo.removeAllProperties('priority')
    } else {
      vtodo.updatePropertyWithValue('priority', priorityValue(data.priority))
    }
  }

  applyStatus(vtodo, data.status, data.percentComplete)

  vtodo.removeAllProperties('categories')
  const categories = data.categories.map((c) => c.trim()).filter(Boolean)
  if (categories.length) {
    const prop = new ICAL.Property('categories', vtodo)
    prop.setValues(categories)
    vtodo.addProperty(prop)
  }
}

/**
 * Generates the ICS of a task. With `sourceICS` the existing object is updated (the master
 * component for recurring tasks) and everything else in it is kept.
 */
export function generateTaskICS(
  data: TaskFormData,
  options: { uid?: string; sourceICS?: string } = {}
): string {
  if (options.sourceICS) {
    const calendar = parseCalendar(options.sourceICS)
    const vtodo = findMaster(calendar)
    if (!vtodo) throw new Error('No task found')
    applyFormData(calendar, vtodo, data)
    touch(vtodo, true)
    return calendar.toString()
  }

  const calendar = new ICAL.Component(['vcalendar', [], []])
  calendar.updatePropertyWithValue('version', '2.0')
  calendar.updatePropertyWithValue('prodid', '-//OpenCloud//Calendar//EN')
  const vtodo = new ICAL.Component('vtodo')
  vtodo.addPropertyWithValue('uid', options.uid ?? generateTaskUID())
  vtodo.addPropertyWithValue('created', utcNow())
  calendar.addSubcomponent(vtodo)
  applyFormData(calendar, vtodo, data)
  touch(vtodo, false)
  return calendar.toString()
}

/**
 * Completes or reopens a task. For a recurring task with `occurrenceId` only that occurrence is
 * changed, through an override component with RECURRENCE-ID.
 */
export function setTaskCompletedICS(
  icsData: string,
  completed: boolean,
  occurrenceId?: string
): string {
  const calendar = parseCalendar(icsData)
  const master = findMaster(calendar)
  if (!master) throw new Error('No task found')

  let target = master
  if (occurrenceId) {
    const baseProp = master.getFirstProperty('dtstart') ?? master.getFirstProperty('due')
    const base = baseProp?.getFirstValue()
    if (!(base instanceof ICAL.Time)) throw new Error('Recurring task without DTSTART or DUE')
    const tzid = (baseProp?.getParameter('tzid') as string | undefined) || null
    const parsed = ICAL.Time.fromString(occurrenceId, null)
    const zone = parsed.zone === ICAL.Timezone.utcTimezone ? parsed.zone : base.zone
    const recurrenceId = ICAL.Time.fromData(
      {
        year: parsed.year,
        month: parsed.month,
        day: parsed.day,
        hour: parsed.hour,
        minute: parsed.minute,
        second: parsed.second,
        isDate: parsed.isDate
      },
      zone
    )
    target =
      findOverride(calendar, recurrenceId) ??
      createOverride(calendar, master, recurrenceId, zone === base.zone ? tzid : null)
  } else if (
    !completed &&
    isRecurringMaster(master) &&
    !isTaskDone({ status: readStatus(master) })
  ) {
    // All occurrences are done: reopen the last one
    const last = calendar
      .getAllSubcomponents('vtodo')
      .filter((v) => v.hasProperty('recurrence-id') && isTaskDone({ status: readStatus(v) }))
      .sort((a, b) => getTime(a, 'recurrence-id')!.compare(getTime(b, 'recurrence-id')!))
      .pop()
    if (last) target = last
  }

  applyStatus(target, completed ? 'COMPLETED' : 'NEEDS-ACTION')
  touch(target, true)
  return calendar.toString()
}

function createOverride(
  calendar: ICAL.Component,
  master: ICAL.Component,
  recurrenceId: ICAL.Time,
  tzid: string | null
): ICAL.Component {
  const override = new ICAL.Component(structuredClone(master.jCal))
  for (const name of ['rrule', 'rdate', 'exdate', 'recurrence-id', 'completed']) {
    override.removeAllProperties(name)
  }
  // The dates of the occurrence
  const start = getTime(master, 'dtstart')
  const due = getTime(master, 'due')
  if (start) {
    override.removeAllProperties('dtstart')
    addTimeProperty(override, 'dtstart', recurrenceId.clone(), tzid)
    if (due) {
      const occurrenceDue = recurrenceId.clone()
      occurrenceDue.addDuration(due.subtractDate(start))
      override.removeAllProperties('due')
      addTimeProperty(override, 'due', occurrenceDue, tzid)
    }
  } else if (due) {
    override.removeAllProperties('due')
    addTimeProperty(override, 'due', recurrenceId.clone(), tzid)
  }
  addTimeProperty(override, 'recurrence-id', recurrenceId.clone(), tzid)
  calendar.addSubcomponent(override)
  return override
}

export function generateTaskUID(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${timestamp}-${random}@opencloud`
}

// ---------------------------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------------------------

function joinHref(calendarHref: string, name: string): string {
  return calendarHref.endsWith('/') ? `${calendarHref}${name}` : `${calendarHref}/${name}`
}

function readEtag(response: Response, fallback = ''): string {
  return response.headers.get('ETag')?.replace(/"/g, '') || fallback
}

function checkResponse(response: Response, action: string, etag?: string): void {
  if (response.status === 401) throw new AuthenticationError()
  if (response.status === 404) throw new NotFoundError('Task not found')
  if (response.status === 412) {
    throw new ConflictError('Task was modified by another client', etag)
  }
  if (!response.ok) {
    throw new CalDAVError(`Failed to ${action}: ${response.statusText}`, response.status)
  }
}

export async function fetchTasks(calendarHref: string): Promise<Task[]> {
  const response = await authenticatedFetch(calendarHref, {
    method: 'REPORT',
    headers: { 'Content-Type': 'application/xml; charset=utf-8', Depth: '1' },
    body: buildTaskQuery()
  })
  if (response.status !== 207) checkResponse(response, 'load tasks')

  const tasks: Task[] = []
  for (const data of parseEvents(await response.text())) {
    // Use the requested collection path, so mapped (shared) paths are kept
    const href = joinHref(calendarHref, data.href.substring(data.href.lastIndexOf('/') + 1))
    const task = parseTask(data.calendarData, href, data.etag, calendarHref)
    if (task) tasks.push(task)
  }
  return tasks
}

function put(href: string, icsData: string, headers: Record<string, string>) {
  return authenticatedFetch(href, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', ...headers },
    body: icsData
  })
}

function reparse(task: Task, icsData: string, etag: string): Task {
  return parseTask(icsData, task.href, etag, task.calendarHref) ?? { ...task, etag, icsData }
}

export async function createTask(data: TaskFormData): Promise<Task> {
  const uid = generateTaskUID()
  const icsData = generateTaskICS(data, { uid })
  const href = joinHref(data.calendarHref, `${encodeURIComponent(uid)}.ics`)
  const response = await put(href, icsData, { 'If-None-Match': '*' })
  if (response.status === 412) throw new ConflictError('Task already exists')
  checkResponse(response, 'create task')
  const etag = readEtag(response)
  return parseTask(icsData, href, etag, data.calendarHref)!
}

async function putUpdate(task: Task, icsData: string, action: string): Promise<Task> {
  const response = await put(task.href, icsData, { 'If-Match': `"${task.etag}"` })
  checkResponse(response, action, task.etag)
  // Without an ETag in the response the next update fails with 412 and needs a reload
  return reparse(task, icsData, readEtag(response, task.etag))
}

export function updateTask(task: Task, data: TaskFormData): Promise<Task> {
  return putUpdate(task, generateTaskICS(data, { sourceICS: task.icsData }), 'update task')
}

export function setTaskCompleted(task: Task, completed: boolean): Promise<Task> {
  const occurrenceId = completed ? task.occurrenceId : undefined
  return putUpdate(
    task,
    setTaskCompletedICS(task.icsData, completed, occurrenceId),
    completed ? 'complete task' : 'reopen task'
  )
}

export async function deleteTask(task: Task): Promise<void> {
  const response = await authenticatedFetch(task.href, {
    method: 'DELETE',
    headers: { 'If-Match': `"${task.etag}"` }
  })
  // Already deleted
  if (response.status === 404) return
  checkResponse(response, 'delete task', task.etag)
}
