import ICAL from 'ical.js'
import { AuthenticationError, CalDAVError, NotFoundError } from './errors'
import { buildFreeBusyQuery } from './xml-builder'
import { authenticatedFetch } from './auth'
import type { DateRange } from '../types/calendar'

export type BusyType = 'BUSY' | 'BUSY-TENTATIVE' | 'BUSY-UNAVAILABLE'

export interface BusyPeriod {
  start: Date
  end: Date
  type: BusyType
  /** Calendar the period was reported for */
  calendarHref: string
}

/**
 * Busy time of one calendar collection (`free-busy-query` REPORT, RFC 4791 7.10). The server
 * answers with a `VFREEBUSY` component; Radicale also requires only the `read` (or freebusy)
 * permission, so this works for calendars shared with the user as well.
 */
export async function queryCalendarFreeBusy(
  calendarHref: string,
  range: DateRange
): Promise<BusyPeriod[]> {
  const response = await authenticatedFetch(calendarHref, {
    method: 'REPORT',
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      Depth: '1'
    },
    body: buildFreeBusyQuery(range.start, range.end)
  })

  if (response.status === 401) throw new AuthenticationError()
  if (response.status === 404) throw new NotFoundError(`Calendar not found: ${calendarHref}`)
  if (!response.ok) {
    throw new CalDAVError(`free-busy-query failed: ${response.statusText}`, response.status)
  }

  return parseFreeBusy(await response.text(), calendarHref)
}

/** Extracts the busy periods (`FREEBUSY` properties with a busy `FBTYPE`) of a VFREEBUSY. */
export function parseFreeBusy(icsData: string, calendarHref = ''): BusyPeriod[] {
  const root = new ICAL.Component(ICAL.parse(icsData))
  const components = root.name === 'vfreebusy' ? [root] : root.getAllSubcomponents('vfreebusy')
  const periods: BusyPeriod[] = []

  for (const component of components) {
    for (const prop of component.getAllProperties('freebusy')) {
      const type = String(prop.getParameter('fbtype') || 'BUSY').toUpperCase()
      if (type === 'FREE') continue
      for (const value of prop.getValues() as ICAL.Period[]) {
        const start = value.start.toJSDate()
        const end = value.end ? value.end.toJSDate() : value.getEnd().toJSDate()
        periods.push({ start, end, type: type as BusyType, calendarHref })
      }
    }
  }

  return periods
}

/**
 * Busy periods of several calendars in the range, sorted by start.
 *
 * Calendars that cannot be queried (e.g. no permission) are skipped; the call only fails if
 * every calendar failed. Free/busy of other users' calendars is only available for calendars
 * the user can read: Radicale has no scheduling outbox (RFC 6638), so there is no lookup by
 * attendee address.
 */
export async function queryFreeBusy(
  calendarHrefs: string[],
  range: DateRange
): Promise<BusyPeriod[]> {
  const results = await Promise.allSettled(
    calendarHrefs.map((href) => queryCalendarFreeBusy(href, range))
  )

  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failures.length > 0 && failures.length === results.length) {
    throw failures[0].reason
  }

  const periods = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
  return periods.sort((a, b) => a.start.getTime() - b.start.getTime())
}

/** Periods overlapping `[start, end)`. */
export function findOverlappingPeriods(
  periods: readonly BusyPeriod[],
  start: Date,
  end: Date
): BusyPeriod[] {
  const s = start.getTime()
  const e = Math.max(end.getTime(), s + 1)
  return periods.filter((p) => p.start.getTime() < e && p.end.getTime() > s)
}
