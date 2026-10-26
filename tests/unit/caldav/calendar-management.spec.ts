import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  createCalendar,
  deleteCalendar,
  updateCalendar
} from '../../../src/caldav/calendar-management'
import { AuthenticationError, CalDAVError, ConflictError } from '../../../src/caldav/errors'
import { mockFetch, fetchCall, respond, multistatus } from './fetch-mock'

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAuthStore: () => ({ accessToken: 'test-token' }),
  useUserStore: () => ({ user: null as unknown })
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const HOME = '/caldav/alice/'

describe('createCalendar', () => {
  it('sends MKCALENDAR to a slug derived from the display name', async () => {
    const fetchMock = mockFetch(respond({ status: 201, statusText: 'Created' }))

    const calendar = await createCalendar(HOME, {
      displayName: 'Café Meetings',
      description: 'Coffee & chat',
      color: '#ff0000'
    })

    const { url, init } = fetchCall(fetchMock)
    expect(url).toBe('/caldav/alice/cafe-meetings/')
    expect(init.method).toBe('MKCALENDAR')
    expect(new Headers(init.headers).get('Content-Type')).toContain('application/xml')
    expect(init.body).toContain('<d:displayname>Café Meetings</d:displayname>')
    expect(init.body).toContain('Coffee &amp; chat')
    expect(init.body).toContain('#ff0000')

    expect(calendar).toEqual({
      href: '/caldav/alice/cafe-meetings/',
      displayName: 'Café Meetings',
      color: '#ff0000',
      ctag: '',
      description: 'Coffee & chat',
      visible: true
    })
  })

  it('uses the default color if none is given', async () => {
    mockFetch(respond({ status: 201 }))
    const calendar = await createCalendar(HOME, { displayName: 'Work' })
    expect(calendar.color).toBe('#3788d8')
  })

  it('trims and limits the slug', async () => {
    const fetchMock = mockFetch(respond({ status: 201 }))
    await createCalendar(HOME, { displayName: `--${'a'.repeat(80)}!!` })
    expect(fetchCall(fetchMock).url).toBe(`${HOME}${'a'.repeat(50)}/`)
  })

  it('falls back to a timestamp slug for names without latin characters', async () => {
    vi.useFakeTimers({ now: 1700000000000 })
    const fetchMock = mockFetch(respond({ status: 201 }))
    await createCalendar(HOME, { displayName: '日本語' })
    expect(fetchCall(fetchMock).url).toBe(`${HOME}calendar-1700000000000/`)
  })

  it('throws AuthenticationError on 401', async () => {
    mockFetch(respond({ status: 401, statusText: 'Unauthorized' }))
    await expect(createCalendar(HOME, { displayName: 'Work' })).rejects.toBeInstanceOf(
      AuthenticationError
    )
  })

  it('throws CalDAVError on 403', async () => {
    mockFetch(respond({ status: 403, statusText: 'Forbidden' }))
    await expect(createCalendar(HOME, { displayName: 'Work' })).rejects.toMatchObject({
      name: 'CalDAVError',
      status: 403,
      message: 'Failed to create calendar: Forbidden'
    })
  })

  it('reports unsupported MKCALENDAR on 405', async () => {
    mockFetch(respond({ status: 405, statusText: 'Method Not Allowed' }))
    await expect(createCalendar(HOME, { displayName: 'Work' })).rejects.toMatchObject({
      status: 405,
      message: 'MKCALENDAR not supported by server'
    })
  })

  it('throws ConflictError if the calendar already exists (409)', async () => {
    mockFetch(respond({ status: 409, statusText: 'Conflict' }))
    const error = await createCalendar(HOME, { displayName: 'Work' }).catch((e) => e)
    expect(error).toBeInstanceOf(ConflictError)
    expect(error.message).toBe('Calendar with this name already exists')
  })

  it('throws CalDAVError on 412', async () => {
    mockFetch(respond({ status: 412, statusText: 'Precondition Failed' }))
    const error = await createCalendar(HOME, { displayName: 'Work' }).catch((e) => e)
    expect(error).toBeInstanceOf(CalDAVError)
    expect(error.status).toBe(412)
  })

  it('propagates network errors', async () => {
    mockFetch(new TypeError('Failed to fetch'))
    await expect(createCalendar(HOME, { displayName: 'Work' })).rejects.toThrow('Failed to fetch')
  })
})

describe('deleteCalendar', () => {
  it('sends DELETE to the calendar href', async () => {
    const fetchMock = mockFetch(respond({ status: 204 }))
    await expect(deleteCalendar('/caldav/alice/work/')).resolves.toBeUndefined()

    const { url, init } = fetchCall(fetchMock)
    expect(url).toBe('/caldav/alice/work/')
    expect(init.method).toBe('DELETE')
  })

  it('treats 404 as already deleted', async () => {
    mockFetch(respond({ status: 404, statusText: 'Not Found' }))
    await expect(deleteCalendar('/caldav/alice/work/')).resolves.toBeUndefined()
  })

  it('throws AuthenticationError on 401', async () => {
    mockFetch(respond({ status: 401 }))
    await expect(deleteCalendar('/caldav/alice/work/')).rejects.toBeInstanceOf(AuthenticationError)
  })

  it('throws CalDAVError on 403', async () => {
    mockFetch(respond({ status: 403, statusText: 'Forbidden' }))
    await expect(deleteCalendar('/caldav/alice/work/')).rejects.toMatchObject({
      name: 'CalDAVError',
      status: 403,
      message: 'Failed to delete calendar: Forbidden'
    })
  })

  it('refuses to delete outside the CalDAV endpoint', async () => {
    const fetchMock = mockFetch(respond({ status: 204 }))
    await expect(deleteCalendar('/graph/v1.0/drives/x')).rejects.toBeInstanceOf(CalDAVError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('updateCalendar', () => {
  const okResponse = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ic="http://apple.com/ns/ical/">
  <d:response>
    <d:href>/caldav/alice/work/</d:href>
    <d:propstat>
      <d:prop><d:displayname/><c:calendar-description/><ic:calendar-color/></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`

  it('sends PROPPATCH with the new properties', async () => {
    const fetchMock = mockFetch(multistatus(okResponse))
    await updateCalendar('/caldav/alice/work/', {
      displayName: 'Büro',
      description: 'Office',
      color: '#22c55e'
    })

    const { url, init } = fetchCall(fetchMock)
    expect(url).toBe('/caldav/alice/work/')
    expect(init.method).toBe('PROPPATCH')
    expect(new Headers(init.headers).get('Content-Type')).toContain('application/xml')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-token')
    expect(init.body).toContain('<d:propertyupdate')
    expect(init.body).toContain('<d:displayname>Büro</d:displayname>')
    expect(init.body).toContain('<ic:calendar-color>#22c55e</ic:calendar-color>')
  })

  it('accepts a plain 200 response', async () => {
    mockFetch(respond({ status: 200 }))
    await expect(updateCalendar('/caldav/alice/work/', { color: '#000000' })).resolves.toBe(
      undefined
    )
  })

  it('fails if the server rejects a property in the multistatus', async () => {
    mockFetch(
      multistatus(`<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:ic="http://apple.com/ns/ical/">
  <d:response>
    <d:href>/caldav/alice/work/</d:href>
    <d:propstat>
      <d:prop><ic:calendar-color/></d:prop>
      <d:status>HTTP/1.1 403 Forbidden</d:status>
    </d:propstat>
    <d:propstat>
      <d:prop><d:displayname/></d:prop>
      <d:status>HTTP/1.1 424 Failed Dependency</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`)
    )
    await expect(
      updateCalendar('/caldav/alice/work/', { displayName: 'Work', color: '#000000' })
    ).rejects.toMatchObject({
      name: 'CalDAVError',
      message: 'Failed to update calendar properties: calendar-color, displayname'
    })
  })

  it('maps 401, 403 and 404', async () => {
    mockFetch(respond({ status: 401 }))
    await expect(updateCalendar('/caldav/alice/work/', {})).rejects.toBeInstanceOf(
      AuthenticationError
    )
    mockFetch(respond({ status: 403, statusText: 'Forbidden' }))
    await expect(updateCalendar('/caldav/alice/work/', {})).rejects.toMatchObject({ status: 403 })
    mockFetch(respond({ status: 404 }))
    await expect(updateCalendar('/caldav/alice/work/', {})).rejects.toMatchObject({
      name: 'NotFoundError'
    })
  })

  it('refuses to send requests outside the CalDAV endpoint', async () => {
    const fetchMock = mockFetch(respond({ status: 207 }))
    await expect(updateCalendar('/graph/v1.0/me', {})).rejects.toBeInstanceOf(CalDAVError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
