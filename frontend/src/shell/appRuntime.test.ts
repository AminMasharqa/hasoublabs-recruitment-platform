/**
 * The shell runtime wiring.
 *
 * What is asserted here is the *wiring*, not the collaborators: the Api_Client,
 * the Session_Manager, the cache and the router each have their own tests. This
 * file covers the four obligations that exist only because those four are put
 * together:
 *
 * - the entire cache is discarded on logout, on session expiry and on a context
 *   switch (Requirements 4 AC7, 4 AC9, 4 AC10, 8 AC11),
 * - a session that ends lands on the login screen, carrying the session-expired
 *   notice when Requirement 4 AC7 asks for it,
 * - every Api_Client failure retains its Support_Reference (Requirement 23 AC3)
 *   and an `account_not_approved` envelope from *any* request replaces the
 *   retained Account_Status (Requirement 7 AC6),
 * - the cache adds no retry budget of its own on top of the Api_Client's
 *   (Requirement 21 AC9, AC10).
 */

import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  clearAccountNotApproved,
  latestAccountNotApproved,
} from '../routing/accountStatus'
import {
  clearFailedSupportReference,
  latestFailedSupportReference,
} from '../errors/supportReferenceStore'
import {
  createAppRuntime,
  createQueryClient,
  resetSharedAppRuntime,
  sessionEndRedirectState,
  sharedAppRuntime,
  wasSessionExpired,
  type AppRuntime,
} from './appRuntime'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** An unsigned Access_Token; the Web_Client never verifies the signature. */
function accessToken(overrides: Record<string, unknown> = {}): string {
  const claims = {
    sub: 'account-1',
    roles: ['CANDIDATE'],
    act: 'CANDIDATE',
    session_id: 'session-1',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  }
  return `${base64Url('{"alg":"HS256","typ":"JWT"}')}.${base64Url(JSON.stringify(claims))}.sig`
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'req-abc' },
  })
}

/** An element stand-in; the runtime only forwards it to the route tree. */
const SHELL_ELEMENT = createElement('div')

interface Harness {
  readonly runtime: AppRuntime
  /** Every request the stubbed transport saw, as `METHOD /path`. */
  readonly calls: string[]
}

function harness(respond: (request: Request) => Response | Promise<Response>): Harness {
  const calls: string[] = []
  const runtime = createAppRuntime({
    shellElement: SHELL_ELEMENT,
    apiRuntime: {
      baseUrl: 'https://backend.test/api/v1',
      locale: () => 'en',
      fetch: async (request) => {
        calls.push(`${request.method} ${new URL(request.url).pathname}`)
        return respond(request)
      },
    },
  })
  // `createBrowserRouter` initializes itself, so the router already owns the
  // history stack and services `navigate` immediately.
  return { runtime, calls }
}

let active: AppRuntime | null = null

function open(respond: (request: Request) => Response | Promise<Response>): Harness {
  const built = harness(respond)
  active = built.runtime
  return built
}

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  clearFailedSupportReference()
  clearAccountNotApproved()
  resetSharedAppRuntime()
})

afterEach(() => {
  active?.router.dispose()
  active = null
  resetSharedAppRuntime()
})

// ── The cache ─────────────────────────────────────────────────────────────────

describe('createQueryClient', () => {
  it('adds no retry budget on top of the Api_Client policy (Req 21 AC9, AC10)', () => {
    const defaults = createQueryClient().getDefaultOptions()

    expect(defaults.queries?.retry).toBe(false)
    expect(defaults.mutations?.retry).toBe(false)
  })
})

describe('clearServerState', () => {
  it.each(['logout', 'session-expired', 'context-switch'] as const)(
    'discards every cached entry for reason %s',
    (reason) => {
      const { runtime } = open(() => jsonResponse({}))
      runtime.queryClient.setQueryData(['jobs'], ['a'])
      runtime.queryClient.setQueryData(['profile'], { id: 1 })

      runtime.clearServerState(reason)

      expect(runtime.queryClient.getQueryCache().getAll()).toHaveLength(0)
      expect(runtime.queryClient.getQueryData(['jobs'])).toBeUndefined()
      expect(runtime.queryClient.getQueryData(['profile'])).toBeUndefined()
    },
  )
})

// ── The session-end notice ────────────────────────────────────────────────────

describe('sessionEndRedirectState', () => {
  it('distinguishes an expired session from a deliberate logout (Req 4 AC7, AC9)', () => {
    expect(wasSessionExpired(sessionEndRedirectState('session-expired'))).toBe(true)
    expect(wasSessionExpired(sessionEndRedirectState('logout'))).toBe(false)
  })

  it('reports no notice for a direct navigation to the login screen', () => {
    for (const state of [null, undefined, {}, 'session-expired', { sessionEnded: 'nonsense' }]) {
      expect(wasSessionExpired(state)).toBe(false)
    }
  })
})

// ── Session teardown clears the cache and redirects (Req 4 AC7, AC9, AC10) ────

describe('session teardown', () => {
  it('clears the cache and lands on the login screen with the expiry notice', async () => {
    const { runtime } = open(() => jsonResponse({}))
    runtime.session.login({ accessToken: accessToken(), refreshToken: 'refresh-1' })
    runtime.queryClient.setQueryData(['jobs'], ['a'])

    runtime.session.clear('session-expired')
    await Promise.resolve()

    expect(runtime.session.getAccessToken()).toBeNull()
    expect(runtime.queryClient.getQueryCache().getAll()).toHaveLength(0)
    expect(runtime.router.state.location.pathname).toBe('/login')
    expect(wasSessionExpired(runtime.router.state.location.state)).toBe(true)
  })

  it('clears the cache and redirects even when logout is refused (Req 4 AC10)', async () => {
    const { runtime, calls } = open(() => jsonResponse({ error: 'server_error' }, 500))
    runtime.session.login({ accessToken: accessToken(), refreshToken: 'refresh-1' })
    runtime.queryClient.setQueryData(['jobs'], ['a'])

    await runtime.session.logout()

    expect(calls).toContain('POST /api/v1/auth/logout')
    expect(runtime.session.getAccessToken()).toBeNull()
    expect(runtime.queryClient.getQueryCache().getAll()).toHaveLength(0)
    expect(runtime.router.state.location.pathname).toBe('/login')
    expect(wasSessionExpired(runtime.router.state.location.state)).toBe(false)
  })
})

// ── The single failure observer (Req 23 AC3, Req 7 AC6) ───────────────────────

describe('failure observation', () => {
  it('retains the Support_Reference of a failed request', async () => {
    const { runtime } = open(() => jsonResponse({ error: 'server_error', request_id: 'req-abc' }, 500))

    await expect(runtime.api.request('get', '/api/v1/me/status')).rejects.toMatchObject({
      error: 'server_error',
    })

    expect(latestFailedSupportReference()).toBe('req-abc')
  })

  it('never retains a reference for a successful request (Req 23 AC4)', async () => {
    const { runtime } = open(() => jsonResponse({ status: 'Approved' }))

    await runtime.api.request('get', '/api/v1/me/status')

    expect(latestFailedSupportReference()).toBeNull()
  })

  it('replaces the retained Account_Status from any account_not_approved envelope', async () => {
    const { runtime } = open(() =>
      jsonResponse(
        {
          error: 'account_not_approved',
          details: { status: 'Suspended', next_step: 'contact_support' },
        },
        403,
      ),
    )

    await expect(runtime.api.request('get', '/api/v1/me/status')).rejects.toMatchObject({
      error: 'account_not_approved',
    })

    expect(latestAccountNotApproved()).toEqual({
      status: 'Suspended',
      nextStep: 'contact_support',
    })
  })
})

// ── One runtime per browsing context ──────────────────────────────────────────

describe('sharedAppRuntime', () => {
  it('returns the same instance for every call', () => {
    const first = sharedAppRuntime({ shellElement: SHELL_ELEMENT })
    const second = sharedAppRuntime({ shellElement: SHELL_ELEMENT })

    expect(second).toBe(first)

    resetSharedAppRuntime()
    expect(sharedAppRuntime({ shellElement: SHELL_ELEMENT })).not.toBe(first)
  })
})
