/**
 * Api_Client sanity checks (Requirement 3 AC2, AC3, AC6, AC8, AC10, AC11).
 *
 * A thin smoke test over the injected-collaborator surface: it proves the module
 * is drivable with a stub `fetch` and a stub session, that credentials and the
 * active Locale reach the wire, and that a failure carries the transport facts
 * the requirements ask the Api_Client to expose. The exhaustive secret-hygiene,
 * timeout and retry coverage is task 5.4.
 */

import { describe, expect, it } from 'vitest'

import { createApiClient, isApiFailure, parseRetryAfter, resolveRequestBaseUrl } from './client'

const BASE_URL = 'https://backend.test/api/v1'

interface Recorded {
  readonly requests: Request[]
}

function client(
  respond: (request: Request) => Response,
  options: { readonly accessToken?: string | null; readonly locale?: string } = {},
): { readonly api: ReturnType<typeof createApiClient>; readonly recorded: Recorded } {
  const requests: Request[] = []
  const api = createApiClient({
    baseUrl: BASE_URL,
    locale: () => options.locale ?? 'ar',
    session: {
      getAccessToken: () => options.accessToken ?? null,
      onUnauthorized: () => Promise.resolve({ replayed: false, refresh: { status: 'no-session' } }),
    },
    fetch: (request) => {
      requests.push(request)
      return Promise.resolve(respond(request))
    },
  })
  return { api, recorded: { requests } }
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

describe('resolveRequestBaseUrl', () => {
  it('de-duplicates the mount prefix the generated paths already carry', () => {
    expect(resolveRequestBaseUrl('/api/v1')).toBe('')
    expect(resolveRequestBaseUrl('https://backend.test/api/v1/')).toBe('https://backend.test')
    expect(resolveRequestBaseUrl('https://backend.test')).toBe('https://backend.test')
  })
})

describe('parseRetryAfter', () => {
  it('reads both header forms and rejects anything else', () => {
    const now = Date.parse('2025-01-01T00:00:00.000Z')
    expect(parseRetryAfter('30', now)).toBe(30)
    expect(parseRetryAfter('Wed, 01 Jan 2025 00:00:45 GMT', now)).toBe(45)
    expect(parseRetryAfter('soon', now)).toBeNull()
    expect(parseRetryAfter(null, now)).toBeNull()
  })
})

describe('createApiClient', () => {
  it('attaches the Access_Token and the active Locale, and records the Support_Reference', async () => {
    const { api, recorded } = client(
      () => json({ status: 'Approved', next_step: null }, 200, { 'X-Request-ID': 'req-42' }),
      { accessToken: 'access-token-value', locale: 'he' },
    )

    const result = await api.request('get', '/api/v1/me/status')

    expect(recorded.requests).toHaveLength(1)
    const sent = recorded.requests[0]
    expect(sent.url).toBe(`${BASE_URL}/me/status`)
    expect(sent.headers.get('Authorization')).toBe('Bearer access-token-value')
    expect(sent.headers.get('Accept-Language')).toBe('he')
    expect(result.supportReference).toBe('req-42')
    expect(result.data).toEqual({ status: 'Approved', next_step: null })
  })

  it('omits the Authorization header when no Access_Token is held', async () => {
    const { api, recorded } = client(() => json({ items: [] }, 200))

    await api.request('get', '/api/v1/skills', { params: { query: { q: 'sql' } } })

    expect(recorded.requests[0]?.headers.has('Authorization')).toBe(false)
    expect(recorded.requests[0]?.url).toBe(`${BASE_URL}/skills?q=sql`)
  })

  it('exposes the 429 Retry-After value to the caller', async () => {
    const { api } = client(() =>
      json({ error: 'rate_limited', message: 'Slow down' }, 429, {
        'Retry-After': '12',
        'X-Request-ID': 'req-429',
      }),
    )

    const failure = await api.request('get', '/api/v1/me/status').catch((thrown: unknown) => thrown)

    expect(isApiFailure(failure)).toBe(true)
    if (!isApiFailure(failure)) {
      return
    }
    expect(failure.error).toBe('rate_limited')
    expect(failure.retryAfter).toBe('12')
    expect(failure.retryAfterSeconds).toBe(12)
    expect(failure.supportReference).toBe('req-429')
  })

  it('exposes details.service of a 503 upstream_unavailable and marks it retryable', async () => {
    const { api } = client(() =>
      json({ error: 'upstream_unavailable', details: { service: 'clamav' } }, 503),
    )

    const failure = await api
      .request('post', '/api/v1/auth/logout', { accessToken: 'token' })
      .catch((thrown: unknown) => thrown)

    expect(isApiFailure(failure)).toBe(true)
    if (!isApiFailure(failure)) {
      return
    }
    expect(failure.upstreamService).toBe('clamav')
    expect(failure.retryable).toBe(true)
  })

  it('classifies a 403 as an authorization denial without attempting a refresh', async () => {
    let refreshes = 0
    const requests: Request[] = []
    const api = createApiClient({
      baseUrl: BASE_URL,
      locale: () => 'en',
      session: {
        getAccessToken: () => 'token',
        onUnauthorized: () => {
          refreshes += 1
          return Promise.resolve({ replayed: false, refresh: { status: 'no-session' } })
        },
      },
      fetch: (request) => {
        requests.push(request)
        return Promise.resolve(json({ error: 'not_authorized' }, 403))
      },
    })

    const failure = await api.request('get', '/api/v1/me/status').catch((thrown: unknown) => thrown)

    expect(isApiFailure(failure)).toBe(true)
    if (!isApiFailure(failure)) {
      return
    }
    expect(failure.authOutcome).toBe('authorization_denial')
    expect(failure.refreshEligible).toBe(false)
    expect(refreshes).toBe(0)
    expect(requests).toHaveLength(1)
  })
})
