import { describe, it, expect, vi, afterEach } from 'vitest'
import { createCalDAVClient, getCalDAVClient } from '../../../src/caldav/client'
import { NetworkError } from '../../../src/caldav/errors'
import type { Calendar } from '../../../src/types/calendar'
import { mockFetch, fetchCall, multistatus } from './fetch-mock'

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAuthStore: () => ({ accessToken: 'test-token' }),
  useUserStore: () => ({ user: null as unknown })
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

const range = { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-11-01T00:00:00Z') }

function calendar(href: string, visible = true): Calendar {
  return { href, displayName: href, color: '#000', ctag: '', visible }
}

function eventsResponse(href: string, uid: string) {
  return multistatus(`<?xml version='1.0' encoding='utf-8'?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <response>
    <href>${href}${uid}.ics</href>
    <propstat>
      <prop>
        <getetag>"${uid}-etag"</getetag>
        <C:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:${uid}
DTSTAMP:20260101T000000Z
DTSTART:20261026T100000Z
DTEND:20261026T110000Z
SUMMARY:${uid}
END:VEVENT
END:VCALENDAR
</C:calendar-data>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`)
}

describe('fetchAllEvents', () => {
  it('queries only visible calendars and merges their events', async () => {
    const fetchMock = mockFetch(
      eventsResponse('/caldav/alice/a/', 'a1'),
      eventsResponse('/caldav/alice/c/', 'c1')
    )

    const events = await createCalDAVClient().fetchAllEvents(
      [
        calendar('/caldav/alice/a/'),
        calendar('/caldav/alice/b/', false),
        calendar('/caldav/alice/c/')
      ],
      range
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchCall(fetchMock, 0).url).toBe('/caldav/alice/a/')
    expect(fetchCall(fetchMock, 1).url).toBe('/caldav/alice/c/')
    expect(events.map((e) => [e.uid, e.calendarHref])).toEqual([
      ['a1', '/caldav/alice/a/'],
      ['c1', '/caldav/alice/c/']
    ])
  })

  it('sends no request without visible calendars', async () => {
    const fetchMock = mockFetch()
    await expect(
      createCalDAVClient().fetchAllEvents([calendar('/caldav/alice/a/', false)], range)
    ).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails when one calendar fails', async () => {
    mockFetch(eventsResponse('/caldav/alice/a/', 'a1'), new TypeError('Failed to fetch'))
    await expect(
      createCalDAVClient().fetchAllEvents(
        [calendar('/caldav/alice/a/'), calendar('/caldav/alice/b/')],
        range
      )
    ).rejects.toBeInstanceOf(NetworkError)
  })
})

describe('getCalDAVClient', () => {
  it('returns a singleton exposing the data layer operations', () => {
    const client = getCalDAVClient()
    expect(getCalDAVClient()).toBe(client)
    for (const method of [
      'discoverCalendars',
      'refreshCalendars',
      'fetchEvents',
      'fetchEventResources',
      'multigetEventResources',
      'fetchCollectionState',
      'syncCollection',
      'queryFreeBusy',
      'createEvent',
      'updateEvent',
      'deleteEvent',
      'updateEventOccurrence',
      'deleteEventOccurrence',
      'updateEventSeries',
      'createCalendar',
      'deleteCalendar',
      'listShares'
    ] as const) {
      expect(typeof client[method]).toBe('function')
    }
  })
})
