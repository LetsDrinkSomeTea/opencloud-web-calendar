import { describe, it, expect, vi, afterEach } from 'vitest'
import { authenticatedFetch } from '../../../src/caldav/auth'
import { CalDAVError } from '../../../src/caldav/errors'
import { mockFetch, fetchCall, respond } from './fetch-mock'

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAuthStore: () => ({ accessToken: 'test-token' }),
  useUserStore: () => ({ user: null as unknown })
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

// authenticatedFetch currently throws synchronously for rejected URLs; wrapping it keeps the
// tests independent of whether it throws or returns a rejected promise.
const request = async (url: string, init?: RequestInit) => authenticatedFetch(url, init)

describe('authenticatedFetch URL safety', () => {
  it.each([
    ['/caldav'],
    ['/caldav/'],
    ['/caldav/alice/personal/'],
    ['/caldav/.sharing/v1/all/list'],
    ['/.sharing/v1/all/info'],
    ['/.token/abc123/']
  ])('allows same-origin CalDAV path %s', async (path) => {
    const fetchMock = mockFetch(respond())
    await authenticatedFetch(path)
    expect(fetchCall(fetchMock).url).toBe(path)
  })

  it('reduces absolute same-origin URLs to path, query and hash', async () => {
    const fetchMock = mockFetch(respond())
    await authenticatedFetch(`${window.location.origin}/caldav/alice/?x=1#y`)
    expect(fetchCall(fetchMock).url).toBe('/caldav/alice/?x=1#y')
  })

  it('normalizes dot segments before checking the path', async () => {
    mockFetch(respond())
    await expect(request('/caldav/../graph/v1.0/me')).rejects.toThrow(
      'Refusing request outside CalDAV endpoint'
    )
  })

  it.each([
    ['https://evil.example.com/caldav/alice/'],
    ['//evil.example.com/caldav/alice/'],
    ['http://localhost:1/caldav/']
  ])('refuses cross-origin URL %s', async (url) => {
    const fetchMock = mockFetch(respond())
    await expect(request(url)).rejects.toThrow('Refusing cross-origin CalDAV request')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([['/graph/v1.0/me'], ['/caldavx/alice/'], ['/'], ['/remote.php/dav/']])(
    'refuses non-CalDAV path %s',
    async (path) => {
      const fetchMock = mockFetch(respond())
      await expect(request(path)).rejects.toThrow('Refusing request outside CalDAV endpoint')
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it.each([['javascript:alert(1)'], ['data:text/plain,hi'], ['ftp://localhost/caldav/']])(
    'refuses unsupported protocol %s',
    async (url) => {
      const fetchMock = mockFetch(respond())
      await expect(request(url)).rejects.toThrow('Unsupported CalDAV URL protocol')
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it.each([[''], ['   ']])('refuses empty URL %j', async (url) => {
    const fetchMock = mockFetch(respond())
    await expect(request(url)).rejects.toBeInstanceOf(CalDAVError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes method, body and headers through and includes credentials', async () => {
    const fetchMock = mockFetch(respond())
    await authenticatedFetch('/caldav/alice/', {
      method: 'PROPFIND',
      headers: { Depth: '1' },
      body: '<xml/>'
    })
    const { init } = fetchCall(fetchMock)
    expect(init.method).toBe('PROPFIND')
    expect(init.body).toBe('<xml/>')
    expect(init.credentials).toBe('include')
    expect(new Headers(init.headers).get('Depth')).toBe('1')
  })

  it('propagates network errors', async () => {
    mockFetch(new TypeError('Failed to fetch'))
    await expect(request('/caldav/')).rejects.toThrow('Failed to fetch')
  })
})
