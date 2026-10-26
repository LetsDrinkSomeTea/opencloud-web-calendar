import { XMLParser } from 'fast-xml-parser'
import type {
  CalendarData,
  CollectionState,
  EventData,
  SyncCollectionResult
} from '../types/caldav'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  // Keep values like "2024" or "true" (display names, ctags) as strings
  parseTagValue: false,
  isArray: (name) => name === 'response'
})

interface ParsedMultistatus {
  multistatus?: {
    response?: ParsedResponse | ParsedResponse[]
    'sync-token'?: unknown
  }
}

interface ParsedPropstat {
  prop?: Record<string, unknown>
  status?: string
}

interface ParsedResponse {
  href?: string
  status?: string
  propstat?: ParsedPropstat | ParsedPropstat[]
}

export function parseMultistatus(xml: string): ParsedResponse[] {
  const parsed = parser.parse(xml) as ParsedMultistatus
  const responses = parsed.multistatus?.response
  if (!responses) return []
  return Array.isArray(responses) ? responses : [responses]
}

/**
 * Returns the `prop` objects of all successful (HTTP 200) propstats of a response.
 * Servers may return several propstats per response (e.g. one 200 and one 404) in any order.
 */
function getSuccessfulProps(response: ParsedResponse): Record<string, unknown>[] {
  const propstats = Array.isArray(response.propstat) ? response.propstat : [response.propstat]
  return propstats
    .filter((propstat) => propstat?.prop && (!propstat.status || propstat.status.includes('200')))
    .map((propstat) => propstat!.prop!)
}

function findHrefProperty(xml: string, name: string): string | null {
  for (const response of parseMultistatus(xml)) {
    for (const prop of getSuccessfulProps(response)) {
      const value = prop[name] as { href?: unknown } | undefined
      const href = extractString(value?.href)
      if (href) {
        return href
      }
    }
  }
  return null
}

export function parseCurrentUserPrincipal(xml: string): string | null {
  return findHrefProperty(xml, 'current-user-principal')
}

export function parseCalendarHomeSet(xml: string): string | null {
  return findHrefProperty(xml, 'calendar-home-set')
}

export function parseCalendars(xml: string): CalendarData[] {
  const responses = parseMultistatus(xml)
  const calendars: CalendarData[] = []

  for (const response of responses) {
    const href = response.href
    if (!href) continue

    const propstats = Array.isArray(response.propstat) ? response.propstat : [response.propstat]

    let resourceType: Record<string, unknown> | undefined
    let displayname: unknown
    let color: unknown
    let ctag: unknown
    let syncToken: unknown
    let description: unknown
    let privileges: any
    let foundCalendar = false

    for (const propstat of propstats) {
      if (!propstat?.prop) continue

      // We only care about properties that were successfully retrieved (HTTP 200)
      if (propstat.status && !propstat.status.includes('200')) {
        continue
      }

      const prop = propstat.prop

      if (prop['resourcetype']) {
        resourceType = prop['resourcetype'] as Record<string, unknown>
        if (resourceType && 'calendar' in resourceType) {
          foundCalendar = true
        }
      }

      if (prop['displayname'] !== undefined) displayname = prop['displayname']
      if (prop['calendar-color'] !== undefined) color = prop['calendar-color']
      if (prop['getctag'] !== undefined) ctag = prop['getctag']
      if (prop['sync-token'] !== undefined) syncToken = prop['sync-token']
      if (prop['calendar-description'] !== undefined) description = prop['calendar-description']
      if (prop['current-user-privilege-set'] !== undefined)
        privileges = prop['current-user-privilege-set']
    }

    if (!foundCalendar) continue

    let readOnly = false
    if (privileges && typeof privileges === 'object' && privileges.privilege) {
      // If we explicitly received a privilege object with actual privileges
      const privString = JSON.stringify(privileges.privilege).toLowerCase()
      const hasWrite = privString.includes('write') || privString.includes('all')
      readOnly = !hasWrite
    } else {
      // If no explicit privilege data is found, or it's empty, default to owner (writable)
      readOnly = false
    }

    calendars.push({
      href,
      displayName: extractString(displayname),
      color: extractString(color),
      ctag: extractString(ctag),
      syncToken: extractString(syncToken) || undefined,
      description: extractString(description),
      readOnly
    })
  }

  return calendars
}

export function parseEvents(xml: string): EventData[] {
  const responses = parseMultistatus(xml)
  const events: EventData[] = []

  for (const response of responses) {
    const href = response.href
    if (!href) continue

    let etag: string | undefined
    let calendarData: string | undefined
    for (const prop of getSuccessfulProps(response)) {
      etag ??= extractString(prop['getetag'])
      calendarData ??= extractString(prop['calendar-data'])
    }

    if (etag && calendarData) {
      events.push({
        href,
        etag: etag.replace(/"/g, ''),
        calendarData
      })
    }
  }

  return events
}

/** Parses the `getctag` / `sync-token` properties of a Depth 0 PROPFIND on a collection. */
export function parseCollectionState(xml: string): CollectionState {
  const state: CollectionState = {}
  for (const response of parseMultistatus(xml)) {
    for (const prop of getSuccessfulProps(response)) {
      state.ctag ??= extractString(prop['getctag']) || undefined
      state.syncToken ??= extractString(prop['sync-token']) || undefined
    }
  }
  return state
}

/**
 * Parses a `sync-collection` REPORT response (RFC 6578 3.5). Removed members are reported as
 * a response with a 404 status and no propstat; changed members carry their new ETag.
 */
export function parseSyncCollection(xml: string): SyncCollectionResult {
  const parsed = parser.parse(xml) as ParsedMultistatus
  const syncToken = extractString(parsed.multistatus?.['sync-token']) ?? ''
  const result: SyncCollectionResult = { syncToken, changed: [], removed: [] }

  for (const response of parseMultistatus(xml)) {
    const href = extractString(response.href)
    if (!href) continue

    if (response.status?.includes('404')) {
      result.removed.push(href)
      continue
    }

    let etag: string | undefined
    for (const prop of getSuccessfulProps(response)) {
      etag ??= extractString(prop['getetag'])
    }
    // Members without ETag (e.g. a 507 for truncated results) are ignored
    if (etag) {
      result.changed.push({ href, etag: etag.replace(/"/g, '') })
    }
  }

  return result
}

function extractString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && '#text' in value) {
    return String((value as { '#text': unknown })['#text'])
  }
  return undefined
}
