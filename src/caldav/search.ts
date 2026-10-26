import { AuthenticationError, CalDAVError, NotFoundError } from './errors'
import { authenticatedFetch } from './auth'
import { buildCalendarTextSearchQuery } from './xml-builder'
import { parseEvents } from './xml-parser'
import { parseICS } from './ics-utils'
import { SEARCH_PROPERTIES, compareEvents, eventMatchesQuery, uniqueEvents } from '../utils/search'
import type { Calendar, CalendarEvent, DateRange } from '../types/calendar'

/**
 * Word of the query that is sent to the server. CalDAV `text-match` matches a single substring,
 * so the longest word narrows the results down best; all words are checked on the client.
 */
export function serverSearchTerm(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .reduce((longest, word) => (word.length > longest.length ? word : longest), '')
}

async function searchProperty(
  calendarHref: string,
  property: string,
  term: string,
  range: DateRange
): Promise<CalendarEvent[]> {
  const response = await authenticatedFetch(calendarHref, {
    method: 'REPORT',
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      Depth: '1'
    },
    body: buildCalendarTextSearchQuery(property, term, range.start, range.end)
  })

  if (response.status === 401) throw new AuthenticationError()
  if (response.status === 404) throw new NotFoundError(`Calendar not found: ${calendarHref}`)
  if (!response.ok && response.status !== 207) {
    throw new CalDAVError(`REPORT failed: ${response.statusText}`, response.status)
  }

  const events: CalendarEvent[] = []
  for (const data of parseEvents(await response.text())) {
    // Keep the requested calendar path, shared calendars are mapped to another path
    const filename = data.href.substring(data.href.lastIndexOf('/') + 1)
    const href = `${calendarHref.replace(/\/?$/, '/')}${filename}`
    events.push(...parseICS(data.calendarData, href, data.etag, range))
  }
  return events
}

/**
 * Searches the events of a calendar in the range on the server with CalDAV `text-match`
 * (one REPORT per searched property).
 */
export async function searchCalendarEvents(
  calendarHref: string,
  query: string,
  range: DateRange
): Promise<CalendarEvent[]> {
  const term = serverSearchTerm(query)
  if (!term) return []
  const results = await Promise.all(
    SEARCH_PROPERTIES.map((property) => searchProperty(calendarHref, property, term, range))
  )
  return results.flat()
}

/**
 * Searches all visible calendars. Returns the matching occurrences (every word of the query,
 * case and diacritics insensitive), without duplicates and sorted by start.
 */
export async function searchEvents(
  calendars: readonly Calendar[],
  query: string,
  range: DateRange
): Promise<CalendarEvent[]> {
  const visible = calendars.filter((c) => c.visible)
  const results = await Promise.all(
    visible.map((calendar) => searchCalendarEvents(calendar.href, query, range))
  )
  return uniqueEvents(results.flat().filter((event) => eventMatchesQuery(event, query))).sort(
    compareEvents
  )
}
