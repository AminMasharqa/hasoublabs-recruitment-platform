import { describe, expect, it } from 'vitest'

import {
  REFRESH_LEAD_MS,
  REFRESH_LEAD_SECONDS,
  computeRefreshAtEpochMs,
  computeRefreshDelayMs,
  computeRefreshTiming,
  decodeJwtClaims,
  decodePrincipal,
  isRefreshDue,
  refreshDeadlineEpochMs,
  refreshTimingForToken,
} from './refresh'

// ── Token fixtures ────────────────────────────────────────────────────────────

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** Builds an unsigned JWT with the given claims. The signature is never verified. */
function jwt(claims: Record<string, unknown>): string {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  return `${header}.${base64Url(JSON.stringify(claims))}.c2lnbmF0dXJl`
}

const NOW_MS = Date.UTC(2026, 0, 15, 12, 0, 0)
const NOW_SECONDS = NOW_MS / 1000

/** The claim set the Backend_Api mints for an access token (`_build_access_payload`). */
function accessClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    iat: NOW_SECONDS,
    exp: NOW_SECONDS + 1800,
    act: 'CANDIDATE',
    roles: ['CANDIDATE', 'SENIOR'],
    session_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    type: 'access',
    ...overrides,
  }
}

// ── Claim decoding ────────────────────────────────────────────────────────────

describe('decodeJwtClaims', () => {
  it('base64url-decodes the claims segment without verifying the signature', () => {
    const token = `${base64Url('{"alg":"none"}')}.${base64Url('{"sub":"abc"}')}.tampered`

    expect(decodeJwtClaims(token)).toEqual({ sub: 'abc' })
  })

  it('decodes non-ASCII claim values as UTF-8', () => {
    const claims = decodeJwtClaims(jwt(accessClaims({ sub: 'حساب-משתמש' })))

    expect(claims?.['sub']).toBe('حساب-משתמש')
  })

  it('returns null for a malformed token instead of throwing', () => {
    const malformed: unknown[] = [
      undefined,
      null,
      42,
      '',
      'not-a-jwt',
      'only.two',
      'a.b.c.d',
      // Claims segment is not base64url.
      'aGVhZGVy.not base64url!.sig',
      // Claims segment decodes to JSON that is not an object.
      `aGVhZGVy.${base64Url('[1,2,3]')}.sig`,
      `aGVhZGVy.${base64Url('"just-a-string"')}.sig`,
      `aGVhZGVy.${base64Url('null')}.sig`,
      // Claims segment is not JSON at all.
      `aGVhZGVy.${base64Url('{oops')}.sig`,
      // 4n+1 base64 body encodes no whole byte.
      'aGVhZGVy.QQQQQ.sig',
    ]

    for (const token of malformed) {
      expect(decodeJwtClaims(token), String(token)).toBeNull()
    }
  })
})

describe('decodePrincipal', () => {
  it('decodes sub, roles, act, session_id and exp (Requirement 4 AC2)', () => {
    expect(decodePrincipal(jwt(accessClaims()))).toEqual({
      sub: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      roles: ['CANDIDATE', 'SENIOR'],
      act: 'CANDIDATE',
      sessionId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      exp: NOW_SECONDS + 1800,
    })
  })

  it('decodes an already-expired token, leaving expiry to the Session_Manager', () => {
    const principal = decodePrincipal(jwt(accessClaims({ exp: NOW_SECONDS - 10 })))

    expect(principal?.exp).toBe(NOW_SECONDS - 10)
  })

  it('returns null when a required claim is missing or unusable', () => {
    const unusable: Record<string, unknown>[] = [
      { sub: undefined },
      { sub: '' },
      { sub: 123 },
      { session_id: undefined },
      { session_id: '' },
      { exp: undefined },
      { exp: '1800' },
      { exp: Number.NaN },
      { exp: 0 },
      { act: undefined },
      { act: 'MANAGER' },
      { act: 'candidate' },
      { roles: undefined },
      { roles: [] },
      { roles: 'CANDIDATE' },
      { roles: ['MANAGER'] },
    ]

    for (const overrides of unusable) {
      expect(decodePrincipal(jwt(accessClaims(overrides))), JSON.stringify(overrides)).toBeNull()
    }
  })

  it('ignores unrecognized role members and deduplicates the rest', () => {
    const principal = decodePrincipal(
      jwt(accessClaims({ roles: ['SENIOR', 'MANAGER', 'SENIOR', 7, null, 'CANDIDATE'] })),
    )

    expect(principal?.roles).toEqual(['SENIOR', 'CANDIDATE'])
  })

  it('returns null for a malformed token', () => {
    expect(decodePrincipal('not-a-jwt')).toBeNull()
    expect(decodePrincipal(null)).toBeNull()
  })
})

// ── Refresh-time computation ──────────────────────────────────────────────────

describe('computeRefreshTiming', () => {
  it('schedules the exchange exactly 60 seconds before expiry (Requirement 4 AC4)', () => {
    const exp = NOW_SECONDS + 1800

    const timing = computeRefreshTiming(exp, NOW_MS)

    expect(timing).toEqual({
      deadlineEpochMs: exp * 1000 - REFRESH_LEAD_MS,
      atEpochMs: exp * 1000 - REFRESH_LEAD_MS,
      delayMs: (1800 - REFRESH_LEAD_SECONDS) * 1000,
      due: false,
      expired: false,
    })
  })

  it('keeps the scheduled instant within [now, exp - 60s]', () => {
    const exp = NOW_SECONDS + 300

    const timing = computeRefreshTiming(exp, NOW_MS)

    expect(timing?.atEpochMs).toBeGreaterThanOrEqual(NOW_MS)
    expect(timing?.atEpochMs).toBeLessThanOrEqual(exp * 1000 - REFRESH_LEAD_MS)
  })

  it('makes the exchange due immediately inside the 60-second lead window', () => {
    const timing = computeRefreshTiming(NOW_SECONDS + 30, NOW_MS)

    expect(timing).toMatchObject({ atEpochMs: NOW_MS, delayMs: 0, due: true, expired: false })
  })

  it('reports an expired token as due and expired', () => {
    const timing = computeRefreshTiming(NOW_SECONDS - 120, NOW_MS)

    expect(timing).toMatchObject({ atEpochMs: NOW_MS, delayMs: 0, due: true, expired: true })
  })

  it('treats the deadline boundary as due', () => {
    const exp = NOW_SECONDS + REFRESH_LEAD_SECONDS

    expect(computeRefreshTiming(exp, NOW_MS)).toMatchObject({ delayMs: 0, due: true })
  })

  it('returns null for an unusable exp or clock reading', () => {
    expect(computeRefreshTiming(undefined, NOW_MS)).toBeNull()
    expect(computeRefreshTiming('1800', NOW_MS)).toBeNull()
    expect(computeRefreshTiming(Number.NaN, NOW_MS)).toBeNull()
    expect(computeRefreshTiming(Number.POSITIVE_INFINITY, NOW_MS)).toBeNull()
    expect(computeRefreshTiming(NOW_SECONDS + 1800, Number.NaN)).toBeNull()
    expect(computeRefreshTiming(NOW_SECONDS + 1800, undefined)).toBeNull()
  })
})

describe('refreshDeadlineEpochMs / isRefreshDue', () => {
  it('places the deadline 60 seconds before expiry', () => {
    expect(refreshDeadlineEpochMs(NOW_SECONDS + 1800)).toBe((NOW_SECONDS + 1740) * 1000)
  })

  it('is due only once the deadline is reached', () => {
    const exp = NOW_SECONDS + 1800

    expect(isRefreshDue(exp, refreshDeadlineEpochMs(exp) - 1)).toBe(false)
    expect(isRefreshDue(exp, refreshDeadlineEpochMs(exp))).toBe(true)
  })
})

describe('projections', () => {
  it('expose the scheduled instant and the timer delay', () => {
    const exp = NOW_SECONDS + 1800

    expect(computeRefreshAtEpochMs(exp, NOW_MS)).toBe(exp * 1000 - REFRESH_LEAD_MS)
    expect(computeRefreshDelayMs(exp, NOW_MS)).toBe(1740 * 1000)
    expect(computeRefreshAtEpochMs(undefined, NOW_MS)).toBeNull()
    expect(computeRefreshDelayMs(undefined, NOW_MS)).toBeNull()
  })
})

describe('refreshTimingForToken', () => {
  it('decodes the token and schedules from its exp claim', () => {
    const exp = NOW_SECONDS + 1800

    expect(refreshTimingForToken(jwt(accessClaims({ exp })), NOW_MS)?.atEpochMs).toBe(
      exp * 1000 - REFRESH_LEAD_MS,
    )
  })

  it('returns null when the token yields no usable principal', () => {
    expect(refreshTimingForToken('not-a-jwt', NOW_MS)).toBeNull()
    expect(refreshTimingForToken(jwt(accessClaims({ act: 'MANAGER' })), NOW_MS)).toBeNull()
  })
})
