import { useAuthStore, useUserStore } from '@opencloud-eu/web-pkg'
import { CalDAVError, NetworkError } from './errors'
import { getCalDAVBasePath } from '../config'

/**
 * Access token of the logged in user. The auth store is a pinia store that is shared with the
 * OpenCloud runtime, so it always holds the current (renewed) token.
 */
export function getAccessToken(): string | null {
  return useAuthStore().accessToken || null
}

export function getAuthHeaders(): Record<string, string> {
  const token = getAccessToken()
  if (token) {
    return { Authorization: `Bearer ${token}` }
  }
  return {}
}

/**
 * Id of the logged in user.
 *
 * The app's routes require the `user` auth context. The OpenCloud runtime only resolves such a
 * route after the user has been loaded into the user store (`userStore.setUser` runs before
 * `authStore.userContextReady` is set), so no waiting is necessary here.
 */
export function getUserId(): string | null {
  const user = useUserStore().user
  if (!user) return null
  return user.id || user.onPremisesSamAccountName || user.mail || null
}

/**
 * `fetch` for CalDAV requests: only same-origin requests below the CalDAV endpoint are allowed
 * and the access token is added. Always returns a promise: a rejected URL rejects with a
 * `CalDAVError`, a failed request (offline, DNS, connection reset) with a `NetworkError`.
 */
export async function authenticatedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const normalizedUrl = normalizeCalDAVUrl(url)
  const headers = new Headers(options.headers)

  // The OpenCloud proxy authenticates the bearer token and sets the remote user header for
  // the CalDAV backend itself (`remote_user_header` in proxy.yaml).
  const token = getAccessToken()
  if (token) {
    assertSafeHeaderValue('Authorization', token)
    headers.set('Authorization', `Bearer ${token}`)
  }

  try {
    return await fetch(normalizedUrl, {
      ...options,
      headers,
      credentials: 'include'
    })
  } catch (err) {
    // Aborted requests are intentional and must stay recognizable as such
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    const networkError = new NetworkError(
      err instanceof Error && err.message ? err.message : undefined
    )
    Object.defineProperty(networkError, 'cause', { value: err })
    throw networkError
  }
}

export function isAllowedCalDAVPath(pathname: string, basePath = getCalDAVBasePath()): boolean {
  return (
    pathname === basePath ||
    pathname.startsWith(`${basePath}/`) ||
    pathname.startsWith('/.sharing/') ||
    pathname.startsWith('/.token/')
  )
}

export function normalizeCalDAVUrl(url: string): string {
  if (!url || !url.trim()) {
    throw new CalDAVError('Invalid CalDAV URL')
  }

  const origin = getCurrentOrigin()
  const parsed = new URL(url, origin)

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CalDAVError('Unsupported CalDAV URL protocol')
  }

  if (parsed.origin !== origin) {
    throw new CalDAVError('Refusing cross-origin CalDAV request')
  }

  if (!isAllowedCalDAVPath(parsed.pathname)) {
    throw new CalDAVError('Refusing request outside CalDAV endpoint')
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

function getCurrentOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }
  return 'http://localhost'
}

function assertSafeHeaderValue(headerName: string, value: string): void {
  if (/[\r\n]/.test(value)) {
    throw new CalDAVError(`Invalid ${headerName} header value`)
  }
}
