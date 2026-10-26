import {
  CalDAVError,
  AuthenticationError,
  NotFoundError,
  ConflictError,
  InvalidSyncTokenError
} from './errors'
import {
  buildCalendarMultiget,
  buildCalendarQuery,
  buildPropfindCollectionState,
  buildSyncCollection
} from './xml-builder'
import { parseCollectionState, parseEvents, parseSyncCollection } from './xml-parser'
import { parseICS, generateICS, generateUID, addExceptionToICS, updateSeriesICS } from './ics-utils'
import { authenticatedFetch } from './auth'
import type { CalendarEvent, EventFormData, DateRange } from '../types/calendar'
import type { CollectionState, EventData, SyncCollectionResult } from '../types/caldav'

/**
 * A calendar object resource (one `.ics` file) with the events it contributes to a date range.
 * Recurring events are expanded to their occurrences in that range.
 */
export interface EventResource {
  href: string
  etag: string
  events: CalendarEvent[]
}

/** Maximum number of hrefs per `calendar-multiget` REPORT, keeps request bodies small */
export const MULTIGET_BATCH_SIZE = 100

async function report(url: string, body: string): Promise<string> {
  const response = await authenticatedFetch(url, {
    method: 'REPORT',
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      Depth: '1'
    },
    body
  })

  if (response.status === 401) {
    throw new AuthenticationError()
  }
  if (response.status === 404) {
    throw new NotFoundError(`Calendar not found: ${url}`)
  }
  if (!response.ok && response.status !== 207) {
    throw new CalDAVError(`REPORT failed: ${response.statusText}`, response.status)
  }

  return response.text()
}

/**
 * Href of a member resource as seen through `calendarHref`. Servers report the canonical path,
 * which differs from the requested one for shared (mapped) calendars.
 */
export function resourceHref(calendarHref: string, href: string): string {
  const filename = href.substring(href.lastIndexOf('/') + 1)
  return calendarHref.endsWith('/') ? `${calendarHref}${filename}` : `${calendarHref}/${filename}`
}

/** Whether an event (or occurrence) overlaps the range. Zero-length events count at their start. */
export function overlapsRange(event: { start: Date; end: Date }, range: DateRange): boolean {
  const start = event.start.getTime()
  const end = event.end.getTime()
  if (start >= range.end.getTime()) return false
  return end > range.start.getTime() || (end <= start && start >= range.start.getTime())
}

function toResource(calendarHref: string, data: EventData, range: DateRange): EventResource {
  const href = resourceHref(calendarHref, data.href)
  const events = parseICS(data.calendarData, href, data.etag, range).filter((event) =>
    overlapsRange(event, range)
  )
  return { href, etag: data.etag, events }
}

/** All resources of a calendar with events in the range (`calendar-query` with time-range). */
export async function fetchEventResources(
  calendarHref: string,
  range: DateRange
): Promise<EventResource[]> {
  const xml = await report(calendarHref, buildCalendarQuery(range.start, range.end))
  return parseEvents(xml).map((data) => toResource(calendarHref, data, range))
}

export async function fetchEvents(
  calendarHref: string,
  range: DateRange
): Promise<CalendarEvent[]> {
  const resources = await fetchEventResources(calendarHref, range)
  return resources.flatMap((resource) => resource.events)
}

/**
 * Fetches the given member resources with `calendar-multiget` REPORTs (RFC 4791 7.9) and
 * expands them for the range. Resources that no longer exist are missing from the result.
 * Resources without events in the range are returned with an empty `events` list, so callers
 * can tell "moved out of the range" from "deleted".
 */
export async function multigetEventResources(
  calendarHref: string,
  hrefs: string[],
  range: DateRange
): Promise<EventResource[]> {
  const resources: EventResource[] = []
  for (let i = 0; i < hrefs.length; i += MULTIGET_BATCH_SIZE) {
    const batch = hrefs.slice(i, i + MULTIGET_BATCH_SIZE)
    const xml = await report(calendarHref, buildCalendarMultiget(batch))
    resources.push(...parseEvents(xml).map((data) => toResource(calendarHref, data, range)))
  }
  return resources
}

/** Reads `getctag` and `sync-token` of a calendar with a Depth 0 PROPFIND. */
export async function fetchCollectionState(calendarHref: string): Promise<CollectionState> {
  const response = await authenticatedFetch(calendarHref, {
    method: 'PROPFIND',
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      Depth: '0'
    },
    body: buildPropfindCollectionState()
  })

  if (response.status === 401) throw new AuthenticationError()
  if (response.status === 404) throw new NotFoundError(`Calendar not found: ${calendarHref}`)
  if (!response.ok && response.status !== 207) {
    throw new CalDAVError(`PROPFIND failed: ${response.statusText}`, response.status)
  }

  return parseCollectionState(await response.text())
}

/**
 * Changes of a calendar since `syncToken` (`sync-collection` REPORT, RFC 6578). Hrefs in the
 * result are resolved against `calendarHref`.
 *
 * Throws `InvalidSyncTokenError` when the server rejects the token (`DAV:valid-sync-token`;
 * Radicale answers 403, RFC 6578 allows 403 or 409, some servers use 412). The caller has to
 * do a full resync then. Other failures (e.g. `DAV:supported-report` when the server does not
 * support the report) are thrown as `CalDAVError`.
 */
export async function syncCollection(
  calendarHref: string,
  syncToken: string
): Promise<SyncCollectionResult> {
  const response = await authenticatedFetch(calendarHref, {
    method: 'REPORT',
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // RFC 6578 3.2: the depth is given by DAV:sync-level, the header must be 0
      Depth: '0'
    },
    body: buildSyncCollection(syncToken)
  })

  if (response.status === 401) throw new AuthenticationError()
  if (response.status === 404) throw new NotFoundError(`Calendar not found: ${calendarHref}`)
  if (!response.ok && response.status !== 207) {
    const body = await response.text().catch(() => '')
    if (response.status === 412 || body.includes('valid-sync-token')) {
      throw new InvalidSyncTokenError(undefined, response.status)
    }
    throw new CalDAVError(`sync-collection failed: ${response.statusText}`, response.status, body)
  }

  const result = parseSyncCollection(await response.text())
  if (!result.syncToken) {
    throw new CalDAVError('sync-collection response without sync-token')
  }
  return {
    syncToken: result.syncToken,
    changed: result.changed.map((c) => ({ ...c, href: resourceHref(calendarHref, c.href) })),
    removed: result.removed.map((href) => resourceHref(calendarHref, href))
  }
}

export async function createEvent(formData: EventFormData): Promise<CalendarEvent> {
  const uid = generateUID()
  const icsData = generateICS({ ...formData, uid })
  const eventHref = `${formData.calendarHref}${uid}.ics`

  const response = await authenticatedFetch(eventHref, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'If-None-Match': '*'
    },
    body: icsData
  })

  if (response.status === 401) {
    throw new AuthenticationError()
  }
  if (response.status === 412) {
    throw new ConflictError('Event already exists')
  }
  if (!response.ok && response.status !== 201) {
    throw new CalDAVError(`Failed to create event: ${response.statusText}`, response.status)
  }

  const etag = response.headers.get('ETag')?.replace(/"/g, '') || ''

  return {
    uid,
    calendarHref: formData.calendarHref,
    href: eventHref,
    etag,
    summary: formData.summary,
    start: formData.start,
    end: formData.end,
    allDay: formData.allDay,
    description: formData.description || undefined,
    location: formData.location || undefined,
    icsData,
    isRecurring: !!formData.recurrence,
    rrule: undefined
  }
}

export async function updateEvent(
  event: CalendarEvent,
  formData: EventFormData
): Promise<CalendarEvent> {
  const icsData = generateICS({ ...formData, uid: event.uid }, { sourceICS: event.icsData })

  const response = await authenticatedFetch(event.href, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'If-Match': `"${event.etag}"`
    },
    body: icsData
  })

  if (response.status === 401) {
    throw new AuthenticationError()
  }
  if (response.status === 404) {
    throw new NotFoundError('Event not found')
  }
  if (response.status === 412) {
    throw new ConflictError('Event was modified by another client', event.etag)
  }
  if (!response.ok && response.status !== 204) {
    throw new CalDAVError(`Failed to update event: ${response.statusText}`, response.status)
  }

  const etag = response.headers.get('ETag')?.replace(/"/g, '') || event.etag

  return {
    ...event,
    summary: formData.summary,
    start: formData.start,
    end: formData.end,
    allDay: formData.allDay,
    description: formData.description || undefined,
    location: formData.location || undefined,
    etag,
    icsData,
    isRecurring: !!formData.recurrence || event.isRecurring
  }
}

export async function deleteEvent(event: CalendarEvent): Promise<void> {
  const response = await authenticatedFetch(event.href, {
    method: 'DELETE',
    headers: {
      'If-Match': `"${event.etag}"`
    }
  })

  if (response.status === 401) {
    throw new AuthenticationError()
  }
  if (response.status === 404) {
    // Already deleted, consider success
    return
  }
  if (response.status === 412) {
    throw new ConflictError('Event was modified by another client')
  }
  if (!response.ok && response.status !== 204) {
    throw new CalDAVError(`Failed to delete event: ${response.statusText}`, response.status)
  }
}

export async function updateEventOccurrence(
  event: CalendarEvent,
  recurrenceId: string,
  formData: EventFormData
): Promise<void> {
  const updatedICS = addExceptionToICS(event.icsData, recurrenceId, formData)

  const response = await authenticatedFetch(event.href, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'If-Match': `"${event.etag}"`
    },
    body: updatedICS
  })

  if (response.status === 401) throw new AuthenticationError()
  if (response.status === 412)
    throw new ConflictError('Event was modified by another client', event.etag)
  if (!response.ok && response.status !== 204) {
    throw new CalDAVError(`Failed to update occurrence: ${response.statusText}`, response.status)
  }
}

export async function deleteEventOccurrence(
  event: CalendarEvent,
  recurrenceId: string
): Promise<void> {
  const updatedICS = addExceptionToICS(event.icsData, recurrenceId)

  const response = await authenticatedFetch(event.href, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'If-Match': `"${event.etag}"`
    },
    body: updatedICS
  })

  if (response.status === 401) throw new AuthenticationError()
  if (response.status === 412)
    throw new ConflictError('Event was modified by another client', event.etag)
  if (!response.ok && response.status !== 204) {
    throw new CalDAVError(`Failed to delete occurrence: ${response.statusText}`, response.status)
  }
}

export async function updateEventSeries(
  event: CalendarEvent,
  formData: EventFormData
): Promise<void> {
  const updatedICS = updateSeriesICS(event.icsData, formData)

  const response = await authenticatedFetch(event.href, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'If-Match': `"${event.etag}"`
    },
    body: updatedICS
  })

  if (response.status === 401) throw new AuthenticationError()
  if (response.status === 412)
    throw new ConflictError('Event was modified by another client', event.etag)
  if (!response.ok && response.status !== 204) {
    throw new CalDAVError(`Failed to update series: ${response.statusText}`, response.status)
  }
}

export async function fetchSingleEvent(href: string): Promise<CalendarEvent | null> {
  const response = await authenticatedFetch(href, {
    method: 'GET',
    headers: {
      Accept: 'text/calendar'
    }
  })

  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new CalDAVError(`Failed to fetch event: ${response.statusText}`, response.status)
  }

  const icsData = await response.text()
  const etag = response.headers.get('ETag')?.replace(/"/g, '') || ''

  const events = parseICS(icsData, href, etag)
  return events.length > 0 ? events[0] : null
}
