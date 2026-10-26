import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  getSharingInfo,
  listShares,
  createShare,
  updateShare,
  deleteShare,
  enableShare,
  disableShare,
  hideShare,
  unhideShare
} from '../../../src/caldav/sharing'
import { CalDAVError } from '../../../src/caldav/errors'
import { mockFetch, fetchCall, json, respond } from './fetch-mock'

vi.mock('@opencloud-eu/web-pkg', () => ({
  useAuthStore: () => ({ accessToken: 'test-token' }),
  useUserStore: () => ({ user: null as unknown })
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

const SHARE = {
  ShareType: 'map',
  PathOrToken: '/caldav/alice/personal/',
  PathMapped: '/caldav/bob/alice-personal/',
  Owner: 'alice',
  User: 'bob',
  Permissions: 'r',
  EnabledByOwner: true,
  EnabledByUser: false,
  HiddenByOwner: false,
  HiddenByUser: false,
  TimestampCreated: 1700000000,
  TimestampUpdated: 1700000000,
  Properties: {},
  Actions: {}
}

describe('sharing API requests', () => {
  it('POSTs JSON to the Radicale sharing endpoint', async () => {
    const fetchMock = mockFetch(json({ ApiVersion: 1, Status: 'success', Content: [SHARE] }))

    await listShares('map', { PathOrToken: '/caldav/alice/personal/' })

    const { url, init } = fetchCall(fetchMock)
    const headers = new Headers(init.headers)
    expect(url).toBe('/caldav/.sharing/v1/map/list')
    expect(init.method).toBe('POST')
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('Accept')).toBe('application/json')
    expect(JSON.parse(String(init.body))).toEqual({ PathOrToken: '/caldav/alice/personal/' })
  })

  it('reads the sharing info', async () => {
    const info = {
      ApiVersion: 1,
      Status: 'success',
      FeatureEnabledCollectionByMap: true,
      PermittedCreateCollectionByMap: true,
      FeatureEnabledCollectionByToken: true,
      PermittedCreateCollectionByToken: false,
      SupportedConversions: [] as string[],
      PermittedPropertiesOverlay: false,
      SupportedPropertiesOverlay: [] as string[],
      SupportedActions: {}
    }
    const fetchMock = mockFetch(json(info))
    await expect(getSharingInfo()).resolves.toEqual(info)
    expect(fetchCall(fetchMock).url).toBe('/caldav/.sharing/v1/all/info')
  })

  it('lists shares of all types by default', async () => {
    const fetchMock = mockFetch(json({ Status: 'success', Content: [SHARE] }))
    await expect(listShares()).resolves.toEqual([SHARE])
    expect(fetchCall(fetchMock).url).toBe('/caldav/.sharing/v1/all/list')
    expect(JSON.parse(String(fetchCall(fetchMock).init.body))).toEqual({})
  })

  it('treats "not-found" as an empty list', async () => {
    mockFetch(json({ ApiVersion: 1, Status: 'not-found' }))
    await expect(listShares()).resolves.toEqual([])
  })

  it('returns an empty list if Content is missing', async () => {
    mockFetch(json({ Status: 'success' }))
    await expect(listShares()).resolves.toEqual([])
  })

  it('creates a share and returns its token', async () => {
    const fetchMock = mockFetch(json({ Status: 'success', PathOrToken: 'tok-123' }))
    const result = await createShare('token', {
      PathMapped: '/caldav/alice/personal/',
      Permissions: 'r'
    })
    expect(result.PathOrToken).toBe('tok-123')
    expect(fetchCall(fetchMock).url).toBe('/caldav/.sharing/v1/token/create')
    expect(JSON.parse(String(fetchCall(fetchMock).init.body))).toEqual({
      PathMapped: '/caldav/alice/personal/',
      Permissions: 'r'
    })
  })

  it('updates a share', async () => {
    const fetchMock = mockFetch(json({ Status: 'success' }))
    await updateShare('map', { PathOrToken: '/caldav/alice/personal/', Permissions: 'rw' })
    expect(fetchCall(fetchMock).url).toBe('/caldav/.sharing/v1/map/update')
    expect(JSON.parse(String(fetchCall(fetchMock).init.body))).toEqual({
      PathOrToken: '/caldav/alice/personal/',
      Permissions: 'rw'
    })
  })

  it.each([
    ['delete', deleteShare],
    ['enable', enableShare],
    ['disable', disableShare],
    ['hide', hideShare],
    ['unhide', unhideShare]
  ] as const)('%s sends the share identifier', async (hook, action) => {
    const fetchMock = mockFetch(json({ Status: 'success' }))
    await expect(action('token', 'tok-123')).resolves.toBeUndefined()
    expect(fetchCall(fetchMock).url).toBe(`/caldav/.sharing/v1/token/${hook}`)
    expect(JSON.parse(String(fetchCall(fetchMock).init.body))).toEqual({ PathOrToken: 'tok-123' })
  })
})

describe('sharing API errors', () => {
  it.each([
    [401, 'Unauthorized'],
    [403, 'Forbidden'],
    [404, 'Not Found'],
    [412, 'Precondition Failed'],
    [500, 'Internal Server Error']
  ])('throws CalDAVError on HTTP %i', async (status, statusText) => {
    mockFetch(respond({ status, statusText }))
    const error = await listShares().catch((e) => e)
    expect(error).toBeInstanceOf(CalDAVError)
    expect(error.status).toBe(status)
    expect(error.message).toBe(`Sharing API request failed: ${statusText}`)
  })

  it('throws on a non-success API status', async () => {
    mockFetch(json({ ApiVersion: 1, Status: 'error' }))
    await expect(createShare('map', { PathMapped: '/caldav/x/' })).rejects.toThrow(
      'Sharing API error: error'
    )
  })

  it('throws on a non-JSON body', async () => {
    mockFetch(respond({ status: 200, body: '<html>proxy error</html>' }))
    await expect(getSharingInfo()).rejects.toThrow()
  })

  it('propagates network errors', async () => {
    mockFetch(new TypeError('Failed to fetch'))
    await expect(deleteShare('map', '/caldav/x/')).rejects.toThrow('Failed to fetch')
  })
})
