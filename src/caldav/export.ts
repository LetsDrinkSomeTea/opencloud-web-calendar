import ICAL from 'ical.js'
import { authenticatedFetch } from './auth'
import { AuthenticationError, CalDAVError, NotFoundError } from './errors'
import { buildCalendarQueryAll } from './xml-builder'
import { parseEvents } from './xml-parser'

const PRODID = '-//OpenCloud//Web Calendar//EN'

export interface CalendarExportMeta {
  displayName?: string
  description?: string
  color?: string
}

export interface CalendarExport {
  ics: string
  /** Number of calendar object resources that were merged */
  objectCount: number
  /** Number of resources that could not be parsed and were left out */
  skipped: number
}

/** Fetches the iCalendar data of every object resource (events, tasks, …) of a calendar */
export async function fetchCalendarObjects(calendarHref: string): Promise<string[]> {
  const response = await authenticatedFetch(calendarHref, {
    method: 'REPORT',
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      Depth: '1'
    },
    body: buildCalendarQueryAll()
  })

  if (response.status === 401) throw new AuthenticationError()
  if (response.status === 404) throw new NotFoundError('Calendar not found')
  if (!response.ok && response.status !== 207) {
    throw new CalDAVError(`REPORT failed: ${response.statusText}`, response.status)
  }

  return parseEvents(await response.text()).map(({ calendarData }) => calendarData)
}

/**
 * Merges the calendar object resources of a collection into one VCALENDAR.
 *
 * Every resource is a VCALENDAR of its own that carries the VTIMEZONEs it references. In the
 * merged file each TZID may only appear once (RFC 5545 3.6.5), so time zones are deduplicated by
 * TZID (the first definition wins). All other components (VEVENT incl. their overrides, VTODO,
 * VJOURNAL, VFREEBUSY) are copied unchanged. Resources that cannot be parsed are skipped.
 */
export function mergeCalendarObjects(
  objects: readonly string[],
  meta: CalendarExportMeta = {}
): CalendarExport {
  const calendar = new ICAL.Component(['vcalendar', [], []])
  calendar.addPropertyWithValue('version', '2.0')
  calendar.addPropertyWithValue('prodid', PRODID)
  calendar.addPropertyWithValue('calscale', 'GREGORIAN')
  if (meta.displayName) {
    calendar.addPropertyWithValue('x-wr-calname', meta.displayName)
  }
  if (meta.description) {
    calendar.addPropertyWithValue('x-wr-caldesc', meta.description)
  }
  if (meta.color) {
    // RFC 7986 COLOR only accepts CSS color names, so the hex color goes into the de-facto
    // standard Apple property instead
    calendar.addPropertyWithValue('x-apple-calendar-color', meta.color)
  }

  const timezones = new Map<string, ICAL.Component>()
  const components: ICAL.Component[] = []
  let objectCount = 0
  let skipped = 0

  for (const data of objects) {
    let source: ICAL.Component
    try {
      source = new ICAL.Component(ICAL.parse(data))
    } catch {
      skipped++
      continue
    }
    if (source.name !== 'vcalendar') {
      skipped++
      continue
    }
    objectCount++

    for (const component of source.getAllSubcomponents()) {
      if (component.name === 'vtimezone') {
        const tzid = component.getFirstPropertyValue('tzid')
        if (typeof tzid === 'string' && !timezones.has(tzid)) {
          timezones.set(tzid, component)
        }
      } else {
        components.push(component)
      }
    }
  }

  // Time zones first, like most clients write them
  for (const timezone of timezones.values()) {
    calendar.addSubcomponent(timezone)
  }
  for (const component of components) {
    calendar.addSubcomponent(component)
  }

  return { ics: calendar.toString(), objectCount, skipped }
}

/** Fetches a whole calendar and merges it into a single `.ics` file */
export async function exportCalendar(
  calendarHref: string,
  meta: CalendarExportMeta = {}
): Promise<CalendarExport> {
  const objects = await fetchCalendarObjects(calendarHref)
  return mergeCalendarObjects(objects, meta)
}
