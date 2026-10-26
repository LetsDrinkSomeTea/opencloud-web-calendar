import ICAL from 'ical.js'

/**
 * Time zone support for the CalDAV/ICS layer.
 *
 * ical.js does not ship time zone data, so VTIMEZONE components are generated from the
 * browser's Intl time zone database: the UTC offset of the zone is probed over a range of
 * years, the transitions are located and turned into STANDARD/DAYLIGHT observances. Recent
 * transitions that follow a yearly pattern are emitted as an RRULE without end, so the
 * definition stays valid for recurring events far in the future.
 */

const UTC_ZONES = new Set([
  'UTC',
  'UCT',
  'GMT',
  'GMT0',
  'Zulu',
  'Universal',
  'Greenwich',
  'Etc/UTC',
  'Etc/UCT',
  'Etc/GMT',
  'Etc/GMT0',
  'Etc/GMT+0',
  'Etc/GMT-0',
  'Etc/Zulu',
  'Etc/Universal',
  'Etc/Greenwich'
])

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const DAY_MS = 86400000
const PROBE_STEP_MS = 7 * DAY_MS
/** Years after the current year that are probed to detect the ongoing yearly rule */
const FUTURE_YEARS = 10
/** Earliest year covered by time zones registered for parsing */
const REGISTRY_START_YEAR = 1970

interface Transition {
  /** UTC timestamp (ms) of the first instant with the new offset */
  at: number
  /** Offset in seconds before the transition */
  from: number
  /** Offset in seconds after the transition */
  to: number
}

interface LocalStart {
  year: number
  month: number
  day: number
  weekday: number
  hour: number
  minute: number
  second: number
}

const formatterCache = new Map<string, Intl.DateTimeFormat | null>()
const transitionCache = new Map<string, Transition[]>()
const vtimezoneCache = new Map<string, ICAL.Component>()

/**
 * The IANA time zone of the browser, e.g. `Europe/Berlin`. Falls back to `UTC`.
 */
export function getLocalTimezone(): string {
  try {
    const tzid = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (tzid) return tzid
  } catch {
    // ignore, use UTC
  }
  return 'UTC'
}

export function isUTCTimezone(tzid: string): boolean {
  return UTC_ZONES.has(tzid)
}

/**
 * Whether the browser's Intl database knows the given time zone id.
 */
export function isKnownTimezone(tzid: string): boolean {
  return getFormatter(tzid) !== null
}

function getFormatter(tzid: string): Intl.DateTimeFormat | null {
  if (formatterCache.has(tzid)) return formatterCache.get(tzid)!
  let formatter: Intl.DateTimeFormat | null = null
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tzid,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  } catch {
    formatter = null
  }
  formatterCache.set(tzid, formatter)
  return formatter
}

/**
 * UTC offset in seconds of the zone at the given instant.
 */
export function getTimezoneOffset(tzid: string, timestamp: number): number {
  const formatter = getFormatter(tzid)
  if (!formatter) return 0
  const fields: Record<string, number> = {}
  for (const part of formatter.formatToParts(new Date(timestamp))) {
    if (part.type !== 'literal') fields[part.type] = parseInt(part.value, 10)
  }
  const wallClock = Date.UTC(
    fields.year,
    fields.month - 1,
    fields.day,
    fields.hour % 24,
    fields.minute,
    fields.second
  )
  const instant = Math.floor(timestamp / 1000) * 1000
  return Math.round((wallClock - instant) / 1000)
}

function findTransitions(tzid: string, startYear: number, endYear: number): Transition[] {
  const key = `${tzid}|${startYear}|${endYear}`
  const cached = transitionCache.get(key)
  if (cached) return cached

  const transitions: Transition[] = []
  const end = Date.UTC(endYear + 1, 0, 1)
  let time = Date.UTC(startYear, 0, 1)
  let offset = getTimezoneOffset(tzid, time)

  while (time < end) {
    const next = Math.min(time + PROBE_STEP_MS, end)
    const nextOffset = getTimezoneOffset(tzid, next)
    if (nextOffset !== offset) {
      // binary search for the first second with the new offset
      let lo = time
      let hi = next
      while (hi - lo > 1000) {
        const mid = Math.floor((lo + hi) / 2000) * 1000
        if (getTimezoneOffset(tzid, mid) === offset) {
          lo = mid
        } else {
          hi = mid
        }
      }
      transitions.push({ at: hi, from: offset, to: getTimezoneOffset(tzid, hi) })
    }
    time = next
    offset = nextOffset
  }

  transitionCache.set(key, transitions)
  return transitions
}

/** Wall clock time of a transition, expressed in the offset before it (RFC 5545 3.6.5) */
function localStart(transition: Transition): LocalStart {
  const date = new Date(transition.at + transition.from * 1000)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds()
  }
}

function isDaylight(transition: Transition): boolean {
  return transition.to > transition.from
}

function patternKey(transition: Transition): string {
  const l = localStart(transition)
  return [
    isDaylight(transition),
    transition.from,
    transition.to,
    l.month,
    l.weekday,
    l.hour,
    l.minute,
    l.second
  ].join('|')
}

/**
 * Find a yearly RRULE that matches all given transitions (same month, weekday and time,
 * consecutive years), e.g. `FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU`.
 */
function findYearlyRule(run: Transition[]): string | null {
  const starts = run.map(localStart)
  const { month, weekday } = starts[0]
  const wd = WEEKDAYS[weekday]
  const base = `FREQ=YEARLY;BYMONTH=${month}`

  const nths = starts.map((s) => Math.ceil(s.day / 7))
  if (nths.every((n) => n === nths[0]) && nths[0] < 5) {
    return `${base};BYDAY=${nths[0]}${wd}`
  }

  const isLast = starts.every(
    (s) => s.day + 7 > new Date(Date.UTC(s.year, s.month, 0)).getUTCDate()
  )
  if (isLast) {
    return `${base};BYDAY=-1${wd}`
  }

  // e.g. "Friday before the last Sunday": weekday within a fixed 7 day window
  const days = starts.map((s) => s.day)
  const min = Math.min(...days)
  // length of the month in a non-leap year
  const shortestMonthLength = new Date(Date.UTC(2001, month, 0)).getUTCDate()
  if (run.length >= 5 && Math.max(...days) - min <= 6 && min + 6 <= shortestMonthLength) {
    const monthDays = Array.from({ length: 7 }, (_, i) => min + i).join(',')
    return `${base};BYMONTHDAY=${monthDays};BYDAY=${wd}`
  }

  return null
}

/**
 * Find the ongoing yearly run of transitions of one kind (daylight or standard) at the end
 * of the probed range.
 */
function findTail(
  transitions: Transition[],
  daylight: boolean,
  endYear: number
): { members: Set<Transition>; first: Transition; rule: string } | null {
  const ofKind = transitions.filter((t) => isDaylight(t) === daylight)
  if (ofKind.length < 2) return null

  const last = ofKind[ofKind.length - 1]
  if (localStart(last).year < endYear - 1) return null // the zone stopped switching

  const key = patternKey(last)
  const run = [last]
  for (let i = ofKind.length - 2; i >= 0; i--) {
    const candidate = ofKind[i]
    if (patternKey(candidate) !== key) break
    if (localStart(candidate).year !== localStart(run[0]).year - 1) break
    run.unshift(candidate)
  }

  // use the longest suffix of the run that can be expressed as a single rule
  for (let start = 0; start <= run.length - 2; start++) {
    const suffix = run.slice(start)
    const rule = findYearlyRule(suffix)
    if (rule) {
      return { members: new Set(suffix), first: suffix[0], rule }
    }
  }
  return null
}

function addObservance(
  vtimezone: ICAL.Component,
  daylight: boolean,
  from: number,
  to: number,
  start: LocalStart,
  rule?: string
) {
  const observance = new ICAL.Component(daylight ? 'daylight' : 'standard')
  observance.addPropertyWithValue('tzoffsetfrom', ICAL.UtcOffset.fromSeconds(from))
  observance.addPropertyWithValue('tzoffsetto', ICAL.UtcOffset.fromSeconds(to))
  observance.addPropertyWithValue(
    'dtstart',
    ICAL.Time.fromData({
      year: start.year,
      month: start.month,
      day: start.day,
      hour: start.hour,
      minute: start.minute,
      second: start.second,
      isDate: false
    })
  )
  if (rule) {
    observance.addPropertyWithValue('rrule', ICAL.Recur.fromString(rule))
  }
  vtimezone.addSubcomponent(observance)
}

/**
 * Generate a VTIMEZONE component for an IANA time zone from the browser's Intl data.
 * The definition covers `fromYear` onwards. Returns null for unknown time zones.
 */
export function buildVTimezone(tzid: string, fromYear: number): ICAL.Component | null {
  if (!isKnownTimezone(tzid)) return null

  const endYear = Math.max(fromYear, new Date().getUTCFullYear()) + FUTURE_YEARS
  const cacheKey = `${tzid}|${fromYear}|${endYear}`
  const cached = vtimezoneCache.get(cacheKey)
  if (cached) return new ICAL.Component(structuredClone(cached.jCal))

  const transitions = findTransitions(tzid, fromYear, endYear)
  const vtimezone = new ICAL.Component('vtimezone')
  vtimezone.addPropertyWithValue('tzid', tzid)

  // Offset in effect at the start of the covered range
  const initialOffset = getTimezoneOffset(tzid, Date.UTC(fromYear, 0, 1))
  const initialIsDaylight = transitions.length > 0 && transitions[0].from > transitions[0].to
  addObservance(vtimezone, initialIsDaylight, initialOffset, initialOffset, {
    year: fromYear,
    month: 1,
    day: 1,
    weekday: 0,
    hour: 0,
    minute: 0,
    second: 0
  })

  // Only use rules if both kinds of transitions continue yearly, otherwise list them all
  let tails = [findTail(transitions, true, endYear), findTail(transitions, false, endYear)]
  if (tails.some((t) => t === null) && tails.some((t) => t !== null)) {
    tails = []
  }

  for (const transition of transitions) {
    if (tails.some((t) => t?.members.has(transition))) continue
    addObservance(
      vtimezone,
      isDaylight(transition),
      transition.from,
      transition.to,
      localStart(transition)
    )
  }
  for (const tail of tails) {
    if (!tail) continue
    addObservance(
      vtimezone,
      isDaylight(tail.first),
      tail.first.from,
      tail.first.to,
      localStart(tail.first),
      tail.rule
    )
  }

  vtimezoneCache.set(cacheKey, vtimezone)
  return new ICAL.Component(structuredClone(vtimezone.jCal))
}

function getTzidOf(vtimezone: ICAL.Component): string | null {
  const tzid = vtimezone.getFirstPropertyValue('tzid')
  return typeof tzid === 'string' && tzid ? tzid : null
}

/**
 * Find the VTIMEZONE with the given TZID inside a VCALENDAR component.
 */
export function findVTimezone(calendar: ICAL.Component, tzid: string): ICAL.Component | null {
  for (const vtimezone of calendar.getAllSubcomponents('vtimezone')) {
    if (getTzidOf(vtimezone) === tzid) return vtimezone
  }
  return null
}

/**
 * Collect all TZID parameters referenced by properties of the given components.
 */
export function collectReferencedTimezones(components: ICAL.Component[]): Set<string> {
  const tzids = new Set<string>()
  for (const component of components) {
    for (const prop of component.getAllProperties()) {
      const tzid = prop.getParameter('tzid')
      if (typeof tzid === 'string' && tzid) tzids.add(tzid)
    }
  }
  return tzids
}

/**
 * Register a time zone generated from Intl data with ICAL.TimezoneService, unless a zone
 * with that id is registered already. Returns the registered zone or null if unknown.
 */
export function registerKnownTimezone(tzid: string): ICAL.Timezone | null {
  if (ICAL.TimezoneService.has(tzid)) return ICAL.TimezoneService.get(tzid) ?? null
  const vtimezone = buildVTimezone(tzid, REGISTRY_START_YEAR)
  if (!vtimezone) return null
  const zone = new ICAL.Timezone({ component: vtimezone, tzid })
  ICAL.TimezoneService.register(zone, tzid)
  return zone
}

/**
 * Register all VTIMEZONE components of a VCALENDAR with ICAL.TimezoneService and, for TZIDs
 * that are referenced without a definition, generate one from Intl data. Must be called
 * before property values are read, so TZID-qualified times resolve to the right zone.
 */
export function registerTimezones(calendar: ICAL.Component): void {
  for (const vtimezone of calendar.getAllSubcomponents('vtimezone')) {
    const tzid = getTzidOf(vtimezone)
    if (!tzid || ICAL.TimezoneService.has(tzid)) continue
    try {
      ICAL.TimezoneService.register(new ICAL.Timezone({ component: vtimezone, tzid }), tzid)
    } catch (e) {
      console.warn(`Failed to register time zone ${tzid}:`, e)
    }
  }

  const referenced = collectReferencedTimezones(calendar.getAllSubcomponents('vevent'))
  for (const tzid of referenced) {
    if (!ICAL.TimezoneService.has(tzid) && !findVTimezone(calendar, tzid)) {
      registerKnownTimezone(tzid)
    }
  }
}

export interface WriteTimezone {
  tzid: string
  zone: ICAL.Timezone
  vtimezone: ICAL.Component
}

/**
 * Resolve the time zone used to write date-time values. The definition is taken from the
 * VTIMEZONE in `source` if present, otherwise generated from Intl data covering `fromYear`
 * onwards. Returns null for UTC (values are written with `Z`) and for unknown zones.
 */
export function resolveWriteTimezone(
  tzid: string,
  fromYear: number,
  source?: ICAL.Component | null
): WriteTimezone | null {
  if (isUTCTimezone(tzid)) return null

  const existing = source ? findVTimezone(source, tzid) : null
  const vtimezone = existing
    ? new ICAL.Component(structuredClone(existing.jCal))
    : buildVTimezone(tzid, fromYear)
  if (!vtimezone) return null

  return { tzid, zone: new ICAL.Timezone({ component: vtimezone, tzid }), vtimezone }
}

/**
 * Add the VTIMEZONE of `timezone` to the calendar unless one with the same TZID exists.
 */
export function ensureVTimezone(calendar: ICAL.Component, timezone: WriteTimezone): void {
  if (findVTimezone(calendar, timezone.tzid)) return
  // VTIMEZONEs go before the VEVENTs
  const vevents = calendar.getAllSubcomponents('vevent')
  for (const vevent of vevents) calendar.removeSubcomponent(vevent)
  calendar.addSubcomponent(timezone.vtimezone)
  for (const vevent of vevents) calendar.addSubcomponent(vevent)
}

/**
 * Convert an instant to an ICAL.Time in the given zone (or UTC when no zone is given).
 */
export function toZonedTime(date: Date, timezone: WriteTimezone | null): ICAL.Time {
  const utc = ICAL.Time.fromJSDate(date, true)
  return timezone ? utc.convertToZone(timezone.zone) : utc
}

/**
 * Set a date-time property (DTSTART, DTEND, RECURRENCE-ID, EXDATE, ...) replacing existing
 * ones, with a matching TZID parameter.
 */
export function setTimeProperty(
  component: ICAL.Component,
  name: string,
  time: ICAL.Time,
  tzid: string | null
): ICAL.Property {
  component.removeAllProperties(name)
  return addTimeProperty(component, name, time, tzid)
}

export function addTimeProperty(
  component: ICAL.Component,
  name: string,
  time: ICAL.Time,
  tzid: string | null
): ICAL.Property {
  const prop = new ICAL.Property(name, component)
  prop.setValue(time)
  if (tzid && !time.isDate) {
    prop.setParameter('tzid', tzid)
  }
  component.addProperty(prop)
  return prop
}
