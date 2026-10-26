import { vi } from 'vitest'

export interface MockResponse {
  status?: number
  statusText?: string
  body?: string
  headers?: Record<string, string>
}

export function respond({ status = 200, statusText = '', body, headers }: MockResponse = {}) {
  const nullBody = status === 204 || status === 205 || status === 304
  return new Response(nullBody ? null : (body ?? ''), { status, statusText, headers })
}

export function multistatus(body: string) {
  return respond({
    status: 207,
    statusText: 'Multi-Status',
    body,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' }
  })
}

export function json(data: unknown, status = 200, statusText = '') {
  return respond({
    status,
    statusText,
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' }
  })
}

/** Replaces the global fetch with a mock that returns the given responses in order. */
export function mockFetch(...responses: Array<Response | Error>) {
  const fetchMock = vi.fn<typeof fetch>()
  for (const response of responses) {
    if (response instanceof Error) {
      fetchMock.mockRejectedValueOnce(response)
    } else {
      fetchMock.mockResolvedValueOnce(response)
    }
  }
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Returns url and init of the n-th fetch call. */
export function fetchCall(fetchMock: ReturnType<typeof mockFetch>, n = 0) {
  const [url, init] = fetchMock.mock.calls[n]
  return { url: String(url), init: init ?? {} }
}
