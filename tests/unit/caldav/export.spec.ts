import { describe, it, expect, vi, afterEach } from 'vitest'
import ICAL from 'ical.js'
import { exportCalendar, mergeCalendarObjects } from '../../../src/caldav/export'
import { mockFetch, fetchCall, multistatus, respond } from './fetch-mock'

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAuthStore: () => ({ accessToken: 'test-token' }),
  useUserStore: () => ({ user: null as unknown })
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

const BERLIN = `BEGIN:VTIMEZONE
TZID:Europe/Berlin
BEGIN:STANDARD
DTSTART:19701025T030000
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19700329T020000
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
END:VTIMEZONE`

const NEW_YORK = `BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:STANDARD
DTSTART:19701101T020000
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE`

function object(body: string, timezones: string[] = []) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    ...timezones,
    body,
    'END:VCALENDAR'
  ]
    .join('\n')
    .replace(/\r?\n/g, '\r\n')
}

const event1 = object(
  `BEGIN:VEVENT
UID:one
DTSTAMP:20260101T000000Z
DTSTART;TZID=Europe/Berlin:20260310T090000
SUMMARY:One
END:VEVENT`,
  [BERLIN]
)
const event2 = object(
  `BEGIN:VEVENT
UID:two
DTSTAMP:20260101T000000Z
DTSTART;TZID=Europe/Berlin:20260311T090000
RRULE:FREQ=DAILY;COUNT=3
SUMMARY:Two
END:VEVENT
BEGIN:VEVENT
UID:two
DTSTAMP:20260101T000000Z
RECURRENCE-ID;TZID=Europe/Berlin:20260312T090000
DTSTART;TZID=America/New_York:20260312T090000
SUMMARY:Two (moved)
END:VEVENT`,
  [BERLIN, NEW_YORK]
)
const task = object(`BEGIN:VTODO
UID:task
DTSTAMP:20260101T000000Z
SUMMARY:Task
END:VTODO`)

describe('mergeCalendarObjects', () => {
  it('merges all objects into one VCALENDAR and deduplicates VTIMEZONEs by TZID', () => {
    const result = mergeCalendarObjects([event1, event2, task], {
      displayName: 'Work',
      description: 'Office',
      color: '#ff0000'
    })
    expect(result.objectCount).toBe(3)
    expect(result.skipped).toBe(0)

    const merged = new ICAL.Component(ICAL.parse(result.ics))
    expect(merged.name).toBe('vcalendar')
    expect(merged.getFirstPropertyValue('version')).toBe('2.0')
    expect(merged.getFirstPropertyValue('x-wr-calname')).toBe('Work')
    expect(merged.getFirstPropertyValue('x-wr-caldesc')).toBe('Office')
    expect(merged.getFirstPropertyValue('x-apple-calendar-color')).toBe('#ff0000')

    const tzids = merged
      .getAllSubcomponents('vtimezone')
      .map((tz) => tz.getFirstPropertyValue('tzid'))
    expect(tzids).toEqual(['Europe/Berlin', 'America/New_York'])

    const events = merged.getAllSubcomponents('vevent')
    expect(events.map((e) => e.getFirstPropertyValue('uid'))).toEqual(['one', 'two', 'two'])
    expect(events[2].hasProperty('recurrence-id')).toBe(true)
    expect(merged.getAllSubcomponents('vtodo')).toHaveLength(1)
    // VTIMEZONEs come before the other components
    expect(result.ics.indexOf('BEGIN:VTIMEZONE')).toBeLessThan(result.ics.indexOf('BEGIN:VEVENT'))
  })

  it('skips objects that cannot be parsed', () => {
    const result = mergeCalendarObjects(['garbage', event1])
    expect(result.objectCount).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.ics).toContain('UID:one')
    expect(result.ics).not.toContain('X-WR-CALNAME')
  })

  it('returns an empty but valid calendar for no objects', () => {
    const result = mergeCalendarObjects([])
    const merged = new ICAL.Component(ICAL.parse(result.ics))
    expect(merged.getAllSubcomponents()).toHaveLength(0)
  })
})

describe('exportCalendar', () => {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

  it('fetches all objects with a REPORT and merges them', async () => {
    const fetchMock = mockFetch(
      multistatus(`<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/caldav/alice/work/one.ics</d:href>
    <d:propstat>
      <d:prop><d:getetag>"1"</d:getetag><c:calendar-data>${escape(event1)}</c:calendar-data></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/caldav/alice/work/two.ics</d:href>
    <d:propstat>
      <d:prop><d:getetag>"2"</d:getetag><c:calendar-data>${escape(event2)}</c:calendar-data></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`)
    )

    const result = await exportCalendar('/caldav/alice/work/', { displayName: 'Work' })

    const { url, init } = fetchCall(fetchMock)
    expect(url).toBe('/caldav/alice/work/')
    expect(init.method).toBe('REPORT')
    expect(new Headers(init.headers).get('Depth')).toBe('1')
    expect(init.body).not.toContain('time-range')
    expect(result.objectCount).toBe(2)
    expect(result.ics.match(/TZID:Europe\/Berlin/g)).toHaveLength(1)
  })

  it('throws on errors', async () => {
    mockFetch(respond({ status: 500, statusText: 'Server Error' }))
    await expect(exportCalendar('/caldav/alice/work/')).rejects.toMatchObject({ status: 500 })
  })
})
