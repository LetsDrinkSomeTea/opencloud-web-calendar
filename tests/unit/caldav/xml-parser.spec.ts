import { describe, it, expect } from 'vitest'
import {
  parseMultistatus,
  parseCurrentUserPrincipal,
  parseCalendarHomeSet,
  parseCalendars,
  parseEvents
} from '../../../src/caldav/xml-parser'
import {
  PRINCIPAL_RESPONSE,
  UNAUTHENTICATED_PRINCIPAL_RESPONSE,
  CALENDAR_HOME_RESPONSE,
  CALENDARS_RESPONSE,
  EVENTS_RESPONSE
} from './fixtures'

const multistatus = (body: string) =>
  `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">${body}</d:multistatus>`

describe('parseMultistatus', () => {
  it('returns an array even for a single response', () => {
    const responses = parseMultistatus(PRINCIPAL_RESPONSE)
    expect(responses).toHaveLength(1)
    expect(responses[0].href).toBe('/caldav/')
  })

  it('returns an empty array for an empty multistatus', () => {
    expect(parseMultistatus(multistatus(''))).toEqual([])
  })

  it('returns an empty array for non-multistatus documents', () => {
    expect(parseMultistatus('<?xml version="1.0"?><d:error xmlns:d="DAV:"/>')).toEqual([])
  })

  it('strips namespace prefixes', () => {
    const responses = parseMultistatus(
      multistatus('<d:response><d:href>/caldav/x/</d:href></d:response>')
    )
    expect(responses[0].href).toBe('/caldav/x/')
  })
})

describe('parseCurrentUserPrincipal', () => {
  it('extracts the principal href', () => {
    expect(parseCurrentUserPrincipal(PRINCIPAL_RESPONSE)).toBe('/caldav/alice/')
  })

  it('returns null for an unauthenticated principal', () => {
    expect(parseCurrentUserPrincipal(UNAUTHENTICATED_PRINCIPAL_RESPONSE)).toBeNull()
  })

  it('returns null for an empty multistatus', () => {
    expect(parseCurrentUserPrincipal(multistatus(''))).toBeNull()
  })

  it('finds the principal when the 404 propstat comes first', () => {
    const xml = multistatus(`
      <d:response>
        <d:href>/caldav/</d:href>
        <d:propstat><d:prop><d:displayname/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>
        <d:propstat>
          <d:prop><d:current-user-principal><d:href>/caldav/bob/</d:href></d:current-user-principal></d:prop>
          <d:status>HTTP/1.1 200 OK</d:status>
        </d:propstat>
      </d:response>`)
    expect(parseCurrentUserPrincipal(xml)).toBe('/caldav/bob/')
  })
})

describe('parseCalendarHomeSet', () => {
  it('extracts the calendar home href', () => {
    expect(parseCalendarHomeSet(CALENDAR_HOME_RESPONSE)).toBe('/caldav/alice/')
  })

  it('returns null if the property is missing', () => {
    expect(parseCalendarHomeSet(PRINCIPAL_RESPONSE)).toBeNull()
  })
})

describe('parseCalendars', () => {
  const calendars = parseCalendars(CALENDARS_RESPONSE)

  it('only returns calendar collections', () => {
    expect(calendars.map((c) => c.href)).toEqual([
      '/caldav/alice/personal/',
      '/caldav/alice/shared-ro/'
    ])
  })

  it('reads the calendar properties and decodes entities', () => {
    expect(calendars[0]).toEqual({
      href: '/caldav/alice/personal/',
      displayName: 'Personal',
      color: '#FF5733FF',
      ctag: '"3a1f0d9c2b7e4f6a8d5c"',
      description: 'My & your events',
      readOnly: false
    })
  })

  it('ignores properties from non-200 propstats', () => {
    expect(calendars[1].description).toBeUndefined()
    expect(calendars[1].color).toBeUndefined()
  })

  it('marks calendars without write privilege as read only', () => {
    expect(calendars[1].readOnly).toBe(true)
  })

  it('treats DAV:all as writable', () => {
    const xml = multistatus(`
      <d:response>
        <d:href>/caldav/alice/all/</d:href>
        <d:propstat>
          <d:prop>
            <d:resourcetype><d:collection/><c:calendar xmlns:c="urn:ietf:params:xml:ns:caldav"/></d:resourcetype>
            <d:current-user-privilege-set><d:privilege><d:all/></d:privilege></d:current-user-privilege-set>
          </d:prop>
          <d:status>HTTP/1.1 200 OK</d:status>
        </d:propstat>
      </d:response>`)
    expect(parseCalendars(xml)[0].readOnly).toBe(false)
  })

  it('defaults to writable when no privilege set is returned', () => {
    const xml = multistatus(`
      <d:response>
        <d:href>/caldav/alice/plain/</d:href>
        <d:propstat>
          <d:prop>
            <d:resourcetype><d:collection/><c:calendar xmlns:c="urn:ietf:params:xml:ns:caldav"/></d:resourcetype>
          </d:prop>
          <d:status>HTTP/1.1 200 OK</d:status>
        </d:propstat>
      </d:response>`)
    expect(parseCalendars(xml)).toEqual([
      {
        href: '/caldav/alice/plain/',
        displayName: undefined,
        color: undefined,
        ctag: undefined,
        description: undefined,
        readOnly: false
      }
    ])
  })

  it('keeps numeric and boolean looking values as strings', () => {
    const xml = multistatus(`
      <d:response>
        <d:href>/caldav/alice/2024/</d:href>
        <d:propstat>
          <d:prop>
            <d:resourcetype><d:collection/><c:calendar xmlns:c="urn:ietf:params:xml:ns:caldav"/></d:resourcetype>
            <d:displayname>2024</d:displayname>
            <c:calendar-description xmlns:c="urn:ietf:params:xml:ns:caldav">true</c:calendar-description>
            <cs:getctag>00123</cs:getctag>
          </d:prop>
          <d:status>HTTP/1.1 200 OK</d:status>
        </d:propstat>
      </d:response>`)
    const [calendar] = parseCalendars(xml)
    expect(calendar.displayName).toBe('2024')
    expect(calendar.description).toBe('true')
    expect(calendar.ctag).toBe('00123')
  })

  it('skips responses without href', () => {
    const xml = multistatus(`
      <d:response>
        <d:propstat>
          <d:prop><d:resourcetype><c:calendar xmlns:c="urn:ietf:params:xml:ns:caldav"/></d:resourcetype></d:prop>
          <d:status>HTTP/1.1 200 OK</d:status>
        </d:propstat>
      </d:response>`)
    expect(parseCalendars(xml)).toEqual([])
  })
})

describe('parseEvents', () => {
  it('returns events with etag and calendar data', () => {
    const events = parseEvents(EVENTS_RESPONSE)
    expect(events).toHaveLength(1)
    expect(events[0].href).toBe('/caldav/alice/personal/event-1.ics')
    expect(events[0].etag).toBe('e1a2b3')
    expect(events[0].calendarData).toContain('BEGIN:VCALENDAR')
    expect(events[0].calendarData).toContain('SUMMARY:Lunch & Learn')
  })

  it('returns an empty list for an empty multistatus', () => {
    expect(parseEvents(multistatus(''))).toEqual([])
  })
})
