/**
 * Component tests for the Route_Guard (task 11.6).
 *
 * The admission *logic* is pure and already property tested in
 * `access.ts` / `access.*.property.test.ts`; nothing here re-tests it. What these
 * tests cover is the part that only exists once the decision is rendered inside a
 * router and a session:
 *
 * - **Req 8 AC2** an unauthenticated navigation to a guarded path renders the
 *   login screen and the requested location survives the redirect, round-tripping
 *   through router state via `loginRedirectState` → `requestedLocationFrom` →
 *   `postLoginPath`.
 * - **Req 8 AC4** an authenticated refusal renders the uniform denied surface, the
 *   target screen does not render, and — asserted with a recording Api_Client —
 *   the only request the browsing context ever issued is `GET /me/status`, never
 *   the one the target route would have made.
 * - **Req 7 AC2** a non-`Approved` session is redirected to the Status_Notice from
 *   a feature route and admitted to an Onboarding_Screen.
 * - **Req 7 AC1** `GET /me/status` is issued exactly once per established session,
 *   with the loading state rendered while it is outstanding, the error state with a
 *   working retry when it fails, and admission once it resolves.
 * - **Req 7 AC6** an `account_not_approved` envelope reported from anywhere
 *   replaces the retained status and the guard then redirects to the Status_Notice.
 * - **Req 8 AC11** `LandingRedirect` sends each Active_Context to its
 *   `LANDING_PATHS` entry.
 *
 * ## How "the target's request is never issued" is asserted
 *
 * The Api_Client is a stub that records every `(method, path)` it is asked for and
 * refuses anything other than the status read. The target screen issues
 * `GET /api/v1/jobs` from an effect, so if a refused route ever mounted the
 * recording would show it. A passing assertion of
 * `requests === ['get /api/v1/me/status']` is therefore evidence that the target
 * element never mounted, which is how Requirement 8 AC4 holds structurally.
 *
 * The `account_not_approved` store is module scoped, so every test clears it.
 */

import { MantineProvider } from '@mantine/core'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { i18n as I18nextInstance } from 'i18next'
import { useEffect } from 'react'
import { I18nextProvider } from 'react-i18next'
import {
  createMemoryRouter,
  RouterProvider,
  useLocation,
  type RouteObject,
} from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ApiClient } from '../api/client'
import type { AccountStatus, Role } from '../api/enums'
import { decodeApiError } from '../api/errors'
import { createI18n } from '../i18n'
import { SessionProvider } from '../session/SessionContext'
import {
  createSessionManager,
  type SessionManager,
  type SessionManagerConfig,
  type TokenPair,
} from '../session/SessionManager'

import { ONBOARDING_SCREEN_ACCESS, type ActiveContext, type RouteAccess } from './access'
import {
  ACCOUNT_NOT_APPROVED_ERROR,
  clearAccountNotApproved,
  ME_STATUS_PATH,
  reportAccountNotApproved,
} from './accountStatus'
import {
  LANDING_PATHS,
  LOGIN_PATH,
  loginRedirectState,
  postLoginPath,
  requestedLocationFrom,
  ROUTE_PATHS,
  STATUS_NOTICE_PATH,
} from './paths'
import { ADMIN_ACCESS, CANDIDATE_ACCESS } from './routeAccess'
import { LandingRedirect, RouteGuard } from './RouteGuard'

// ── Session fixtures ──────────────────────────────────────────────────────────

const NOW_MS = Date.UTC(2026, 0, 15, 12, 0, 0)

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

function pair(overrides: Record<string, unknown> = {}): TokenPair {
  return { accessToken: accessToken(overrides), refreshToken: 'refresh-1' }
}

function stubManager(overrides: Partial<SessionManagerConfig> = {}): SessionManager {
  return createSessionManager({
    exchangeRefreshToken: () => Promise.reject(new Error('no refresh in this suite')),
    revokeSession: () => Promise.resolve(),
    clearCache: () => undefined,
    redirectToLogin: () => undefined,
    now: () => NOW_MS,
    // Never fires: this suite exercises the guard, not the refresh schedule.
    schedule: () => () => undefined,
    ...overrides,
  })
}

/** A signed-in manager, its claims chosen by the caller. */
function signedIn(
  roles: readonly Role[] = ['CANDIDATE'],
  context: ActiveContext = 'CANDIDATE',
  sub = '7c9e6679-7425-40de-944b-e07fc1f90ae7',
): SessionManager {
  const manager = stubManager()
  manager.login(pair({ roles, act: context, sub }))
  return manager
}

// ── The recording Api_Client ───────────────────────────────────────────────────

/** The `{status, next_step}` body `GET /me/status` answers with (Req 7 AC1). */
interface StatusBody {
  readonly status: AccountStatus
  readonly next_step?: string | null
}

/** Answers the nth status read; rejecting is a failed read. */
type StatusAnswer = (attempt: number) => Promise<StatusBody>

interface RecordingApi {
  /** The stub, shaped as the Api_Client the guard and the target screen consume. */
  readonly api: ApiClient
  /** Every request the browsing context issued, as `"method path"`, in order. */
  readonly requests: string[]
}

/** The status read the guard issues, recorded as `"get /api/v1/me/status"`. */
const STATUS_READ = `get ${ME_STATUS_PATH}`

/** The read the target screen issues when — and only when — it mounts. */
const TARGET_READ = 'get /api/v1/jobs'

/**
 * An Api_Client that records every request and answers only the status read.
 *
 * Anything else rejects with a named error, so a request the guard was supposed
 * to prevent is both recorded and loud.
 */
function recordingApi(answerStatus: StatusAnswer): RecordingApi {
  const requests: string[] = []
  let attempts = 0

  const request = async (method: string, path: string): Promise<unknown> => {
    requests.push(`${method} ${path}`)
    if (path !== ME_STATUS_PATH) {
      throw new Error(`a refused route issued ${method} ${path}`)
    }
    const attempt = attempts
    attempts += 1
    const data = await answerStatus(attempt)
    return { data, response: new Response(null, { status: 200 }), supportReference: null }
  }

  return {
    requests,
    api: {
      request,
      exchangeRefreshToken: () => Promise.reject(new Error('unused')),
      revokeSession: () => Promise.resolve(),
    } as unknown as ApiClient,
  }
}

/** A status read that always answers the same retained pair. */
function answers(status: AccountStatus, nextStep: string | null = null): StatusAnswer {
  return () => Promise.resolve({ status, next_step: nextStep })
}

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

/** A read failure that is not `account_not_approved` (Req 21 AC8). */
function statusReadFailure() {
  return decodeApiError({
    status: 503,
    body: { error: 'upstream_unavailable', details: { service: 'identity' } },
    headers: { 'X-Request-ID': 'req-status-read' },
  })
}

// ── Harness ───────────────────────────────────────────────────────────────────

let i18n: I18nextInstance

beforeEach(() => {
  clearAccountNotApproved()
  i18n = createI18n('en')
})

afterEach(() => {
  clearAccountNotApproved()
})

function renderRouter(routes: RouteObject[], entry: string, manager: SessionManager) {
  const router = createMemoryRouter(routes, { initialEntries: [entry] })
  render(
    <MantineProvider>
      <I18nextProvider i18n={i18n}>
        <SessionProvider manager={manager}>
          <RouterProvider router={router} />
        </SessionProvider>
      </I18nextProvider>
    </MantineProvider>,
  )
  return router
}

/** The guarded target. Anything under `/candidate` needs the Candidate context. */
const TARGET_PATH = ROUTE_PATHS.candidateProfile
const TARGET_SEARCH = '?tab=skills'
const TARGET_HASH = '#education'
const TARGET_ENTRY = `${TARGET_PATH}${TARGET_SEARCH}${TARGET_HASH}`

/**
 * The login screen, reporting what the redirect retained (Req 8 AC2).
 *
 * Reads the retained location back through the same helpers the real login screen
 * will use, so the assertion is on the round trip rather than on the state shape.
 */
function LoginProbe() {
  const { state } = useLocation()
  return (
    <div data-testid="login-screen">
      <span data-testid="retained-location">{requestedLocationFrom(state) ?? ''}</span>
      <span data-testid="post-login-path">{postLoginPath(state, 'CANDIDATE')}</span>
    </div>
  )
}

/**
 * The guarded screen. Issues the request its feature slice would issue, so a
 * mount that should never have happened is recorded (Req 8 AC4).
 */
function TargetProbe({ api }: { readonly api: ApiClient }) {
  useEffect(() => {
    void api.request('get', '/api/v1/jobs').catch(() => undefined)
  }, [api])
  return <div data-testid="target-screen" />
}

/** One guarded group, with the login and Status_Notice screens it redirects to. */
function guardedRoutes(access: RouteAccess, api: ApiClient): RouteObject[] {
  return [
    { path: LOGIN_PATH, element: <LoginProbe /> },
    { path: STATUS_NOTICE_PATH, element: <div data-testid="status-notice-screen" /> },
    {
      // A pathless layout route, exactly as `routes.tsx` declares its groups.
      element: <RouteGuard access={access} api={api} />,
      children: [{ path: TARGET_PATH, element: <TargetProbe api={api} /> }],
    },
  ]
}

// ── Requirement 8 AC2: no Access_Token ────────────────────────────────────────

describe('RouteGuard with no session (Requirement 8 AC2)', () => {
  it('renders the login screen and retains path, query and fragment', async () => {
    const { api, requests } = recordingApi(answers('Approved'))
    const router = renderRouter(guardedRoutes(CANDIDATE_ACCESS, api), TARGET_ENTRY, stubManager())

    expect(await screen.findByTestId('login-screen')).toBeInTheDocument()
    expect(screen.queryByTestId('target-screen')).toBeNull()
    expect(router.state.location.pathname).toBe(LOGIN_PATH)

    // The retained location is router state, so it stays out of the address bar.
    expect(router.state.location.search).toBe('')
    expect(router.state.location.state).toEqual(
      loginRedirectState({ pathname: TARGET_PATH, search: TARGET_SEARCH, hash: TARGET_HASH }),
    )
    // …and it round-trips back to the location the user actually asked for.
    expect(screen.getByTestId('retained-location')).toHaveTextContent(TARGET_ENTRY)
    expect(screen.getByTestId('post-login-path')).toHaveTextContent(TARGET_ENTRY)

    // Nothing was asked of the Backend_Api: an absent session needs no status read.
    expect(requests).toEqual([])
  })

  it('replaces the history entry so Back does not bounce off the guard', async () => {
    const { api } = recordingApi(answers('Approved'))
    const router = renderRouter(guardedRoutes(CANDIDATE_ACCESS, api), TARGET_ENTRY, stubManager())

    await screen.findByTestId('login-screen')

    // `Navigate replace`: the refused location did not become a history entry.
    expect(router.state.historyAction).toBe('REPLACE')
  })
})

// ── Requirement 8 AC4: authenticated but refused ──────────────────────────────

describe('RouteGuard refusing an authenticated session (Requirement 8 AC4)', () => {
  it('renders the denied surface, no target screen and issues no target request', async () => {
    const { api, requests } = recordingApi(answers('Approved'))
    // Approved, acting as a Senior, asking for an Admin-only group.
    const router = renderRouter(
      guardedRoutes(ADMIN_ACCESS, api),
      TARGET_ENTRY,
      signedIn(['SENIOR'], 'SENIOR'),
    )

    expect(await screen.findByTestId('authorization-denied')).toBeInTheDocument()
    expect(screen.queryByTestId('target-screen')).toBeNull()

    // The whole of Requirement 8 AC4 in one assertion: the only request the
    // browsing context ever made is the guard's own status read. The target's
    // element never mounted, so its `GET /api/v1/jobs` never happened.
    expect(requests).toEqual([STATUS_READ])
    expect(requests).not.toContain(TARGET_READ)

    // A refusal is rendered in place, not redirected: the address stays put, so
    // the refusal never leaks into the URL or the history entry.
    expect(router.state.location.pathname).toBe(TARGET_PATH)
    expect(screen.queryByTestId('login-screen')).toBeNull()
    expect(screen.queryByTestId('status-notice-screen')).toBeNull()
  })

  it('refuses a dual-role account acting in the wrong context', async () => {
    const { api, requests } = recordingApi(answers('Approved'))
    // Holds the Candidate role, but is acting as a Senior (Req 8 AC3).
    renderRouter(
      guardedRoutes(CANDIDATE_ACCESS, api),
      TARGET_ENTRY,
      signedIn(['CANDIDATE', 'SENIOR'], 'SENIOR'),
    )

    expect(await screen.findByTestId('authorization-denied')).toBeInTheDocument()
    expect(requests).toEqual([STATUS_READ])
  })

  it('admits the same account once it is acting in the required context', async () => {
    const { api, requests } = recordingApi(answers('Approved'))
    renderRouter(
      guardedRoutes(CANDIDATE_ACCESS, api),
      TARGET_ENTRY,
      signedIn(['CANDIDATE', 'SENIOR'], 'CANDIDATE'),
    )

    expect(await screen.findByTestId('target-screen')).toBeInTheDocument()
    expect(screen.queryByTestId('authorization-denied')).toBeNull()
    // Admitted, so the target screen's own read does happen.
    await waitFor(() => {
      expect(requests).toEqual([STATUS_READ, TARGET_READ])
    })
  })
})

// ── Requirement 7 AC2: the Account_Status gate ────────────────────────────────

describe('RouteGuard with a non-Approved session (Requirement 7 AC2)', () => {
  const gated: readonly AccountStatus[] = [
    'PendingVerification',
    'PendingApproval',
    'ApprovedPendingMeeting',
    'Rejected',
    'Suspended',
    'Deactivated',
  ]

  for (const status of gated) {
    it(`redirects a ${status} session away from a feature route`, async () => {
      const { api, requests } = recordingApi(answers(status, 'do_the_next_thing'))
      const router = renderRouter(
        guardedRoutes(CANDIDATE_ACCESS, api),
        TARGET_ENTRY,
        signedIn(),
      )

      expect(await screen.findByTestId('status-notice-screen')).toBeInTheDocument()
      expect(screen.queryByTestId('target-screen')).toBeNull()
      expect(router.state.location.pathname).toBe(STATUS_NOTICE_PATH)
      // Role and context are not even consulted, and the target is never fetched.
      expect(requests).toEqual([STATUS_READ])
    })
  }

  it('admits an Onboarding_Screen while the account is not Approved', async () => {
    const { api } = recordingApi(answers('PendingVerification', 'verify_email'))
    const router = renderRouter(
      guardedRoutes(ONBOARDING_SCREEN_ACCESS, api),
      TARGET_ENTRY,
      signedIn(),
    )

    expect(await screen.findByTestId('target-screen')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(TARGET_PATH)
    expect(screen.queryByTestId('status-notice-screen')).toBeNull()
  })

  it('opens the feature route once the retained status is Approved (AC7)', async () => {
    const { api } = recordingApi(answers('Approved'))
    renderRouter(guardedRoutes(CANDIDATE_ACCESS, api), TARGET_ENTRY, signedIn())

    expect(await screen.findByTestId('target-screen')).toBeInTheDocument()
    expect(screen.queryByTestId('status-notice-screen')).toBeNull()
  })
})

// ── Requirement 7 AC1: the status read ────────────────────────────────────────

describe('RouteGuard status read (Requirement 7 AC1)', () => {
  it('renders the loading state while the read is outstanding and issues it once', async () => {
    const gate = deferred<StatusBody>()
    const { api, requests } = recordingApi(() => gate.promise)
    renderRouter(
      guardedRoutes(CANDIDATE_ACCESS, api),
      TARGET_ENTRY,
      // A sub of its own, so the deduplicated in-flight read cannot be shared
      // with another test's.
      signedIn(['CANDIDATE'], 'CANDIDATE', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'),
    )

    expect(await screen.findByTestId('loading-state')).toBeInTheDocument()
    expect(screen.queryByTestId('target-screen')).toBeNull()
    expect(screen.queryByTestId('authorization-denied')).toBeNull()
    // Exactly one read, even though the guard has rendered more than once.
    expect(requests).toEqual([STATUS_READ])

    await act(async () => {
      gate.resolve({ status: 'Approved', next_step: null })
      await gate.promise
    })

    expect(await screen.findByTestId('target-screen')).toBeInTheDocument()
    expect(requests.filter((entry) => entry === STATUS_READ)).toHaveLength(1)
  })

  it('renders the error state with a working retry when the read fails (Req 21 AC8)', async () => {
    const failure = statusReadFailure()
    const { api, requests } = recordingApi((attempt) =>
      attempt === 0 ? Promise.reject(failure) : Promise.resolve({ status: 'Approved' }),
    )
    renderRouter(guardedRoutes(CANDIDATE_ACCESS, api), TARGET_ENTRY, signedIn())

    const errorState = await screen.findByTestId('error-state')
    expect(errorState).toHaveTextContent(i18n.t('errors:upstream_unavailable'))
    expect(screen.queryByTestId('loading-state')).toBeNull()
    expect(screen.queryByTestId('target-screen')).toBeNull()
    // A failed status read is not an admission and not a refusal.
    expect(screen.queryByTestId('authorization-denied')).toBeNull()
    expect(requests).toEqual([STATUS_READ])

    await userEvent.click(screen.getByTestId('error-retry'))

    expect(await screen.findByTestId('target-screen')).toBeInTheDocument()
    expect(requests.filter((entry) => entry === STATUS_READ)).toHaveLength(2)
  })
})

// ── Requirement 7 AC6: account_not_approved replaces the retained status ──────

describe('RouteGuard and account_not_approved (Requirement 7 AC6)', () => {
  it('replaces the retained status and redirects to the Status_Notice', async () => {
    const { api } = recordingApi(answers('Approved'))
    const router = renderRouter(guardedRoutes(CANDIDATE_ACCESS, api), TARGET_ENTRY, signedIn())

    // Admitted on the retained `Approved` from the status read.
    expect(await screen.findByTestId('target-screen')).toBeInTheDocument()

    // A request somewhere in the application is refused with the envelope of AC6.
    await act(async () => {
      reportAccountNotApproved({
        error: ACCOUNT_NOT_APPROVED_ERROR,
        details: { status: 'Suspended', next_step: 'contact_support' },
      })
    })

    expect(await screen.findByTestId('status-notice-screen')).toBeInTheDocument()
    expect(screen.queryByTestId('target-screen')).toBeNull()
    expect(router.state.location.pathname).toBe(STATUS_NOTICE_PATH)
  })

  it('leaves an admitted session alone for an envelope naming no declared status', async () => {
    const { api } = recordingApi(answers('Approved'))
    renderRouter(guardedRoutes(CANDIDATE_ACCESS, api), TARGET_ENTRY, signedIn())

    expect(await screen.findByTestId('target-screen')).toBeInTheDocument()

    await act(async () => {
      reportAccountNotApproved({
        error: ACCOUNT_NOT_APPROVED_ERROR,
        details: { status: 'not-a-status' },
      })
    })

    // An unreadable refusal must not gate navigation on a value nothing can
    // decide against, so the previously retained status stands.
    expect(screen.getByTestId('target-screen')).toBeInTheDocument()
    expect(screen.queryByTestId('status-notice-screen')).toBeNull()
  })
})

// ── Requirement 8 AC11: the landing destination ───────────────────────────────

describe('LandingRedirect (Requirement 8 AC11)', () => {
  function landingRoutes(): RouteObject[] {
    return [
      { path: ROUTE_PATHS.root, element: <LandingRedirect /> },
      { path: '*', element: <div data-testid="landed" /> },
    ]
  }

  const contexts: readonly ActiveContext[] = ['CANDIDATE', 'SENIOR', 'ADMIN']

  for (const context of contexts) {
    it(`sends a ${context} session to its landing destination`, async () => {
      const router = renderRouter(landingRoutes(), ROUTE_PATHS.root, signedIn([context], context))

      expect(await screen.findByTestId('landed')).toBeInTheDocument()
      expect(router.state.location.pathname).toBe(LANDING_PATHS[context])
    })
  }

  it('falls back to the login screen when no session is held', async () => {
    const router = renderRouter(landingRoutes(), ROUTE_PATHS.root, stubManager())

    expect(await screen.findByTestId('landed')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(LOGIN_PATH)
  })
})

/** Nothing in this suite may render a token; the session never leaves memory. */
afterEach(() => {
  expect(localStorage.length).toBe(0)
  expect(sessionStorage.length).toBe(0)
  expect(document.cookie).toBe('')
})
