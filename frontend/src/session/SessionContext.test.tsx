import { act, render, renderHook, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { decideRouteAccess, ONBOARDING_SCREEN_ACCESS } from '../routing/access'

import { SessionProvider } from './SessionContext'
import {
  retainedStatusFrom,
  useAccessSubject,
  useIsAuthenticated,
  usePrincipal,
  useRetainedStatus,
  useSession,
  type LocaleApplier,
} from './sessionState'
import {
  createSessionManager,
  type SessionManager,
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
function accessToken(overrides: Record<string, unknown> = {}): string {
  const claims = {
    sub: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    exp: NOW_MS / 1000 + 1800,
    act: 'CANDIDATE',
    roles: ['CANDIDATE'],
    session_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    type: 'access',
    ...overrides,
  }
  return `${base64Url('{"alg":"HS256","typ":"JWT"}')}.${base64Url(JSON.stringify(claims))}.sig`
}

const NOW_MS = Date.UTC(2026, 0, 15, 12, 0, 0)

function pair(overrides: Record<string, unknown> = {}, refresh = 'refresh-1'): TokenPair {
  return { accessToken: accessToken(overrides), refreshToken: refresh }
}

function stubManager(overrides: Partial<SessionManagerConfig> = {}): SessionManager {
  return createSessionManager({
    exchangeRefreshToken: async () => pair({}, 'refresh-2'),
    revokeSession: async () => undefined,
    clearCache: () => undefined,
    redirectToLogin: () => undefined,
    now: () => NOW_MS,
    // Never fires: this suite exercises the context, not the refresh schedule.
    schedule: () => () => undefined,
    ...overrides,
  })
}

function wrapperFor(manager: SessionManager, applyLocale?: LocaleApplier) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <SessionProvider manager={manager} applyLocale={applyLocale}>
        {children}
      </SessionProvider>
    )
  }
}

function renderSession(manager: SessionManager, applyLocale?: LocaleApplier) {
  return renderHook(() => useSession(), { wrapper: wrapperFor(manager, applyLocale) })
}

/** Whether a context member is (or carries) a token accessor. */
function isTokenAccessor(member: unknown): boolean {
  if (typeof member === 'function') {
    return member.name === 'getAccessToken'
  }
  return typeof member === 'object' && member !== null && 'getAccessToken' in member
}

/** Every string reachable from a value, however deeply nested. */
function reachableStrings(value: unknown, seen = new Set<object>()): string[] {
  if (typeof value === 'string') {
    return [value]
  }
  if (typeof value !== 'object' || value === null || seen.has(value)) {
    return []
  }
  seen.add(value)
  return Object.values(value).flatMap((member) => reachableStrings(member, seen))
}

// Requirement 4 AC3: no token may reach a storage the page can read back.
afterEach(() => {
  expect(localStorage.length).toBe(0)
  expect(sessionStorage.length).toBe(0)
  expect(document.cookie).toBe('')
})

// ── Session state ─────────────────────────────────────────────────────────────

describe('SessionProvider', () => {
  it('publishes the absent session before a login', () => {
    const { result } = renderSession(stubManager())

    expect(result.current.authenticated).toBe(false)
    expect(result.current.principal).toBeNull()
    expect(result.current.roles).toEqual([])
    expect(result.current.act).toBeNull()
    expect(result.current.status).toBeNull()
    expect(result.current.nextStep).toBeNull()
    expect(result.current.subject).toBeNull()
  })

  it('republishes the claims of an established session', () => {
    const { result } = renderSession(stubManager())

    act(() => {
      result.current.establishSession(pair({ roles: ['CANDIDATE', 'SENIOR'], act: 'SENIOR' }))
    })

    expect(result.current.authenticated).toBe(true)
    expect(result.current.principal?.sub).toBe('7c9e6679-7425-40de-944b-e07fc1f90ae7')
    expect(result.current.roles).toEqual(['CANDIDATE', 'SENIOR'])
    expect(result.current.act).toBe('SENIOR')
  })

  it('re-renders on a session change made outside React', () => {
    const manager = stubManager()
    const { result } = renderSession(manager)

    act(() => {
      manager.login(pair())
    })

    expect(result.current.authenticated).toBe(true)

    act(() => {
      manager.clear('session-expired')
    })

    expect(result.current.authenticated).toBe(false)
    expect(result.current.principal).toBeNull()
  })

  it('keeps the context value identity stable across re-renders', () => {
    const { result, rerender } = renderSession(stubManager())
    const first = result.current

    rerender()

    expect(result.current).toBe(first)
  })
})

// ── AC3: no token material, no persistence ────────────────────────────────────

describe('token custody', () => {
  it('exposes neither token nor the manager through the context', () => {
    const { result } = renderSession(stubManager())
    const adopted = pair()

    act(() => {
      result.current.establishSession(adopted)
    })

    const strings = reachableStrings(result.current)
    expect(strings).not.toContain(adopted.accessToken)
    expect(strings).not.toContain(adopted.refreshToken)
    // Nothing on the context value is a token accessor or the manager itself.
    expect('getAccessToken' in result.current).toBe(false)
    expect(Object.values(result.current).some((member) => isTokenAccessor(member))).toBe(false)
  })

  it('renders the principal without writing any token to storage', () => {
    const manager = stubManager()

    function Identity() {
      const principal = usePrincipal()
      const authenticated = useIsAuthenticated()
      return <output>{`${String(authenticated)}:${principal?.act ?? 'none'}`}</output>
    }

    manager.login(pair())
    render(
      <SessionProvider manager={manager}>
        <Identity />
      </SessionProvider>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('true:CANDIDATE')
  })
})

// ── Retained Account_Status ───────────────────────────────────────────────────

describe('retained Account_Status', () => {
  it('assembles the AccessSubject the Route_Guard consumes', () => {
    const { result } = renderSession(stubManager())

    act(() => {
      result.current.establishSession(pair())
    })
    // Before GET /me/status resolves the guard can take no gate decision.
    expect(decideRouteAccess(result.current.subject, ONBOARDING_SCREEN_ACCESS)).toBe('await-status')

    act(() => {
      result.current.retainStatus({ status: 'PendingApproval', nextStep: 'await_review' })
    })

    expect(result.current.subject).toEqual({
      roles: ['CANDIDATE'],
      act: 'CANDIDATE',
      status: 'PendingApproval',
    })
    expect(result.current.nextStep).toBe('await_review')
    expect(decideRouteAccess(result.current.subject, ONBOARDING_SCREEN_ACCESS)).toBe('admit')
  })

  it('replaces the retained value and returns it to unknown on null', () => {
    const { result } = renderSession(stubManager())

    act(() => {
      result.current.establishSession(pair())
      result.current.retainStatus({ status: 'PendingApproval', nextStep: 'await_review' })
    })
    act(() => {
      result.current.retainStatus({ status: 'Approved', nextStep: null })
    })

    expect(result.current.status).toBe('Approved')
    expect(result.current.nextStep).toBeNull()

    act(() => {
      result.current.retainStatus(null)
    })

    expect(result.current.status).toBeNull()
  })

  it('drops the retained value when the session ends and does not restore it on the next login', async () => {
    const { result } = renderSession(stubManager())

    act(() => {
      result.current.establishSession(pair())
      result.current.retainStatus({ status: 'Approved', nextStep: null })
    })
    expect(result.current.status).toBe('Approved')

    await act(async () => {
      await result.current.logout()
    })
    expect(result.current.status).toBeNull()

    act(() => {
      // Same account, new session: the status must be re-read, not remembered.
      result.current.establishSession(pair())
    })

    expect(result.current.authenticated).toBe(true)
    expect(result.current.status).toBeNull()
  })

  it('exposes the retained value through useRetainedStatus', () => {
    const manager = stubManager()
    const { result } = renderHook(
      () => ({ session: useSession(), retained: useRetainedStatus(), subject: useAccessSubject() }),
      { wrapper: wrapperFor(manager) },
    )

    expect(result.current.retained).toBeNull()

    act(() => {
      result.current.session.establishSession(pair())
      result.current.session.retainStatus({ status: 'Suspended', nextStep: 'contact_admin' })
    })

    expect(result.current.retained).toEqual({ status: 'Suspended', nextStep: 'contact_admin' })
    expect(result.current.subject?.status).toBe('Suspended')
  })
})

describe('retainedStatusFrom', () => {
  it('reads the GET /me/status and account_not_approved payload shape', () => {
    expect(retainedStatusFrom({ status: 'PendingVerification', next_step: 'verify_email' })).toEqual({
      status: 'PendingVerification',
      nextStep: 'verify_email',
    })
    expect(retainedStatusFrom({ status: 'Approved' })).toEqual({ status: 'Approved', nextStep: null })
    expect(retainedStatusFrom({ status: 'Approved', next_step: '' })).toEqual({
      status: 'Approved',
      nextStep: null,
    })
  })

  it('rejects a payload carrying no usable status', () => {
    expect(retainedStatusFrom(null)).toBeNull()
    expect(retainedStatusFrom('Approved')).toBeNull()
    expect(retainedStatusFrom({})).toBeNull()
    expect(retainedStatusFrom({ status: 'approved' })).toBeNull()
    expect(retainedStatusFrom({ status: 42 })).toBeNull()
  })
})

// ── Session establishment side effects ────────────────────────────────────────

describe('establishSession', () => {
  it('applies the account Locale when a language preference is supplied', () => {
    const applyLocale = vi.fn<LocaleApplier>(async () => 'ar')
    const { result } = renderSession(stubManager(), applyLocale)

    act(() => {
      result.current.establishSession(pair(), { languagePreference: 'ar' })
    })

    expect(applyLocale).toHaveBeenCalledTimes(1)
    expect(applyLocale).toHaveBeenCalledWith('ar')
  })

  it('leaves the active Locale alone when no preference is supplied', () => {
    const applyLocale = vi.fn<LocaleApplier>(async () => 'en')
    const { result } = renderSession(stubManager(), applyLocale)

    act(() => {
      result.current.establishSession(pair())
    })

    expect(applyLocale).not.toHaveBeenCalled()
  })

  it('returns the decoded principal, or null for an undecodable token', () => {
    const { result } = renderSession(stubManager())
    let decoded: unknown

    act(() => {
      decoded = result.current.establishSession(pair({ act: 'NOT_A_ROLE' }))
    })

    expect(decoded).toBeNull()

    act(() => {
      decoded = result.current.establishSession(pair())
    })

    expect(decoded).toMatchObject({ act: 'CANDIDATE', roles: ['CANDIDATE'] })
  })
})

// ── Teardown paths ────────────────────────────────────────────────────────────

describe('session teardown', () => {
  it('logout revokes the session, clears the cache and redirects', async () => {
    const revokeSession = vi.fn(async () => undefined)
    const clearCache = vi.fn()
    const redirectToLogin = vi.fn()
    const { result } = renderSession(stubManager({ revokeSession, clearCache, redirectToLogin }))

    act(() => {
      result.current.establishSession(pair())
    })
    await act(async () => {
      await result.current.logout()
    })

    expect(revokeSession).toHaveBeenCalledTimes(1)
    expect(clearCache).toHaveBeenCalledWith('logout')
    expect(redirectToLogin).toHaveBeenCalledWith('logout')
    expect(result.current.authenticated).toBe(false)
  })

  it('clear ends the session with the given reason', () => {
    const clearCache = vi.fn()
    const redirectToLogin = vi.fn()
    const { result } = renderSession(stubManager({ clearCache, redirectToLogin }))

    act(() => {
      result.current.establishSession(pair())
      result.current.clear('session-expired')
    })

    expect(clearCache).toHaveBeenCalledWith('session-expired')
    expect(redirectToLogin).toHaveBeenCalledWith('session-expired')
    expect(result.current.authenticated).toBe(false)
    expect(result.current.subject).toBeNull()
  })
})

// ── Wiring errors ─────────────────────────────────────────────────────────────

describe('useSession', () => {
  it('reports a missing provider instead of reporting no session', () => {
    expect(() => renderHook(() => useSession())).toThrow(/SessionProvider/)
  })
})
