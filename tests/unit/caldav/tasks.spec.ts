import ICAL from 'ical.js'
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import {
  createTask,
  deleteTask,
  fetchTasks,
  generateTaskICS,
  parseTask,
  priorityLevel,
  setTaskCompleted,
  setTaskCompletedICS,
  taskToFormData,
  updateTask
} from '../../../src/caldav/tasks'
import { ConflictError } from '../../../src/caldav/errors'
import { fetchCall, mockFetch, multistatus, respond } from './fetch-mock'
import type { TaskFormData } from '../../../src/types/task'

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAuthStore: () => ({ accessToken: 'test-token' }),
  useUserStore: () => ({ user: null as unknown })
}))

const LIST = '/caldav/alice/tasks/'
const HREF = `${LIST}task.ics`
const originalTZ = process.env.TZ

beforeAll(() => {
  process.env.TZ = 'Europe/Berlin'
})

afterAll(() => {
  process.env.TZ = originalTZ
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const ics = (...lines: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', ...lines, 'END:VCALENDAR'].join('\r\n')

const NEW_YORK = [
  'BEGIN:VTIMEZONE',
  'TZID:America/New_York',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'DTSTART:20070311T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'DTSTART:20071104T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE'
]

const TASK_ICS = ics(
  ...NEW_YORK,
  'BEGIN:VTODO',
  'UID:task-1',
  'DTSTAMP:20260101T000000Z',
  'SUMMARY:Write report',
  'DESCRIPTION:Quarterly numbers',
  'DUE;TZID=America/New_York:20260715T170000',
  'PRIORITY:3',
  'STATUS:IN-PROCESS',
  'PERCENT-COMPLETE:40',
  'CATEGORIES:Work,Finance',
  'CATEGORIES:Urgent',
  'X-CUSTOM-PROP;X-PARAM=1:keep me',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:Reminder',
  'TRIGGER:-PT15M',
  'END:VALARM',
  'END:VTODO'
)

function vtodoOf(icsData: string, index = 0): ICAL.Component {
  return new ICAL.Component(ICAL.parse(icsData)).getAllSubcomponents('vtodo')[index]
}

function form(overrides: Partial<TaskFormData> = {}): TaskFormData {
  return {
    calendarHref: LIST,
    summary: 'Buy milk',
    description: '',
    due: null,
    start: null,
    allDay: true,
    priority: 'none',
    status: 'NEEDS-ACTION',
    percentComplete: 0,
    categories: [],
    ...overrides
  }
}

describe('priorityLevel', () => {
  it('maps RFC 5545 priorities to levels', () => {
    expect([0, 1, 4, 5, 6, 9, 12].map(priorityLevel)).toEqual([
      'none',
      'high',
      'high',
      'medium',
      'low',
      'low',
      'none'
    ])
  })
})

describe('parseTask', () => {
  it('reads all task properties', () => {
    const task = parseTask(TASK_ICS, HREF, 'etag-1', LIST)!
    expect(task).toMatchObject({
      uid: 'task-1',
      href: HREF,
      etag: 'etag-1',
      calendarHref: LIST,
      summary: 'Write report',
      description: 'Quarterly numbers',
      allDay: false,
      priority: 3,
      status: 'IN-PROCESS',
      percentComplete: 40,
      categories: ['Work', 'Finance', 'Urgent'],
      isRecurring: false
    })
    // 17:00 EDT
    expect(task.due!.toISOString()).toBe('2026-07-15T21:00:00.000Z')
  })

  it('reads date-only due dates', () => {
    const task = parseTask(
      ics('BEGIN:VTODO', 'UID:t', 'SUMMARY:x', 'DUE;VALUE=DATE:20260301', 'END:VTODO'),
      HREF,
      'e',
      LIST
    )!
    expect(task.allDay).toBe(true)
    expect(task.due!.getDate()).toBe(1)
    expect(task.status).toBe('NEEDS-ACTION')
  })

  it('treats a COMPLETED timestamp without STATUS as completed', () => {
    const task = parseTask(
      ics('BEGIN:VTODO', 'UID:t', 'SUMMARY:x', 'COMPLETED:20260301T100000Z', 'END:VTODO'),
      HREF,
      'e',
      LIST
    )!
    expect(task.status).toBe('COMPLETED')
    expect(task.completed!.toISOString()).toBe('2026-03-01T10:00:00.000Z')
  })

  it('returns null for objects without a task', () => {
    expect(parseTask(ics('BEGIN:VEVENT', 'UID:e', 'END:VEVENT'), HREF, 'e', LIST)).toBeNull()
    expect(parseTask('garbage', HREF, 'e', LIST)).toBeNull()
  })
})

describe('generateTaskICS', () => {
  it('creates a task with TZID due date and VTIMEZONE', () => {
    const icsData = generateTaskICS(
      form({
        due: new Date('2026-03-30T08:00:00Z'),
        allDay: false,
        priority: 'high',
        categories: ['Home', ' '],
        description: 'Details'
      }),
      { uid: 'new-1' }
    )
    const calendar = new ICAL.Component(ICAL.parse(icsData))
    const components = calendar.getAllSubcomponents().map((c) => c.name)
    expect(components).toEqual(['vtimezone', 'vtodo'])

    const vtodo = calendar.getFirstSubcomponent('vtodo')!
    expect(vtodo.getFirstPropertyValue('uid')).toBe('new-1')
    expect(vtodo.getFirstProperty('due')!.getParameter('tzid')).toBe('Europe/Berlin')
    // 10:00 CEST
    expect(String(vtodo.getFirstPropertyValue('due'))).toBe('2026-03-30T10:00:00')
    expect(vtodo.getFirstPropertyValue('priority')).toBe(1)
    expect(vtodo.getFirstPropertyValue('status')).toBe('NEEDS-ACTION')
    expect(vtodo.getFirstProperty('categories')!.getValues()).toEqual(['Home'])
    expect(vtodo.hasProperty('dtstamp')).toBe(true)
    expect(vtodo.hasProperty('created')).toBe(true)
    expect(vtodo.hasProperty('dtstart')).toBe(false)

    const parsed = parseTask(icsData, HREF, 'e', LIST)!
    expect(parsed.due!.toISOString()).toBe('2026-03-30T08:00:00.000Z')
  })

  it('writes date-only values for all-day tasks', () => {
    const icsData = generateTaskICS(
      form({ due: new Date(2026, 2, 30), start: new Date(2026, 2, 28) })
    )
    const vtodo = vtodoOf(icsData)
    expect(vtodo.getFirstProperty('due')!.toICALString()).toBe('DUE;VALUE=DATE:20260330')
    expect(vtodo.getFirstProperty('dtstart')!.toICALString()).toBe('DTSTART;VALUE=DATE:20260328')
    expect(icsData).not.toContain('VTIMEZONE')
  })

  it('round-trips unknown properties, alarms and the original time zone', () => {
    const task = parseTask(TASK_ICS, HREF, 'etag-1', LIST)!
    const data = taskToFormData(task)
    expect(data).toMatchObject({ priority: 'high', status: 'IN-PROCESS', percentComplete: 40 })

    const icsData = generateTaskICS(
      { ...data, summary: 'Write the report' },
      {
        sourceICS: task.icsData
      }
    )
    const vtodo = vtodoOf(icsData)
    expect(vtodo.getFirstPropertyValue('summary')).toBe('Write the report')
    expect(vtodo.getFirstPropertyValue('x-custom-prop')).toBe('keep me')
    expect(vtodo.getFirstProperty('x-custom-prop')!.getParameter('x-param')).toBe('1')
    expect(vtodo.getFirstSubcomponent('valarm')).toBeTruthy()
    // the level didn't change, so the exact value is kept
    expect(vtodo.getFirstPropertyValue('priority')).toBe(3)
    expect(vtodo.getFirstProperty('due')!.getParameter('tzid')).toBe('America/New_York')
    expect(String(vtodo.getFirstPropertyValue('due'))).toBe('2026-07-15T17:00:00')
    expect(vtodo.getFirstProperty('categories')!.getValues()).toEqual(['Work', 'Finance', 'Urgent'])
    expect(vtodo.getAllProperties('categories')).toHaveLength(1)
    expect(icsData.match(/BEGIN:VTIMEZONE/g)).toHaveLength(1)

    expect(parseTask(icsData, HREF, 'e', LIST)!.due!.toISOString()).toBe('2026-07-15T21:00:00.000Z')
  })

  it('removes cleared fields', () => {
    const task = parseTask(TASK_ICS, HREF, 'etag-1', LIST)!
    const icsData = generateTaskICS(
      { ...taskToFormData(task), description: '', due: null, priority: 'none', categories: [] },
      { sourceICS: task.icsData }
    )
    const vtodo = vtodoOf(icsData)
    for (const name of ['description', 'due', 'priority', 'categories']) {
      expect(vtodo.hasProperty(name)).toBe(false)
    }
  })

  it('sets COMPLETED and PERCENT-COMPLETE with the status', () => {
    const task = parseTask(TASK_ICS, HREF, 'etag-1', LIST)!
    const completed = generateTaskICS(
      { ...taskToFormData(task), status: 'COMPLETED' },
      { sourceICS: task.icsData }
    )
    let vtodo = vtodoOf(completed)
    expect(vtodo.getFirstPropertyValue('status')).toBe('COMPLETED')
    expect(vtodo.getFirstPropertyValue('percent-complete')).toBe(100)
    expect(vtodo.getFirstPropertyValue('completed')).toBeInstanceOf(ICAL.Time)

    const reopened = setTaskCompletedICS(completed, false)
    vtodo = vtodoOf(reopened)
    expect(vtodo.getFirstPropertyValue('status')).toBe('NEEDS-ACTION')
    expect(vtodo.hasProperty('completed')).toBe(false)
    expect(vtodo.hasProperty('percent-complete')).toBe(false)
  })
})

describe('recurring tasks', () => {
  const RECURRING = ics(
    'BEGIN:VTODO',
    'UID:weekly',
    'SUMMARY:Take out trash',
    'DTSTART;TZID=Europe/Berlin:20260302T080000',
    'DUE;TZID=Europe/Berlin:20260302T090000',
    'RRULE:FREQ=WEEKLY;COUNT=3',
    'END:VTODO'
  )

  it('shows the first open occurrence and completes it through an override', () => {
    const task = parseTask(RECURRING, HREF, 'e', LIST)!
    expect(task.isRecurring).toBe(true)
    expect(task.due!.toISOString()).toBe('2026-03-02T08:00:00.000Z')

    const once = setTaskCompletedICS(task.icsData, true, task.occurrenceId)
    const override = vtodoOf(once, 1)
    expect(override.getFirstProperty('recurrence-id')!.toICALString()).toBe(
      'RECURRENCE-ID;TZID=Europe/Berlin:20260302T080000'
    )
    expect(override.getFirstPropertyValue('status')).toBe('COMPLETED')
    expect(override.hasProperty('rrule')).toBe(false)
    // the series is untouched
    expect(vtodoOf(once).getFirstPropertyValue('status')).toBeNull()

    const next = parseTask(once, HREF, 'e', LIST)!
    expect(next.status).toBe('NEEDS-ACTION')
    // the next week, after the DST change: still 09:00 local
    expect(next.due!.toISOString()).toBe('2026-03-09T08:00:00.000Z')
    expect(next.start!.toISOString()).toBe('2026-03-09T07:00:00.000Z')

    // editing uses the dates of the series
    expect(taskToFormData(next).due!.toISOString()).toBe('2026-03-02T08:00:00.000Z')

    const twice = setTaskCompletedICS(once, true, next.occurrenceId)
    const thrice = setTaskCompletedICS(twice, true, parseTask(twice, HREF, 'e', LIST)!.occurrenceId)
    const done = parseTask(thrice, HREF, 'e', LIST)!
    expect(done.status).toBe('COMPLETED')
    expect(done.occurrenceId).toBeUndefined()

    // reopening a finished series reopens its last occurrence
    const reopened = parseTask(setTaskCompletedICS(thrice, false), HREF, 'e', LIST)!
    expect(reopened.status).toBe('NEEDS-ACTION')
    expect(reopened.due!.toISOString()).toBe('2026-03-16T08:00:00.000Z')
  })

  it('shows a series completed on the master as completed', () => {
    const task = parseTask(
      RECURRING.replace('RRULE', 'STATUS:COMPLETED\r\nRRULE'),
      HREF,
      'e',
      LIST
    )!
    expect(task.status).toBe('COMPLETED')
  })
})

describe('network', () => {
  const REPORT = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/caldav/alice/other-path/task.ics</d:href>
    <d:propstat>
      <d:prop><d:getetag>"etag-1"</d:getetag><c:calendar-data>${TASK_ICS}</c:calendar-data></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`

  it('fetches tasks with a VTODO calendar-query', async () => {
    const fetchMock = mockFetch(multistatus(REPORT))
    const tasks = await fetchTasks(LIST)
    const { url, init } = fetchCall(fetchMock)
    expect(url).toBe(LIST)
    expect(init.method).toBe('REPORT')
    expect(init.body).toContain('<c:comp-filter name="VTODO"/>')
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ href: HREF, etag: 'etag-1', summary: 'Write report' })
  })

  it('creates tasks with If-None-Match', async () => {
    const fetchMock = mockFetch(respond({ status: 201, headers: { ETag: '"new"' } }))
    const task = await createTask(form())
    const { url, init } = fetchCall(fetchMock)
    expect(init.method).toBe('PUT')
    expect(new Headers(init.headers).get('If-None-Match')).toBe('*')
    expect(url).toBe(task.href)
    expect(task).toMatchObject({ etag: 'new', summary: 'Buy milk', calendarHref: LIST })
  })

  it('updates and completes tasks with If-Match', async () => {
    const task = parseTask(TASK_ICS, HREF, 'etag-1', LIST)!
    const fetchMock = mockFetch(
      respond({ status: 204, headers: { ETag: '"etag-2"' } }),
      respond({ status: 204, headers: { ETag: '"etag-3"' } })
    )
    const updated = await updateTask(task, { ...taskToFormData(task), summary: 'Changed' })
    expect(new Headers(fetchCall(fetchMock, 0).init.headers).get('If-Match')).toBe('"etag-1"')
    expect(updated).toMatchObject({ etag: 'etag-2', summary: 'Changed' })

    const completed = await setTaskCompleted(updated, true)
    expect(new Headers(fetchCall(fetchMock, 1).init.headers).get('If-Match')).toBe('"etag-2"')
    expect(completed).toMatchObject({ etag: 'etag-3', status: 'COMPLETED', percentComplete: 100 })
  })

  it('reports conflicts', async () => {
    const task = parseTask(TASK_ICS, HREF, 'etag-1', LIST)!
    mockFetch(respond({ status: 412 }))
    await expect(setTaskCompleted(task, true)).rejects.toBeInstanceOf(ConflictError)
  })

  it('deletes tasks with If-Match and ignores 404', async () => {
    const task = parseTask(TASK_ICS, HREF, 'etag-1', LIST)!
    const fetchMock = mockFetch(respond({ status: 204 }), respond({ status: 404 }))
    await deleteTask(task)
    expect(fetchCall(fetchMock).init.method).toBe('DELETE')
    expect(new Headers(fetchCall(fetchMock).init.headers).get('If-Match')).toBe('"etag-1"')
    await expect(deleteTask(task)).resolves.toBeUndefined()
  })
})
