import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  createEvent,
  deleteEvent,
  deleteEventOccurrence,
  fetchCollectionState,
  fetchEventResources,
  fetchEvents,
  fetchSingleEvent,
  multigetEventResources,
  MULTIGET_BATCH_SIZE,
  overlapsRange,
  resourceHref,
  syncCollection,
  updateEvent,
  updateEventOccurrence,
  updateEventSeries
} from '../../../src/caldav/events'
import { parseICS } from '../../../src/caldav/ics-utils'
import {
  AuthenticationError,
  CalDAVError,
  ConflictError,
  InvalidSyncTokenError,
  NetworkError,
  NotFoundError
} from '../../../src/caldav/errors'
import type { CalendarEvent, EventFormData } from '../../../src/types/calendar'
import { mockFetch, fetchCall, multistatus, respond } from './fetch-mock'

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAuthStore: () => ({ accessToken: 'test-token' }),
  useUserStore: () => ({ user: null as unknown })
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

const CAL = '/caldav/alice/personal/'
const range = { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-11-01T00:00:00Z') }

function ics(uid: string, dtstart: string, dtend: string, extra = ''): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//test//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20260101T000000Z',
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${uid}`,
    ...(extra ? [extra] : []),
    'END:VEVENT',
    'END:VCALENDAR',
    ''
  ].join('\r\n')
}

function eventResponse(href: string, etag: string, data: string): string {
  return `<response>
    <href>${href}</href>
    <propstat>
      <prop>
        <getetag>"${etag}"</getetag>
        <C:calendar-data>${data}</C:calendar-data>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>`
}

function eventsMultistatus(...responses: string[]): Response {
  return multistatus(`<?xml version='1.0' encoding='utf-8'?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">${responses.join('')}</multistatus>`)
}

const SIMPLE_ICS = ics('e1', '20261026T100000Z', '20261026T110000Z')
const WEEKLY_ICS = ics('w1', '20261005T100000Z', '20261005T110000Z', 'RRULE:FREQ=WEEKLY;COUNT=10')

function formData(overrides: Partial<EventFormData> = {}): EventFormData {
  return {
    calendarHref: CAL,
    summary: 'Meeting',
    start: new Date('2026-10-26T10:00:00Z'),
    end: new Date('2026-10-26T11:00:00Z'),
    allDay: false,
    description: '',
    location: '',
    ...overrides
  }
}

function existingEvent(icsData = SIMPLE_ICS, etag = 'etag-1'): CalendarEvent {
  return parseICS(icsData, `${CAL}e1.ics`, etag)[0]
}

describe('helpers', () => {
  it('resolves member hrefs against the requested calendar href', () => {
    expect(resourceHref('/caldav/bob/alice-shared/', '/caldav/alice/personal/e1.ics')).toBe(
      '/caldav/bob/alice-shared/e1.ics'
    )
    expect(resourceHref('/caldav/bob/cal', '/x/e1.ics')).toBe('/caldav/bob/cal/e1.ics')
  })

  it.each([
    ['inside', '2026-10-10T10:00:00Z', '2026-10-10T11:00:00Z', true],
    ['overlapping the start', '2026-09-30T23:00:00Z', '2026-10-01T01:00:00Z', true],
    ['ending at the start', '2026-09-30T23:00:00Z', '2026-10-01T00:00:00Z', false],
    ['starting at the end', '2026-11-01T00:00:00Z', '2026-11-01T01:00:00Z', false],
    ['zero length inside', '2026-10-10T10:00:00Z', '2026-10-10T10:00:00Z', true],
    ['zero length at the start', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z', true]
  ])('overlapsRange: %s', (_, start, end, expected) => {
    expect(overlapsRange({ start: new Date(start), end: new Date(end) }, range)).toBe(expected)
  })
})

describe('fetchEvents', () => {
  it('sends a time-range calendar-query and expands recurring events', async () => {
    const fetchMock = mockFetch(
      eventsMultistatus(
        eventResponse(`${CAL}e1.ics`, 'etag-1', SIMPLE_ICS),
        eventResponse(`${CAL}w1.ics`, 'etag-w', WEEKLY_ICS)
      )
    )

    const events = await fetchEvents(CAL, range)

    const { url, init } = fetchCall(fetchMock)
    expect(url).toBe(CAL)
    expect(init.method).toBe('REPORT')
    expect(new Headers(init.headers).get('Depth')).toBe('1')
    expect(init.body).toContain('calendar-query')
    expect(init.body).toContain('start="20261001T000000Z" end="20261101T000000Z"')

    expect(events.filter((e) => e.uid === 'e1')).toHaveLength(1)
    // All Mondays of October 2026 out of the ten occurrences
    const weekly = events.filter((e) => e.uid === 'w1')
    expect(weekly.map((e) => e.start.toISOString())).toEqual([
      '2026-10-05T10:00:00.000Z',
      '2026-10-12T10:00:00.000Z',
      '2026-10-19T10:00:00.000Z',
      '2026-10-26T10:00:00.000Z'
    ])
    expect(weekly.every((e) => e.etag === 'etag-w')).toBe(true)
  })

  it('groups events by resource and keeps the requested (shared) calendar path', async () => {
    mockFetch(
      eventsMultistatus(eventResponse('/caldav/alice/personal/e1.ics', 'etag-1', SIMPLE_ICS))
    )

    const [resource] = await fetchEventResources('/caldav/bob/alice-shared/', range)

    expect(resource.href).toBe('/caldav/bob/alice-shared/e1.ics')
    expect(resource.etag).toBe('etag-1')
    expect(resource.events[0]).toMatchObject({
      href: '/caldav/bob/alice-shared/e1.ics',
      calendarHref: '/caldav/bob/alice-shared/'
    })
  })

  it.each([
    [401, AuthenticationError],
    [404, NotFoundError],
    [500, CalDAVError]
  ])('maps HTTP %i to %o', async (status, errorClass) => {
    mockFetch(respond({ status }))
    await expect(fetchEvents(CAL, range)).rejects.toBeInstanceOf(errorClass)
  })

  it('reports network failures as NetworkError', async () => {
    mockFetch(new TypeError('Failed to fetch'))
    await expect(fetchEvents(CAL, range)).rejects.toBeInstanceOf(NetworkError)
  })
})

describe('createEvent', () => {
  it('PUTs a new resource with If-None-Match and returns the ETag', async () => {
    const fetchMock = mockFetch(respond({ status: 201, headers: { ETag: '"new-etag"' } }))

    const event = await createEvent(formData())

    const { url, init } = fetchCall(fetchMock)
    const headers = new Headers(init.headers)
    expect(init.method).toBe('PUT')
    expect(url).toBe(`${CAL}${event.uid}.ics`)
    expect(headers.get('If-None-Match')).toBe('*')
    expect(headers.get('Content-Type')).toContain('text/calendar')
    expect(String(init.body)).toContain(`UID:${event.uid}`)
    expect(event).toMatchObject({ etag: 'new-etag', href: url, summary: 'Meeting' })
  })

  it('throws a ConflictError when the resource already exists', async () => {
    mockFetch(respond({ status: 412 }))
    await expect(createEvent(formData())).rejects.toBeInstanceOf(ConflictError)
  })

  it('throws AuthenticationError on 401', async () => {
    mockFetch(respond({ status: 401 }))
    await expect(createEvent(formData())).rejects.toBeInstanceOf(AuthenticationError)
  })
})

describe('updateEvent', () => {
  it('PUTs with If-Match and returns the new ETag', async () => {
    const fetchMock = mockFetch(respond({ status: 204, headers: { ETag: '"etag-2"' } }))

    const updated = await updateEvent(existingEvent(), formData({ summary: 'Renamed' }))

    const { url, init } = fetchCall(fetchMock)
    expect(url).toBe(`${CAL}e1.ics`)
    expect(init.method).toBe('PUT')
    expect(new Headers(init.headers).get('If-Match')).toBe('"etag-1"')
    expect(String(init.body)).toContain('SUMMARY:Renamed')
    expect(String(init.body)).toContain('UID:e1')
    expect(updated).toMatchObject({ etag: 'etag-2', summary: 'Renamed' })
  })

  it('keeps the old ETag when the server does not return one', async () => {
    mockFetch(respond({ status: 204 }))
    await expect(updateEvent(existingEvent(), formData())).resolves.toMatchObject({
      etag: 'etag-1'
    })
  })

  it('throws a ConflictError with the sent ETag on 412', async () => {
    mockFetch(respond({ status: 412 }))
    const err = await updateEvent(existingEvent(), formData()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConflictError)
    expect((err as ConflictError).status).toBe(412)
    expect((err as ConflictError).serverEtag).toBe('etag-1')
  })

  it('throws NotFoundError on 404', async () => {
    mockFetch(respond({ status: 404 }))
    await expect(updateEvent(existingEvent(), formData())).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('deleteEvent', () => {
  it('DELETEs with If-Match', async () => {
    const fetchMock = mockFetch(respond({ status: 204 }))
    await deleteEvent(existingEvent())
    const { url, init } = fetchCall(fetchMock)
    expect(url).toBe(`${CAL}e1.ics`)
    expect(init.method).toBe('DELETE')
    expect(new Headers(init.headers).get('If-Match')).toBe('"etag-1"')
  })

  it('treats an already deleted resource as success', async () => {
    mockFetch(respond({ status: 404 }))
    await expect(deleteEvent(existingEvent())).resolves.toBeUndefined()
  })

  it('throws a ConflictError on 412', async () => {
    mockFetch(respond({ status: 412 }))
    await expect(deleteEvent(existingEvent())).rejects.toBeInstanceOf(ConflictError)
  })

  it('throws CalDAVError on other failures', async () => {
    mockFetch(respond({ status: 500, statusText: 'Internal Server Error' }))
    await expect(deleteEvent(existingEvent())).rejects.toThrow('Internal Server Error')
  })
})

describe('occurrence and series operations', () => {
  const series = () => existingEvent(WEEKLY_ICS, 'etag-w')
  const recurrenceId = '2026-10-12T10:00:00Z'

  it('updateEventOccurrence adds an override with RECURRENCE-ID', async () => {
    const fetchMock = mockFetch(respond({ status: 204 }))
    await updateEventOccurrence(
      series(),
      recurrenceId,
      formData({
        summary: 'Moved',
        start: new Date('2026-10-12T12:00:00Z'),
        end: new Date('2026-10-12T13:00:00Z')
      })
    )
    const { init } = fetchCall(fetchMock)
    const body = String(init.body)
    expect(init.method).toBe('PUT')
    expect(new Headers(init.headers).get('If-Match')).toBe('"etag-w"')
    expect(body).toContain('RRULE:FREQ=WEEKLY')
    expect(body).toMatch(/RECURRENCE-ID[^:]*:20261012T100000Z/)
    expect(body).toContain('SUMMARY:Moved')
  })

  it('deleteEventOccurrence adds an EXDATE', async () => {
    const fetchMock = mockFetch(respond({ status: 204 }))
    await deleteEventOccurrence(series(), recurrenceId)
    const body = String(fetchCall(fetchMock).init.body)
    expect(body).toMatch(/EXDATE[^:]*:20261012T100000Z/)
    expect(new Headers(fetchCall(fetchMock).init.headers).get('If-Match')).toBe('"etag-w"')
  })

  it('updateEventSeries rewrites the master', async () => {
    const fetchMock = mockFetch(respond({ status: 204 }))
    await updateEventSeries(
      series(),
      formData({
        summary: 'Weekly sync',
        start: new Date('2026-10-05T10:00:00Z'),
        end: new Date('2026-10-05T11:00:00Z'),
        recurrence: { frequency: 'WEEKLY', interval: 1, endType: 'never' }
      })
    )
    const body = String(fetchCall(fetchMock).init.body)
    expect(body).toContain('SUMMARY:Weekly sync')
    expect(body).toContain('UID:w1')
  })

  it.each([
    ['updateEventOccurrence', () => updateEventOccurrence(series(), recurrenceId, formData())],
    ['deleteEventOccurrence', () => deleteEventOccurrence(series(), recurrenceId)],
    ['updateEventSeries', () => updateEventSeries(series(), formData())]
  ])('%s throws a ConflictError on 412', async (_, operation) => {
    mockFetch(respond({ status: 412 }))
    const err = await operation().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConflictError)
    expect((err as ConflictError).serverEtag).toBe('etag-w')
  })

  it.each([
    ['updateEventOccurrence', () => updateEventOccurrence(series(), recurrenceId, formData())],
    ['deleteEventOccurrence', () => deleteEventOccurrence(series(), recurrenceId)],
    ['updateEventSeries', () => updateEventSeries(series(), formData())]
  ])('%s throws AuthenticationError on 401', async (_, operation) => {
    mockFetch(respond({ status: 401 }))
    await expect(operation()).rejects.toBeInstanceOf(AuthenticationError)
  })
})

describe('fetchSingleEvent', () => {
  it('GETs and parses the resource', async () => {
    const fetchMock = mockFetch(
      respond({ status: 200, body: SIMPLE_ICS, headers: { ETag: '"etag-9"' } })
    )
    const event = await fetchSingleEvent(`${CAL}e1.ics`)
    expect(fetchCall(fetchMock).init.method).toBe('GET')
    expect(event).toMatchObject({ uid: 'e1', etag: 'etag-9', href: `${CAL}e1.ics` })
  })

  it('returns null for a missing resource', async () => {
    mockFetch(respond({ status: 404 }))
    await expect(fetchSingleEvent(`${CAL}gone.ics`)).resolves.toBeNull()
  })
})

const SYNC_RESPONSE = `<?xml version='1.0' encoding='utf-8'?>
<multistatus xmlns="DAV:">
  <sync-token>http://radicale.org/ns/sync/new</sync-token>
  <response>
    <href>/caldav/alice/personal/e1.ics</href>
    <status>HTTP/1.1 404 Not Found</status>
  </response>
  <response>
    <href>/caldav/alice/personal/e2.ics</href>
    <propstat>
      <prop><getetag>"etag-2"</getetag></prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`

describe('syncCollection', () => {
  it('sends a sync-collection REPORT and returns changed and removed hrefs', async () => {
    const fetchMock = mockFetch(multistatus(SYNC_RESPONSE))

    const result = await syncCollection(
      '/caldav/bob/alice-shared/',
      'http://radicale.org/ns/sync/old'
    )

    const { url, init } = fetchCall(fetchMock)
    expect(url).toBe('/caldav/bob/alice-shared/')
    expect(init.method).toBe('REPORT')
    expect(new Headers(init.headers).get('Depth')).toBe('0')
    expect(init.body).toContain('<d:sync-token>http://radicale.org/ns/sync/old</d:sync-token>')
    expect(init.body).toContain('<d:sync-level>1</d:sync-level>')
    expect(result).toEqual({
      syncToken: 'http://radicale.org/ns/sync/new',
      changed: [{ href: '/caldav/bob/alice-shared/e2.ics', etag: 'etag-2' }],
      removed: ['/caldav/bob/alice-shared/e1.ics']
    })
  })

  it.each([
    ['Radicale (403)', 403],
    ['RFC 6578 (409)', 409]
  ])('throws InvalidSyncTokenError for valid-sync-token errors: %s', async (_, status) => {
    mockFetch(
      respond({
        status,
        body: `<?xml version='1.0' encoding='utf-8'?><error xmlns="DAV:"><valid-sync-token /></error>`
      })
    )
    await expect(syncCollection(CAL, 'bad')).rejects.toBeInstanceOf(InvalidSyncTokenError)
  })

  it('throws InvalidSyncTokenError on 412', async () => {
    mockFetch(respond({ status: 412 }))
    await expect(syncCollection(CAL, 'bad')).rejects.toBeInstanceOf(InvalidSyncTokenError)
  })

  it('throws a plain CalDAVError when the report is not supported', async () => {
    mockFetch(
      respond({
        status: 403,
        body: `<?xml version='1.0' encoding='utf-8'?><error xmlns="DAV:"><supported-report /></error>`
      })
    )
    const err = await syncCollection(CAL, 'token').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CalDAVError)
    expect(err).not.toBeInstanceOf(InvalidSyncTokenError)
  })

  it('rejects responses without a new sync token', async () => {
    mockFetch(multistatus(`<multistatus xmlns="DAV:"></multistatus>`))
    await expect(syncCollection(CAL, 'token')).rejects.toThrow('without sync-token')
  })
})

describe('multigetEventResources', () => {
  it('fetches the hrefs with calendar-multiget and keeps out-of-range resources empty', async () => {
    const outside = ics('e3', '20261205T100000Z', '20261205T110000Z')
    const fetchMock = mockFetch(
      eventsMultistatus(
        eventResponse(`${CAL}e1.ics`, 'etag-1', SIMPLE_ICS),
        eventResponse(`${CAL}e3.ics`, 'etag-3', outside),
        `<response><href>${CAL}gone.ics</href><status>HTTP/1.1 404 Not Found</status></response>`
      )
    )

    const resources = await multigetEventResources(
      CAL,
      [`${CAL}e1.ics`, `${CAL}e3.ics`, `${CAL}gone.ics`],
      range
    )

    const { init } = fetchCall(fetchMock)
    expect(init.method).toBe('REPORT')
    expect(init.body).toContain('calendar-multiget')
    expect(init.body).toContain(`<d:href>${CAL}e1.ics</d:href>`)
    expect(resources.map((r) => [r.href, r.events.length])).toEqual([
      [`${CAL}e1.ics`, 1],
      [`${CAL}e3.ics`, 0]
    ])
  })

  it('splits large requests into batches', async () => {
    const hrefs = Array.from({ length: MULTIGET_BATCH_SIZE + 1 }, (_, i) => `${CAL}${i}.ics`)
    const fetchMock = mockFetch(eventsMultistatus(), eventsMultistatus())

    await multigetEventResources(CAL, hrefs, range)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchCall(fetchMock, 1).init.body)).toContain(
      `<d:href>${CAL}${MULTIGET_BATCH_SIZE}.ics</d:href>`
    )
  })

  it('sends no request for an empty list', async () => {
    const fetchMock = mockFetch()
    await expect(multigetEventResources(CAL, [], range)).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('fetchCollectionState', () => {
  it('reads ctag and sync token with a Depth 0 PROPFIND', async () => {
    const fetchMock = mockFetch(
      multistatus(`<?xml version='1.0' encoding='utf-8'?>
<multistatus xmlns="DAV:" xmlns:CS="http://calendarserver.org/ns/">
  <response>
    <href>${CAL}</href>
    <propstat>
      <prop>
        <CS:getctag>"ctag-1"</CS:getctag>
        <sync-token>http://radicale.org/ns/sync/abc</sync-token>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`)
    )

    await expect(fetchCollectionState(CAL)).resolves.toEqual({
      ctag: '"ctag-1"',
      syncToken: 'http://radicale.org/ns/sync/abc'
    })
    const { init } = fetchCall(fetchMock)
    expect(init.method).toBe('PROPFIND')
    expect(new Headers(init.headers).get('Depth')).toBe('0')
  })
})
