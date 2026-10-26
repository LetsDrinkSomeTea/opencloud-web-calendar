import { describe, it, expect, vi, afterEach } from 'vitest'
import { createCalendar, deleteCalendar } from '../../../src/caldav/calendar-management'
import { AuthenticationError, CalDAVError, ConflictError } from '../../../src/caldav/errors'
import { mockFetch, fetchCall, respond } from './fetch-mock'

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
