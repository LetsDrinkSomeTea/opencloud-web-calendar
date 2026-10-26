import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  discoverUserPrincipal,
  discoverCalendarHome,
  listCalendars,
  discoverCalendars
} from '../../../src/caldav/discovery'
import { AuthenticationError, CalDAVError, NotFoundError } from '../../../src/caldav/errors'
import { mockFetch, fetchCall, multistatus, respond } from './fetch-mock'
import {
  PRINCIPAL_RESPONSE,
  UNAUTHENTICATED_PRINCIPAL_RESPONSE,
  CALENDAR_HOME_RESPONSE,
  CALENDARS_RESPONSE
} from './fixtures'

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAuthStore: () => ({ accessToken: 'test-token' }),
  useUserStore: () => ({ user: null as unknown })
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('discoverUserPrincipal', () => {
  it('sends a Depth 0 PROPFIND to the CalDAV root', async () => {
    const fetchMock = mockFetch(multistatus(PRINCIPAL_RESPONSE))

    await expect(discoverUserPrincipal()).resolves.toBe('/caldav/alice/')

    const { url, init } = fetchCall(fetchMock)
    const headers = new Headers(init.headers)
    expect(url).toBe('/caldav/')
    expect(init.method).toBe('PROPFIND')
    expect(headers.get('Depth')).toBe('0')
    expect(headers.get('Content-Type')).toContain('application/xml')
    expect(init.body).toContain('current-user-principal')
  })

  it('fails if the server returns no principal', async () => {
    mockFetch(multistatus(UNAUTHENTICATED_PRINCIPAL_RESPONSE))
    await expect(discoverUserPrincipal()).rejects.toThrow('Could not discover user principal')
  })

  it('throws AuthenticationError on 401', async () => {
    mockFetch(respond({ status: 401, statusText: 'Unauthorized' }))
    const error = await discoverUserPrincipal().catch((e) => e)
    expect(error).toBeInstanceOf(AuthenticationError)
    expect(error.status).toBe(401)
  })

  it('throws CalDAVError with status on 403', async () => {
    mockFetch(respond({ status: 403, statusText: 'Forbidden' }))
    const error = await discoverUserPrincipal().catch((e) => e)
    expect(error).toBeInstanceOf(CalDAVError)
    expect(error).not.toBeInstanceOf(AuthenticationError)
    expect(error.status).toBe(403)
    expect(error.message).toBe('PROPFIND failed: Forbidden')
  })

  it('throws CalDAVError on server errors', async () => {
    mockFetch(respond({ status: 502, statusText: 'Bad Gateway' }))
    await expect(discoverUserPrincipal()).rejects.toMatchObject({
      name: 'CalDAVError',
      status: 502
    })
  })

  it('propagates network errors', async () => {
    mockFetch(new TypeError('Failed to fetch'))
    await expect(discoverUserPrincipal()).rejects.toThrow('Failed to fetch')
  })
})

describe('discoverCalendarHome', () => {
  it('queries the principal for its calendar home set', async () => {
    const fetchMock = mockFetch(multistatus(CALENDAR_HOME_RESPONSE))

    await expect(discoverCalendarHome('/caldav/alice/')).resolves.toBe('/caldav/alice/')

    const { url, init } = fetchCall(fetchMock)
    expect(url).toBe('/caldav/alice/')
    expect(new Headers(init.headers).get('Depth')).toBe('0')
    expect(init.body).toContain('calendar-home-set')
  })

  it('throws NotFoundError on 404', async () => {
    mockFetch(respond({ status: 404, statusText: 'Not Found' }))
    const error = await discoverCalendarHome('/caldav/ghost/').catch((e) => e)
    expect(error).toBeInstanceOf(NotFoundError)
    expect(error.status).toBe(404)
    expect(error.message).toContain('/caldav/ghost/')
  })

  it('fails if the home set is missing', async () => {
    mockFetch(multistatus(PRINCIPAL_RESPONSE))
    await expect(discoverCalendarHome('/caldav/alice/')).rejects.toThrow(
      'Could not discover calendar home'
    )
  })
})

describe('listCalendars', () => {
  it('sends a Depth 1 PROPFIND and maps calendars', async () => {
    const fetchMock = mockFetch(multistatus(CALENDARS_RESPONSE))

    const calendars = await listCalendars('/caldav/alice/')

    expect(new Headers(fetchCall(fetchMock).init.headers).get('Depth')).toBe('1')
    expect(calendars).toEqual([
      {
        href: '/caldav/alice/personal/',
        displayName: 'Personal',
        color: '#FF5733',
        ctag: '"3a1f0d9c2b7e4f6a8d5c"',
        description: 'My & your events',
        visible: true,
        readOnly: false
      },
      {
        href: '/caldav/alice/shared-ro/',
        displayName: 'Team (read only)',
        color: '#3788d8',
        ctag: '"ffee"',
        description: undefined,
        visible: true,
        readOnly: true
      }
    ])
  })

  it('returns an empty list for a home without calendars', async () => {
    mockFetch(
      multistatus(`<?xml version='1.0' encoding='utf-8'?>
<multistatus xmlns="DAV:">
  <response>
    <href>/caldav/alice/</href>
    <propstat>
      <prop><resourcetype><principal /><collection /></resourcetype></prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`)
    )
    await expect(listCalendars('/caldav/alice/')).resolves.toEqual([])
  })

  it('falls back to a default name for calendars without display name', async () => {
    mockFetch(
      multistatus(`<?xml version='1.0' encoding='utf-8'?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <response>
    <href>/caldav/alice/0b7c/</href>
    <propstat>
      <prop><resourcetype><C:calendar /><collection /></resourcetype></prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`)
    )
    const [calendar] = await listCalendars('/caldav/alice/')
    expect(calendar.displayName).toBe('Calendar')
    expect(calendar.ctag).toBe('')
  })
})

describe('discoverCalendars', () => {
  it('runs principal, home and calendar discovery in sequence', async () => {
    const fetchMock = mockFetch(
      multistatus(PRINCIPAL_RESPONSE),
      multistatus(CALENDAR_HOME_RESPONSE),
      multistatus(CALENDARS_RESPONSE)
    )

    const calendars = await discoverCalendars()

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/caldav/',
      '/caldav/alice/',
      '/caldav/alice/'
    ])
    expect(calendars.map((c) => c.displayName)).toEqual(['Personal', 'Team (read only)'])
  })

  it('stops after a failing step', async () => {
    const fetchMock = mockFetch(respond({ status: 401, statusText: 'Unauthorized' }))
    await expect(discoverCalendars()).rejects.toBeInstanceOf(AuthenticationError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
