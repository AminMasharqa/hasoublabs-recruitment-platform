/**
 * Session_Manager teardown transitions — the two ways a session ends.
 *
 * Requirement 4 draws a sharp line through failure: a Refresh_Token exchange
 * refused with a 400–499 means the Refresh_Token is dead, so the session is
 * discarded, the cache cleared and the login screen shown with the
 * session-expired notice (AC7); anything else — a 5xx, a timeout, a network
 * error — has invalidated nothing, so both tokens are kept. Logout sits on the
 * other side of that line entirely: it discards and clears regardless of what
 * `POST /auth/logout` answered, including when the call fails outright
 * (AC9, AC10).
 *
 * These cases walk both sides with real status codes rather than one
 * representative each, because the boundaries of the range AC7 names (400 and
 * 499) and the statuses a refresh endpoint actually answers with (401, 403, 422,
 * 429) are where an off-by-one in the classification would hide.
 *
 * Every case also runs under a persistence guard: no `localStorage`,
 * `sessionStorage`, cookie or IndexedDB write may happen at any point of a
 * session's life, which is what makes a page reload start with no session at all
 * (AC3, AC11).
 *
 * Requirements: 4.7, 4.9, 4.10, 4.11.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { decodeApiError, type ApiError } from '../api/errors'
import {
  createSessionManager,
  type CancelScheduled,
  type SessionEndReason,
  type SessionManager,
  type TokenPair,
} from './SessionManager'

// ── Token fixtures ────────────────────────────────────────────────────────────

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** An unsigned JWT; the Web_Client never verifies the signature. */
function accessToken(expEpochSeconds: number): string {
  const claims = {
    sub: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    exp: expEpochSeconds,
    act: 'CANDIDATE',
    roles: ['CANDIDATE'],
    session_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    type: 'access',
  }
  return `${base64Url('{"alg":"HS256","typ":"JWT"}')}.${base64Url(JSON.stringify(claims))}.sig`
}

const NOW_MS = Date.UTC(2026, 0, 15, 12, 0, 0)
const NOW_S = NOW_MS / 1000

/** A pair whose Access_Token is well outside its 60-second refresh lead window. */
function freshPair(refresh = 'refresh-1'): TokenPair {
  return { accessToken: accessToken(NOW_S + 1800), refreshToken: refresh }
}

/** A pair whose Access_Token is inside the lead window, so an exchange is due. */
function duePair(refresh = 'refresh-1'): TokenPair {
  return { accessToken: accessToken(NOW_S + 30), refreshToken: refresh }
}

/** The `ApiError` the Api_Client throws for a refused call. */
function apiError(status: number, error = 'invalid_token'): ApiError {
  return decodeApiError({ status, body: { error }, headers: { 'X-Request-ID': 'req-1' } })
}

/** A transport failure: no response, therefore no status, so AC7 does not apply. */
function networkFailure(): Error {
  return new TypeError('Failed to fetch')
}

// ── Harness ───────────────────────────────────────────────────────────────────

interface ArmedTimer {
  readonly delayMs: number
  readonly fire: () => void
  cancelled: boolean
}

interface HarnessOptions {
  /** Stands in for `POST /auth/refresh`. Defaults to a successful exchange. */
  readonly exchange?: (refreshToken: string) => Promise<TokenPair>
  /** Stands in for `POST /auth/logout`. Defaults to a 200. */
  readonly revoke?: (accessToken: string) => Promise<void>
}

interface Harness {
  readonly manager: SessionManager
  /** Every timer the proactive schedule armed, newest last. */
  readonly armed: ArmedTimer[]
  readonly clearCache: ReturnType<typeof vi.fn>
  readonly redirectToLogin: ReturnType<typeof vi.fn>
  readonly exchangeRefreshToken: ReturnType<typeof vi.fn>
  readonly revokeSession: ReturnType<typeof vi.fn>
  /** The Access_Token still held at each `clearCache` call; must always be `null`. */
  readonly tokensWhenCacheCleared: (string | null)[]
}

function harness(options: HarnessOptions = {}): Harness {
  const armed: ArmedTimer[] = []
  const held: { manager: SessionManager | null } = { manager: null }
  const tokensWhenCacheCleared: (string | null)[] = []

  const clearCache = vi.fn((_reason: SessionEndReason) => {
    // Teardown precedes the cache reset, so nothing reacting to it can read a
    // token belonging to the session that just ended.
    tokensWhenCacheCleared.push(held.manager?.getAccessToken() ?? null)
  })
  const redirectToLogin = vi.fn((_reason: SessionEndReason) => undefined)
  const exchangeRefreshToken = vi.fn(options.exchange ?? (async () => freshPair('refresh-2')))
  const revokeSession = vi.fn(options.revoke ?? (async () => undefined))

  const manager = createSessionManager({
    exchangeRefreshToken,
    revokeSession,
    clearCache,
    redirectToLogin,
    now: () => NOW_MS,
    schedule: (callback, delayMs): CancelScheduled => {
      const entry: ArmedTimer = { delayMs, fire: callback, cancelled: false }
      armed.push(entry)
      return () => {
        entry.cancelled = true
      }
    },
  })
  held.manager = manager

  return {
    manager,
    armed,
    clearCache,
    redirectToLogin,
    exchangeRefreshToken,
    revokeSession,
    tokensWhenCacheCleared,
  }
}

/** Asserts the session is gone: no Access_Token, no principal, nothing to refresh with. */
async function expectSessionDiscarded(h: Harness): Promise<void> {
  expect(h.manager.getAccessToken()).toBeNull()
  expect(h.manager.getPrincipal()).toBeNull()
  expect(h.manager.isAuthenticated()).toBe(false)
  expect(h.manager.getSnapshot()).toEqual({ principal: null, authenticated: false })
  // The Refresh_Token is not observable, so its absence is proven by asking for
  // a refresh: only an absent Refresh_Token yields `no-session`, and no further
  // exchange may leave the client.
  const callsBefore = h.exchangeRefreshToken.mock.calls.length
  await expect(h.manager.ensureFresh()).resolves.toEqual({ status: 'no-session' })
  expect(h.exchangeRefreshToken).toHaveBeenCalledTimes(callsBefore)
}

/** Asserts the cache was cleared once with `reason`, and the redirect followed it. */
function expectClearedThenRedirected(h: Harness, reason: SessionEndReason): void {
  expect(h.clearCache.mock.calls).toEqual([[reason]])
  expect(h.redirectToLogin.mock.calls).toEqual([[reason]])
  expect(h.clearCache.mock.invocationCallOrder[0]).toBeLessThan(
    h.redirectToLogin.mock.invocationCallOrder[0] ?? Number.NaN,
  )
  expect(h.tokensWhenCacheCleared).toEqual([null])
}

// ── Persistence guard (AC3, AC11) ─────────────────────────────────────────────

interface PersistenceGuard {
  readonly writes: string[]
  restore(): void
}

let guard: PersistenceGuard

/**
 * Records every attempt to persist anything, so the assertion is the strong "no
 * write was attempted" rather than the weak "no value happened to survive".
 *
 * jsdom implements no IndexedDB, so a recorder stands in for it: code that
 * wanted to persist a token would have to reach for `open`.
 */
function installPersistenceGuard(): PersistenceGuard {
  const writes: string[] = []

  const storageSetItem = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation((key: string) => {
      writes.push(`storage:${key}`)
    })

  const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => '',
    set: (value: string) => {
      writes.push(`cookie:${value}`)
    },
  })

  const indexedDbDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    writable: true,
    value: {
      open: (name: string) => {
        writes.push(`indexeddb:${name}`)
        return {}
      },
      deleteDatabase: (name: string) => {
        writes.push(`indexeddb-delete:${name}`)
        return {}
      },
      databases: async () => [],
    },
  })

  return {
    writes,
    restore: () => {
      storageSetItem.mockRestore()
      if (cookieDescriptor === undefined) {
        Reflect.deleteProperty(document, 'cookie')
      } else {
        Object.defineProperty(document, 'cookie', cookieDescriptor)
      }
      if (indexedDbDescriptor === undefined) {
        Reflect.deleteProperty(globalThis, 'indexedDB')
      } else {
        Object.defineProperty(globalThis, 'indexedDB', indexedDbDescriptor)
      }
    },
  }
}

beforeEach(() => {
  guard = installPersistenceGuard()
})

afterEach(() => {
  const attempted = [...guard.writes]
  guard.restore()
  // AC3, AC11: nothing this module does may outlive the browsing context.
  expect(attempted).toEqual([])
  expect(localStorage.length).toBe(0)
  expect(sessionStorage.length).toBe(0)
})

// ── A refused exchange ends the session (AC7) ─────────────────────────────────

/**
 * 400 and 499 bound the range AC7 names; 401, 403, 404, 422 and 429 are what a
 * refresh endpoint realistically answers with.
 */
const REFUSING_STATUSES = [400, 401, 403, 404, 422, 429, 499] as const

describe('a Refresh_Token exchange refused with a 4xx', () => {
  for (const status of REFUSING_STATUSES) {
    it(`discards both tokens, clears the cache and redirects with the session-expired notice on ${status} (AC7)`, async () => {
      const h = harness({ exchange: () => Promise.reject(apiError(status)) })
      h.manager.login(duePair())
      expect(h.armed).toHaveLength(1)

      const outcome = await h.manager.ensureFresh()

      expect(outcome).toEqual({ status: 'rejected', httpStatus: status })
      expect(h.exchangeRefreshToken.mock.calls).toEqual([['refresh-1']])
      await expectSessionDiscarded(h)
      expectClearedThenRedirected(h, 'session-expired')
      // The proactive schedule cannot outlive the session it belonged to.
      expect(h.armed[0]?.cancelled).toBe(true)
      expect(h.armed).toHaveLength(1)
    })
  }

  it('notifies subscribers that the session is gone', async () => {
    const h = harness({ exchange: () => Promise.reject(apiError(401)) })
    const observed: boolean[] = []
    h.manager.subscribe(() => {
      observed.push(h.manager.isAuthenticated())
    })

    h.manager.login(duePair())
    await h.manager.ensureFresh()

    expect(observed).toEqual([true, false])
  })

  it('ends the session on the 401 path too, and never replays (AC6, AC7)', async () => {
    const h = harness({ exchange: () => Promise.reject(apiError(401)) })
    h.manager.login(freshPair())
    const replay = vi.fn(async () => 'never')

    const outcome = await h.manager.onUnauthorized(replay)

    expect(outcome).toEqual({ replayed: false, refresh: { status: 'rejected', httpStatus: 401 } })
    expect(replay).not.toHaveBeenCalled()
    await expectSessionDiscarded(h)
    expectClearedThenRedirected(h, 'session-expired')
  })
})

// ── A non-4xx failure keeps the session (AC7 by contrast) ─────────────────────

const KEEPING_FAILURES: readonly (readonly [string, () => unknown])[] = [
  ['a 500', () => apiError(500, 'internal_error')],
  ['a 503', () => apiError(503, 'upstream_unavailable')],
  ['a network error carrying no status', networkFailure],
]

describe('a Refresh_Token exchange that failed without a 4xx', () => {
  for (const [label, makeError] of KEEPING_FAILURES) {
    it(`keeps both tokens and neither clears the cache nor redirects for ${label} (AC7)`, async () => {
      const error = makeError()
      const h = harness({ exchange: () => Promise.reject(error) })
      const pair = duePair()
      h.manager.login(pair)

      const outcome = await h.manager.ensureFresh()

      expect(outcome).toEqual({ status: 'failed', error })
      expect(h.manager.getAccessToken()).toBe(pair.accessToken)
      expect(h.manager.isAuthenticated()).toBe(true)
      expect(h.manager.getPrincipal()).not.toBeNull()
      expect(h.clearCache).not.toHaveBeenCalled()
      expect(h.redirectToLogin).not.toHaveBeenCalled()
      // The schedule of the surviving session is neither re-armed nor cancelled.
      expect(h.armed).toHaveLength(1)
      expect(h.armed[0]?.cancelled).toBe(false)
    })
  }

  it('keeps the Refresh_Token usable, so a later exchange still succeeds', async () => {
    let attempts = 0
    const h = harness({
      exchange: async () => {
        attempts += 1
        if (attempts === 1) {
          throw apiError(503, 'upstream_unavailable')
        }
        return freshPair('refresh-2')
      },
    })
    h.manager.login(duePair())

    expect((await h.manager.ensureFresh()).status).toBe('failed')
    const retried = await h.manager.ensureFresh()

    expect(retried.status).toBe('refreshed')
    expect(h.exchangeRefreshToken.mock.calls).toEqual([['refresh-1'], ['refresh-1']])
    expect(h.manager.getAccessToken()).toBe(freshPair().accessToken)
    expect(h.clearCache).not.toHaveBeenCalled()
    expect(h.redirectToLogin).not.toHaveBeenCalled()
  })
})

// ── Logout discards regardless of the response (AC9, AC10) ────────────────────

const LOGOUT_RESPONSES: readonly (readonly [string, () => Promise<void>])[] = [
  ['it returned 200', () => Promise.resolve()],
  ['it returned 401', () => Promise.reject(apiError(401))],
  ['it returned 403', () => Promise.reject(apiError(403, 'access_denied'))],
  ['it returned 422', () => Promise.reject(apiError(422, 'validation_failed'))],
  ['it returned 500', () => Promise.reject(apiError(500, 'internal_error'))],
  ['it returned 503', () => Promise.reject(apiError(503, 'upstream_unavailable'))],
  ['the call failed outright', () => Promise.reject(networkFailure())],
]

describe('logout', () => {
  for (const [label, respond] of LOGOUT_RESPONSES) {
    it(`discards both tokens, clears the cache and redirects when ${label} (AC9, AC10)`, async () => {
      const h = harness({ revoke: respond })
      const pair = freshPair()
      h.manager.login(pair)

      await expect(h.manager.logout()).resolves.toBeUndefined()

      expect(h.revokeSession.mock.calls).toEqual([[pair.accessToken]])
      await expectSessionDiscarded(h)
      expectClearedThenRedirected(h, 'logout')
      expect(h.armed[0]?.cancelled).toBe(true)
      // A refused logout is not an expired session: the login screen must not
      // claim the session timed out when the user ended it deliberately.
      expect(h.redirectToLogin).not.toHaveBeenCalledWith('session-expired')
    })
  }

  it('cannot be handed a new token pair by the exchange it interrupted (AC9)', async () => {
    const deferred: { resolve: ((pair: TokenPair) => void) | null } = { resolve: null }
    const h = harness({
      exchange: () =>
        new Promise<TokenPair>((resolve) => {
          deferred.resolve = resolve
        }),
    })
    h.manager.login(duePair())
    const refreshing = h.manager.ensureFresh()

    await h.manager.logout()
    deferred.resolve?.(freshPair('refresh-2'))

    await expect(refreshing).resolves.toEqual({ status: 'superseded' })
    await expectSessionDiscarded(h)
    expectClearedThenRedirected(h, 'logout')
  })

  it('still clears the cache and redirects when no session is held (AC9)', async () => {
    const h = harness()

    await h.manager.logout()

    expect(h.revokeSession).not.toHaveBeenCalled()
    expectClearedThenRedirected(h, 'logout')
  })
})

// ── A reload starts over (AC11) ───────────────────────────────────────────────

describe('a newly constructed Session_Manager', () => {
  it('holds no session, which is what a page reload produces (AC11)', async () => {
    const h = harness()

    await expectSessionDiscarded(h)
    expect(h.armed).toHaveLength(0)
    expect(h.clearCache).not.toHaveBeenCalled()
    expect(h.redirectToLogin).not.toHaveBeenCalled()
  })

  it('shares nothing with a prior instance that held a session (AC3, AC11)', async () => {
    const before = harness()
    before.manager.login(freshPair())
    expect(before.manager.isAuthenticated()).toBe(true)

    // A reload runs this module again: a new closure, and no session in it.
    const after = harness()

    await expectSessionDiscarded(after)
  })
})
