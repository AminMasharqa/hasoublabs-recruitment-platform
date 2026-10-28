import { afterEach, describe, expect, it, vi } from 'vitest'

import { REFRESH_LEAD_MS } from '../lib/refresh'
import {
  createSessionManager,
  isRefreshRejected,
  refreshRejectionStatus,
  tokenPairFrom,
  type CancelScheduled,
  type SessionManagerConfig,
  type TokenPair,
} from './SessionManager'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** An unsigned JWT; the Web_Client never verifies the signature. */
function accessToken(expEpochSeconds: number, overrides: Record<string, unknown> = {}): string {
  const claims = {
    sub: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    exp: expEpochSeconds,
    act: 'CANDIDATE',
    roles: ['CANDIDATE'],
    session_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    type: 'access',
    ...overrides,
  }
  return `${base64Url('{"alg":"HS256","typ":"JWT"}')}.${base64Url(JSON.stringify(claims))}.sig`
}

const NOW_MS = Date.UTC(2026, 0, 15, 12, 0, 0)

function pair(expEpochSeconds: number, refresh = 'refresh-1'): TokenPair {
  return { accessToken: accessToken(expEpochSeconds), refreshToken: refresh }
}

interface Harness {
  readonly manager: ReturnType<typeof createSessionManager>
  readonly armed: { delayMs: number; fire: () => void; cancelled: boolean }[]
  readonly clearCache: ReturnType<typeof vi.fn>
  readonly redirectToLogin: ReturnType<typeof vi.fn>
  readonly exchangeRefreshToken: ReturnType<typeof vi.fn>
  readonly revokeSession: ReturnType<typeof vi.fn>
}

function harness(overrides: Partial<SessionManagerConfig> = {}): Harness {
  const armed: Harness['armed'] = []
  const clearCache = vi.fn()
  const redirectToLogin = vi.fn()
  const exchangeRefreshToken = vi.fn(async () => pair(NOW_MS / 1000 + 1800, 'refresh-2'))
  const revokeSession = vi.fn(async () => undefined)
  const manager = createSessionManager({
    exchangeRefreshToken,
    revokeSession,
    clearCache,
    redirectToLogin,
    now: () => NOW_MS,
    schedule: (callback, delayMs): CancelScheduled => {
      const entry = { delayMs, fire: callback, cancelled: false }
      armed.push(entry)
      return () => {
        entry.cancelled = true
      }
    },
    ...overrides,
  })
  return { manager, armed, clearCache, redirectToLogin, exchangeRefreshToken, revokeSession }
}

afterEach(() => {
  expect(localStorage.length).toBe(0)
  expect(sessionStorage.length).toBe(0)
  expect(document.cookie).toBe('')
})

// ── In-memory custody (AC3, AC11) ─────────────────────────────────────────────

describe('createSessionManager', () => {
  it('starts with no session, which is what a page reload produces (AC11)', () => {
    const { manager } = harness()

    expect(manager.getAccessToken()).toBeNull()
    expect(manager.getPrincipal()).toBeNull()
    expect(manager.isAuthenticated()).toBe(false)
    expect(manager.getSnapshot()).toEqual({ principal: null, authenticated: false })
  })

  it('keeps tokens out of storage and out of the observable snapshot (AC3)', () => {
    const { manager } = harness()

    manager.login(pair(NOW_MS / 1000 + 1800))

    expect(manager.getAccessToken()).not.toBeNull()
    expect(JSON.stringify(manager.getSnapshot())).not.toContain('refresh-1')
    expect(Object.keys(manager.getSnapshot())).toEqual(['principal', 'authenticated'])
  })
})

// ── Login and proactive scheduling (AC2, AC4) ─────────────────────────────────

describe('login', () => {
  it('decodes the principal and arms the refresh timer 60s before expiry (AC2, AC4)', () => {
    const { manager, armed } = harness()
    const exp = NOW_MS / 1000 + 1800

    const principal = manager.login(pair(exp))

    expect(principal).toMatchObject({ act: 'CANDIDATE', roles: ['CANDIDATE'], exp })
    expect(armed).toHaveLength(1)
    expect(armed[0]?.delayMs).toBe(exp * 1000 - REFRESH_LEAD_MS - NOW_MS)
  })

  it('notifies subscribers', () => {
    const { manager } = harness()
    const listener = vi.fn()
    const unsubscribe = manager.subscribe(listener)

    manager.login(pair(NOW_MS / 1000 + 1800))
    unsubscribe()
    manager.login(pair(NOW_MS / 1000 + 1800))

    expect(listener).toHaveBeenCalledTimes(1)
  })
})

// ── Freshness funnel (AC5, AC8) ───────────────────────────────────────────────

describe('ensureFresh', () => {
  it('issues no exchange while the Access_Token is outside its lead window', async () => {
    const { manager, exchangeRefreshToken } = harness()
    manager.login(pair(NOW_MS / 1000 + 1800))

    await expect(manager.ensureFresh()).resolves.toEqual({ status: 'fresh' })
    expect(exchangeRefreshToken).not.toHaveBeenCalled()
  })

  it('reports no-session when no Refresh_Token is held', async () => {
    const { manager, exchangeRefreshToken } = harness()

    await expect(manager.ensureFresh()).resolves.toEqual({ status: 'no-session' })
    expect(exchangeRefreshToken).not.toHaveBeenCalled()
  })

  it('replaces both tokens on success and re-arms the timer (AC5)', async () => {
    const { manager, armed, exchangeRefreshToken } = harness()
    // Inside the lead window, so the exchange is due.
    manager.login(pair(NOW_MS / 1000 + 30))

    const outcome = await manager.ensureFresh()

    expect(outcome.status).toBe('refreshed')
    expect(exchangeRefreshToken).toHaveBeenCalledWith('refresh-1')
    expect(manager.getAccessToken()).toBe(pair(NOW_MS / 1000 + 1800, 'refresh-2').accessToken)
    expect(armed.at(-1)?.delayMs).toBe(1800 * 1000 - REFRESH_LEAD_MS)
  })
})

// ── Rejection classification (AC7) ────────────────────────────────────────────

describe('refresh rejection classification', () => {
  it('reads the ApiError status and treats only 4xx as a dead Refresh_Token', () => {
    expect(refreshRejectionStatus({ httpStatus: 401 })).toBe(401)
    expect(refreshRejectionStatus(new TypeError('network'))).toBeNull()
    expect(isRefreshRejected({ httpStatus: 401 })).toBe(true)
    expect(isRefreshRejected({ httpStatus: 503 })).toBe(false)
    expect(isRefreshRejected(new TypeError('network'))).toBe(false)
  })
})

// ── Wire shape ────────────────────────────────────────────────────────────────

describe('tokenPairFrom', () => {
  it('keeps only the two tokens of a TokenResponse', () => {
    expect(tokenPairFrom({ access_token: 'a', refresh_token: 'r' })).toEqual({
      accessToken: 'a',
      refreshToken: 'r',
    })
  })
})
