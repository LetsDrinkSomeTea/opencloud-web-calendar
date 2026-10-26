import { describe, it, expect, vi, afterEach } from 'vitest'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { eventMatchesQuery, normalizeSearchText, uniqueEvents } from '../../src/utils/search'
import { buildCalendarTextSearchQuery } from '../../src/caldav/xml-builder'
import { searchEvents, serverSearchTerm } from '../../src/caldav/search'
import type { Calendar, CalendarEvent } from '../../src/types/calendar'
import { fetchCall, mockFetch, multistatus } from './caldav/fetch-mock'

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAuthStore: () => ({ accessToken: 'test-token' }),
  useUserStore: () => ({ user: null as unknown })
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('normalizeSearchText', () => {
  it.each([
    ['Müller', 'muller'],
    ['MÜLLER', 'muller'],
    ['Café Zentral', 'cafe zentral'],
    ['Crème Brûlée', 'creme brulee'],
    ['Straße', 'strasse'],
    ['Søren Ærø', 'soren aero'],
    ['Łódź', 'lodz'],
    ['  two   spaces ', 'two spaces']
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeSearchText(input)).toBe(expected)
  })
})

describe('eventMatchesQuery', () => {
  const event = {
    summary: 'Treffen mit Müller',
    location: 'Café Zentral, Wien',
    description: 'Agenda: Budget 2027'
  }

  it.each(['muller', 'MÜLLER', 'mü', 'cafe', 'CAFÉ', 'budget', 'wien'])(
    'matches %j case and diacritics insensitive',
    (query) => {
      expect(eventMatchesQuery(event, query)).toBe(true)
    }
  )

  it('requires every word, in any order and property', () => {
    expect(eventMatchesQuery(event, 'zentral müller')).toBe(true)
    expect(eventMatchesQuery(event, 'müller schmidt')).toBe(false)
  })

  it('matches everything for an empty query', () => {
    expect(eventMatchesQuery(event, '   ')).toBe(true)
  })

  it('handles missing location and description', () => {
    expect(eventMatchesQuery({ summary: 'Zahnarzt' }, 'zahn')).toBe(true)
    expect(eventMatchesQuery({ summary: 'Zahnarzt' }, 'wien')).toBe(false)
  })
})

describe('uniqueEvents', () => {
  it('keeps one entry per calendar, uid and occurrence', () => {
    const base = { calendarHref: '/cal/a/', uid: 'u1' } as CalendarEvent
    const events = [
      base,
      { ...base },
      { ...base, recurrenceId: '20261026T100000Z' },
      { ...base, calendarHref: '/cal/b/' }
    ]
    expect(uniqueEvents(events)).toHaveLength(3)
  })
})

describe('server search', () => {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

  it('builds a text-match query within a time range', () => {
    const xml = buildCalendarTextSearchQuery(
      'SUMMARY',
      'Müller & <Co>',
      new Date('2025-10-26T00:00:00Z'),
      new Date('2027-10-27T00:00:00Z')
    )
    expect(XMLValidator.validate(xml)).toBe(true)
    const vevent =
      parser.parse(xml)['c:calendar-query']['c:filter']['c:comp-filter']['c:comp-filter']
    expect(vevent['c:time-range']).toEqual({
      '@_start': '20251026T000000Z',
      '@_end': '20271027T000000Z'
    })
    expect(vevent['c:prop-filter']['@_name']).toBe('SUMMARY')
    expect(vevent['c:prop-filter']['c:text-match']).toEqual({
      '#text': 'Müller & <Co>',
      '@_collation': 'i;unicode-casemap'
    })
  })

  it('sends the longest word of the query', () => {
    expect(serverSearchTerm('  team Müller  ')).toBe('Müller')
    expect(serverSearchTerm('')).toBe('')
  })

  function eventResponse(uid: string, summary: string, location = '') {
    return multistatus(`<?xml version='1.0' encoding='utf-8'?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <response>
    <href>/caldav/alice/work/${uid}.ics</href>
    <propstat>
      <prop>
        <getetag>"${uid}"</getetag>
        <C:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
PRODID:test
BEGIN:VEVENT
UID:${uid}
DTSTAMP:20260101T000000Z
DTSTART:20270115T100000Z
DTEND:20270115T110000Z
SUMMARY:${summary}
LOCATION:${location}
END:VEVENT
END:VCALENDAR
</C:calendar-data>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`)
  }

  const empty = () =>
    multistatus(`<?xml version='1.0' encoding='utf-8'?><multistatus xmlns="DAV:"/>`)

  it('queries every searched property of the visible calendars and merges the results', async () => {
    const calendars: Calendar[] = [
      { href: '/caldav/alice/work/', displayName: 'Work', color: '#f00', ctag: '', visible: true },
      { href: '/caldav/alice/hidden/', displayName: 'X', color: '#0f0', ctag: '', visible: false }
    ]
    const fetchMock = mockFetch(
      // SUMMARY, LOCATION, DESCRIPTION
      eventResponse('e1', 'Team Müller'),
      eventResponse('e1', 'Team Müller'),
      // Matches the server term but not every word of the query
      eventResponse('e2', 'Müller only')
    )

    const results = await searchEvents(calendars, 'team müller', {
      start: new Date('2026-01-01T00:00:00Z'),
      end: new Date('2028-01-01T00:00:00Z')
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    const bodies = fetchMock.mock.calls.map((_, i) => String(fetchCall(fetchMock, i).init.body))
    expect(bodies.map((b) => /prop-filter name="(\w+)"/.exec(b)?.[1])).toEqual([
      'SUMMARY',
      'LOCATION',
      'DESCRIPTION'
    ])
    expect(bodies.every((b) => b.includes('>müller</c:text-match>'))).toBe(true)
    expect(fetchCall(fetchMock).url).toContain('/caldav/alice/work/')
    expect(fetchCall(fetchMock).init.method).toBe('REPORT')

    expect(results.map((e) => [e.uid, e.summary, e.href])).toEqual([
      ['e1', 'Team Müller', '/caldav/alice/work/e1.ics']
    ])
  })

  it('returns nothing without calendars or query', async () => {
    const fetchMock = mockFetch(empty())
    await expect(searchEvents([], 'x', { start: new Date(), end: new Date() })).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
