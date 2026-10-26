import ICAL from 'ical.js'
import type { CalendarEvent, EventFormData, DateRange, RecurrenceFormData } from '../types/calendar'
import {
  addTimeProperty,
  ensureVTimezone,
  getLocalTimezone,
  isUTCTimezone,
  registerTimezones,
  resolveWriteTimezone,
  setTimeProperty,
  toZonedTime,
  type WriteTimezone
} from './timezone'
import { parseAlarms, writeAlarms } from './alarms'
import { parseAttendees, parseOrganizer, writeParticipants } from './attendees'

/**
 * Parse an ICS string and return one or more CalendarEvent objects.
 * For recurring events, occurrences within the given range are expanded.
 * For non-recurring events, a single-element array is returned.
 */
export function parseICS(
  icsData: string,
  href: string,
  etag: string,
  range?: DateRange
): CalendarEvent[] {
  try {
    const jcalData = ICAL.parse(icsData)
    const comp = new ICAL.Component(jcalData)
    // Must happen before any time value is read, so TZIDs resolve to their zone
    registerTimezones(comp)
    const vevents = comp.getAllSubcomponents('vevent')

    if (vevents.length === 0) return []

    // Extract calendar href from event href
    const calendarHref = href.substring(0, href.lastIndexOf('/') + 1)

    // Separate master event from exception overrides
    let masterVevent: ICAL.Component | null = null
    const exceptions: ICAL.Component[] = []

    for (const vevent of vevents) {
      if (vevent.getFirstPropertyValue('recurrence-id')) {
        exceptions.push(vevent)
      } else {
        masterVevent = vevent
      }
    }

    // If no master found, just use the first vevent
    if (!masterVevent) {
      masterVevent = vevents[0]
    }

    const masterEvent = new ICAL.Event(masterVevent)
    const rruleProp = masterVevent.getFirstPropertyValue('rrule')
    const isRecurring = masterEvent.isRecurring()

    if (!isRecurring) {
      // Simple non-recurring event
      const parsed = parseVevent(masterVevent, href, etag, calendarHref, icsData)
      return parsed ? [parsed] : []
    }

    // Build a map of exception overrides keyed by RECURRENCE-ID
    const exceptionMap = new Map<string, ICAL.Component>()
    for (const exc of exceptions) {
      const recId = exc.getFirstPropertyValue('recurrence-id') as ICAL.Time
      if (recId) {
        exceptionMap.set(timeKey(recId), exc)
      }
    }

    // Also collect EXDATE values to skip
    const exdates = new Set<string>()
    const exdateProps = masterVevent.getAllProperties('exdate')
    for (const prop of exdateProps) {
      const values = prop.getValues() as ICAL.Time[]
      for (const val of values) {
        exdates.add(timeKey(val))
      }
    }

    const rruleStr = rruleProp ? rruleProp.toString() : undefined
    const results: CalendarEvent[] = []
    const dtstart = masterVevent.getFirstPropertyValue('dtstart') as ICAL.Time
    if (!dtstart) return []

    const duration = masterEvent.duration
    const masterExtras = parseEventExtras(masterVevent)

    // Set expansion bounds
    const rangeStart = ICAL.Time.fromJSDate(
      range ? range.start : new Date(Date.now() - 365 * 86400000),
      true
    )
    const rangeEnd = ICAL.Time.fromJSDate(
      range ? range.end : new Date(Date.now() + 365 * 86400000),
      true
    )

    // Use ical.js expansion. Occurrences keep the zone of DTSTART, so the local time of
    // the day stays the same across daylight saving time changes.
    const iter = masterEvent.iterator(dtstart)
    let next: ICAL.Time | null
    const MAX_OCCURRENCES = 500 // safety limit

    for (let i = 0; i < MAX_OCCURRENCES; i++) {
      next = iter.next()
      if (!next) break

      // Past the range end, stop
      if (next.compare(rangeEnd) > 0) break

      // Calculate occurrence end
      const occEnd = next.clone()
      occEnd.addDuration(duration)

      // Before range start, skip
      if (occEnd.compare(rangeStart) < 0) continue

      // Check if this occurrence is excluded
      const nextKey = timeKey(next)
      if (exdates.has(nextKey)) continue

      // Recurrence ids are reported in the zone of the master's DTSTART
      const nextStr = next.toString()

      // Check if there's an exception override
      const exceptionVevent = exceptionMap.get(nextKey)
      if (exceptionVevent) {
        const excEvent = parseVevent(exceptionVevent, href, etag, calendarHref, icsData)
        if (excEvent) {
          results.push({
            ...excEvent,
            isRecurring: true,
            rrule: rruleStr,
            recurrenceId: nextStr
          })
        }
        continue
      }

      // Regular occurrence
      const allDay = next.isDate
      const start = next.toJSDate()
      const end = occEnd.toJSDate()

      results.push({
        uid: masterEvent.uid,
        calendarHref,
        href,
        etag,
        summary: masterEvent.summary || '',
        start,
        end,
        allDay,
        description: masterEvent.description || undefined,
        location: masterEvent.location || undefined,
        icsData,
        isRecurring: true,
        rrule: rruleStr,
        recurrenceId: nextStr,
        ...masterExtras
      })
    }

    return results
  } catch (e) {
    console.error('Failed to parse ICS:', e)
    return []
  }
}

function parseVevent(
  vevent: ICAL.Component,
  href: string,
  etag: string,
  calendarHref: string,
  icsData: string
): CalendarEvent | null {
  const event = new ICAL.Event(vevent)
  const dtstart = vevent.getFirstPropertyValue('dtstart') as ICAL.Time | null
  const dtend = vevent.getFirstPropertyValue('dtend') as ICAL.Time | null

  if (!dtstart) return null

  const allDay = dtstart.isDate
  const start = dtstart.toJSDate()
  let end: Date

  if (dtend) {
    end = dtend.toJSDate()
  } else {
    end = new Date(start)
    if (allDay) {
      end.setDate(end.getDate() + 1)
    }
  }

  const rruleProp = vevent.getFirstPropertyValue('rrule')
  const recIdProp = vevent.getFirstPropertyValue('recurrence-id') as ICAL.Time | null

  return {
    uid: event.uid,
    calendarHref,
    href,
    etag,
    summary: event.summary || '',
    start,
    end,
    allDay,
    description: event.description || undefined,
    location: event.location || undefined,
    icsData,
    isRecurring: !!rruleProp || !!recIdProp,
    rrule: rruleProp ? rruleProp.toString() : undefined,
    recurrenceId: recIdProp ? recIdProp.toString() : undefined,
    ...parseEventExtras(vevent)
  }
}

/** Reminders, attendees and organizer of a VEVENT */
function parseEventExtras(
  vevent: ICAL.Component
): Pick<CalendarEvent, 'alarms' | 'attendees' | 'organizer'> {
  const organizer = parseOrganizer(vevent)
  return {
    alarms: parseAlarms(vevent),
    attendees: parseAttendees(vevent),
    ...(organizer && { organizer })
  }
}

/**
 * Writes reminders, attendees and organizer of the form. Values the form leaves undefined are
 * copied from `fallback` (the component being replaced), so callers that only change the time
 * (e.g. drag and drop) keep them.
 */
function writeEventExtras(
  vevent: ICAL.Component,
  formData: EventFormData,
  fallback: ICAL.Component | null
): void {
  const alarms = formData.alarms ?? (fallback ? parseAlarms(fallback) : [])
  writeAlarms(vevent, alarms, formData.summary)

  if (formData.attendees) {
    writeParticipants(
      vevent,
      formData.attendees,
      formData.attendees.length > 0 ? formData.organizer : undefined
    )
  } else if (fallback) {
    writeParticipants(vevent, parseAttendees(fallback), parseOrganizer(fallback))
  }
}

/**
 * Key to match RECURRENCE-ID/EXDATE values against occurrences independent of the zone
 * they are written in.
 */
function timeKey(time: ICAL.Time): string {
  return time.isDate ? time.toString() : String(time.toUnixTime())
}

export interface GenerateICSOptions {
  /** IANA time zone for date-time values, defaults to the browser's zone */
  timezone?: string
  /** ICS of the event being replaced; its TZID (and VTIMEZONE) are kept */
  sourceICS?: string
}

export function generateICS(formData: EventFormData, options: GenerateICSOptions = {}): string {
  const uid = formData.uid || generateUID()

  const calendar = new ICAL.Component('vcalendar')
  calendar.addPropertyWithValue('version', '2.0')
  calendar.addPropertyWithValue('prodid', '-//OpenCloud//Calendar//EN')

  const vevent = new ICAL.Component('vevent')
  vevent.addPropertyWithValue('uid', uid)
  vevent.addPropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true))

  let source: ICAL.Component | null = null
  if (options.sourceICS) {
    try {
      source = new ICAL.Component(ICAL.parse(options.sourceICS))
    } catch {
      source = null
    }
  }

  if (formData.allDay) {
    addTimeProperty(vevent, 'dtstart', toDateValue(formData.start), null)
    addTimeProperty(vevent, 'dtend', toDateValue(formData.end), null)
  } else {
    const preferredTzid = options.timezone ?? (source ? getMasterTzid(source) : null)
    const timezone = resolveEventTimezone(preferredTzid, formData.start, source)
    if (timezone) {
      calendar.addSubcomponent(timezone.vtimezone)
    }
    const tzid = timezone?.tzid ?? null
    addTimeProperty(vevent, 'dtstart', toZonedTime(formData.start, timezone), tzid)
    addTimeProperty(vevent, 'dtend', toZonedTime(formData.end, timezone), tzid)
  }

  vevent.addPropertyWithValue('summary', formData.summary)

  if (formData.recurrence) {
    vevent.addPropertyWithValue(
      'rrule',
      ICAL.Recur.fromString(buildRRuleString(formData.recurrence, formData.allDay))
    )
  }

  if (formData.description) {
    vevent.addPropertyWithValue('description', formData.description)
  }

  if (formData.location) {
    vevent.addPropertyWithValue('location', formData.location)
  }

  writeEventExtras(
    vevent,
    formData,
    source ? (findMasterVevent(source) ?? source.getFirstSubcomponent('vevent')) : null
  )

  calendar.addSubcomponent(vevent)

  return calendar.toString()
}

/**
 * Pick the zone date-time values of an event are written in: the preferred TZID (usually
 * the one the event already has) or else the browser's zone. Returns null for UTC.
 */
function resolveEventTimezone(
  preferredTzid: string | null | undefined,
  start: Date,
  source?: ICAL.Component | null
): WriteTimezone | null {
  // Let the time zone definition start a year before the event
  const fromYear = start.getUTCFullYear() - 1
  if (preferredTzid) {
    if (isUTCTimezone(preferredTzid)) return null
    const preferred = resolveWriteTimezone(preferredTzid, fromYear, source)
    if (preferred) return preferred
  }
  return resolveWriteTimezone(getLocalTimezone(), fromYear, source)
}

function findMasterVevent(calendar: ICAL.Component): ICAL.Component | null {
  for (const vevent of calendar.getAllSubcomponents('vevent')) {
    if (!vevent.getFirstPropertyValue('recurrence-id')) {
      return vevent
    }
  }
  return null
}

/**
 * TZID of the DTSTART of the master event, null for UTC, floating and all-day values.
 */
function getMasterTzid(calendar: ICAL.Component): string | null {
  const master = findMasterVevent(calendar) ?? calendar.getFirstSubcomponent('vevent')
  const prop = master?.getFirstProperty('dtstart')
  if (!prop) return null
  const tzid = prop.getParameter('tzid')
  return typeof tzid === 'string' && tzid ? tzid : null
}

function toDateValue(date: Date): ICAL.Time {
  return ICAL.Time.fromData({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    isDate: true
  })
}

function buildRRuleString(rec: RecurrenceFormData, allDay: boolean): string {
  const parts: string[] = [`FREQ=${rec.frequency}`]

  if (rec.interval > 1) {
    parts.push(`INTERVAL=${rec.interval}`)
  }

  if (rec.frequency === 'WEEKLY' && rec.byDay && rec.byDay.length > 0) {
    parts.push(`BYDAY=${rec.byDay.join(',')}`)
  }

  if (rec.endType === 'count' && rec.count) {
    parts.push(`COUNT=${rec.count}`)
  } else if (rec.endType === 'until' && rec.until) {
    if (allDay) {
      parts.push(`UNTIL=${formatICALDate(rec.until)}`)
    } else {
      // RFC 5545: UNTIL must be in UTC when DTSTART has a TZID
      parts.push(`UNTIL=${formatICALDateTimeUTC(rec.until)}`)
    }
  }

  return parts.join(';')
}

/**
 * Parse an RRULE string into RecurrenceFormData for the edit form.
 */
export function parseRRuleToFormData(rruleStr: string): RecurrenceFormData {
  const recur = ICAL.Recur.fromString(rruleStr)

  const frequency = recur.freq as RecurrenceFormData['frequency']
  const interval = recur.interval || 1

  let endType: RecurrenceFormData['endType'] = 'never'
  let count: number | undefined
  let until: Date | undefined

  if (recur.count) {
    endType = 'count'
    count = recur.count
  } else if (recur.until) {
    endType = 'until'
    until = recur.until.toJSDate()
  }

  let byDay: string[] | undefined
  if (recur.parts && recur.parts.BYDAY) {
    byDay = recur.parts.BYDAY as string[]
  }

  return { frequency, interval, endType, count, until, byDay }
}

/**
 * Parse a recurrence id as reported by parseICS (wall time in the zone of the master's
 * DTSTART, `Z` suffixed for UTC, date only for all-day events).
 */
function parseRecurrenceId(recurrenceId: string, masterDtstart: ICAL.Time | null): ICAL.Time {
  if (masterDtstart?.isDate) {
    return ICAL.Time.fromDateString(recurrenceId.substring(0, 10))
  }
  const time = ICAL.Time.fromDateTimeString(recurrenceId)
  if (time.zone === ICAL.Timezone.utcTimezone || !masterDtstart) {
    return time
  }
  return new ICAL.Time(
    {
      year: time.year,
      month: time.month,
      day: time.day,
      hour: time.hour,
      minute: time.minute,
      second: time.second,
      isDate: false
    },
    masterDtstart.zone
  )
}

/**
 * Update an existing ICS resource to add an EXDATE (exclude one occurrence)
 * and optionally add an exception VEVENT with RECURRENCE-ID.
 */
export function addExceptionToICS(
  icsData: string,
  recurrenceId: string,
  exceptionFormData?: EventFormData
): string {
  const jcalData = ICAL.parse(icsData)
  const comp = new ICAL.Component(jcalData)
  registerTimezones(comp)

  // Find master event (one without RECURRENCE-ID)
  const masterVevent = findMasterVevent(comp)
  if (!masterVevent) return icsData

  // RECURRENCE-ID and EXDATE use the same value type and zone as the master's DTSTART
  const masterDtstart = masterVevent.getFirstPropertyValue('dtstart') as ICAL.Time | null
  const masterTzid = getMasterTzid(comp)
  const recIdTime = parseRecurrenceId(recurrenceId, masterDtstart)
  const recIdTzid = recIdTime.zone === ICAL.Timezone.utcTimezone ? null : masterTzid

  if (exceptionFormData) {
    // Adding a modified occurrence: add a new VEVENT with RECURRENCE-ID
    // First, remove any existing exception for this recurrence-id
    const recIdKey = timeKey(recIdTime)
    let previousException: ICAL.Component | null = null
    for (const exc of comp.getAllSubcomponents('vevent')) {
      const excRecId = exc.getFirstPropertyValue('recurrence-id') as ICAL.Time | null
      if (excRecId && timeKey(excRecId) === recIdKey) {
        previousException = exc
        comp.removeSubcomponent(exc)
      }
    }

    // Build exception VEVENT
    const excVevent = new ICAL.Component('vevent')
    const masterEvent = new ICAL.Event(masterVevent)

    excVevent.addPropertyWithValue('uid', masterEvent.uid)
    excVevent.addPropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true))

    // Set RECURRENCE-ID
    addTimeProperty(excVevent, 'recurrence-id', recIdTime, recIdTzid)

    // Set start/end
    if (exceptionFormData.allDay) {
      addTimeProperty(excVevent, 'dtstart', toDateValue(exceptionFormData.start), null)
      addTimeProperty(excVevent, 'dtend', toDateValue(exceptionFormData.end), null)
    } else {
      // Keep the zone of the series
      const timezone = resolveEventTimezone(
        masterTzid,
        masterDtstart ? masterDtstart.toJSDate() : exceptionFormData.start,
        comp
      )
      if (timezone) {
        ensureVTimezone(comp, timezone)
      }
      const tzid = timezone?.tzid ?? null
      addTimeProperty(excVevent, 'dtstart', toZonedTime(exceptionFormData.start, timezone), tzid)
      addTimeProperty(excVevent, 'dtend', toZonedTime(exceptionFormData.end, timezone), tzid)
    }

    excVevent.addPropertyWithValue('summary', exceptionFormData.summary)
    if (exceptionFormData.description) {
      excVevent.addPropertyWithValue('description', exceptionFormData.description)
    }
    if (exceptionFormData.location) {
      excVevent.addPropertyWithValue('location', exceptionFormData.location)
    }

    writeEventExtras(excVevent, exceptionFormData, previousException ?? masterVevent)

    comp.addSubcomponent(excVevent)
  } else {
    // Deleting a single occurrence: just add EXDATE to master
    addTimeProperty(masterVevent, 'exdate', recIdTime, recIdTzid)
  }

  return comp.toString()
}

/**
 * Update an existing ICS resource to modify the master (series) event properties.
 */
export function updateSeriesICS(icsData: string, formData: EventFormData): string {
  const jcalData = ICAL.parse(icsData)
  const comp = new ICAL.Component(jcalData)
  registerTimezones(comp)

  // Find master event
  const masterVevent = findMasterVevent(comp)
  if (!masterVevent) return icsData

  // Update summary
  masterVevent.updatePropertyWithValue('summary', formData.summary)

  // Update description
  if (formData.description) {
    masterVevent.updatePropertyWithValue('description', formData.description)
  } else {
    masterVevent.removeAllProperties('description')
  }

  // Update location
  if (formData.location) {
    masterVevent.updatePropertyWithValue('location', formData.location)
  } else {
    masterVevent.removeAllProperties('location')
  }

  // Update start/end
  masterVevent.removeAllProperties('duration')
  if (formData.allDay) {
    setTimeProperty(masterVevent, 'dtstart', toDateValue(formData.start), null)
    setTimeProperty(masterVevent, 'dtend', toDateValue(formData.end), null)
  } else {
    // Keep the zone of the event, fall back to the browser's zone
    const timezone = resolveEventTimezone(getMasterTzid(comp), formData.start, comp)
    if (timezone) {
      ensureVTimezone(comp, timezone)
    }
    const tzid = timezone?.tzid ?? null
    setTimeProperty(masterVevent, 'dtstart', toZonedTime(formData.start, timezone), tzid)
    setTimeProperty(masterVevent, 'dtend', toZonedTime(formData.end, timezone), tzid)
  }

  // Update RRULE
  masterVevent.removeAllProperties('rrule')
  if (formData.recurrence) {
    const rruleStr = buildRRuleString(formData.recurrence, formData.allDay)
    masterVevent.addPropertyWithValue('rrule', ICAL.Recur.fromString(rruleStr))
  }

  // Reminders, attendees and organizer (kept when the form leaves them undefined)
  writeEventExtras(masterVevent, formData, masterVevent)

  // Update DTSTAMP
  masterVevent.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true))

  return comp.toString()
}

export function generateUID(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${timestamp}-${random}@opencloud`
}

function formatICALDateTimeUTC(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

function formatICALDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}
