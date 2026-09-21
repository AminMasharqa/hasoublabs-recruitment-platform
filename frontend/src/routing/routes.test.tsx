/**
 * Component tests for the declarative route tree (task 11.6).
 *
 * `RouteGuard.test.tsx` exercises one guard in isolation. This suite mounts the
 * **real** tree from `appRoutes` in a memory router, so what is asserted is that
 * every declared path is actually wired to the group — and therefore to the
 * {@link RouteAccess} metadata — that Requirements 7 and 8 say it should be.
 *
 * Covered:
 * - **Req 8 AC2** every guarded path redirects a visitor with no Access_Token to
 *   the login screen, retaining the requested location; the three public paths are
 *   reachable without one.
 * - **Req 8 AC4** an approved session refused a group gets the uniform denied
 *   surface at the requested URL, and the recording Api_Client shows the only
 *   request the browsing context made is `GET /me/status`.
 * - **Req 7 AC2** a non-`Approved` session is redirected to the Status_Notice from
 *   a feature path, and the Status_Notice itself is admitted.
 * - **Req 7 AC4** the `PendingVerification` Status_Notice is admitted and the
 *   Verification_Code entry screen it must link to is a reachable declared route.
 *   The link itself lives on the Status_Notice screen, which is still a placeholder
 *   until task 15.3 — see the note on that test.
 * - **Req 8 AC11** the index route lands each Active_Context on its destination.
 * - Structure: no route declares a `loader` or an `action`, which is what keeps
 *   Requirement 8 AC4 structural, and every declared path is either public or
 *   guarded.
 */

import { MantineProvider } from '@mantine/core'
import { render, screen, within } from '@testing-library/react'
import type { i18n as I18nextInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ApiClient } from '../api/client'
import type { AccountStatus, Role } from '../api/enums'
import { createI18n } from '../i18n'
import { SessionProvider } from '../session/SessionContext'
import {
  createSessionManager,
  type SessionManager,
  type SessionManagerConfig,
  type TokenPair,
} from '../session/SessionManager'

import type { ActiveContext } from './access'
import { clearAccountNotApproved, ME_STATUS_PATH } from './accountStatus'
import { NAVIGATION_DESTINATIONS } from './destinations'
import {
  LANDING_PATHS,
  LOGIN_PATH,
  postLoginPath,
  registrationPath,
  requestedLocationFrom,
  ROUTE_PATHS,
  STATUS_NOTICE_PATH,
  VERIFICATION_PATH,
  type RoutePathId,
} from './paths'
import {
  appRoutes,
  GUARDED_ROUTE_GROUPS,
  PUBLIC_ROUTE_PATH_IDS,
  routeAccessFor,
} from './routes'

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
    schedule: () => () => undefined,
    ...overrides,
  })
}

function signedIn(roles: readonly Role[], context: ActiveContext): SessionManager {
  const manager = stubManager()
  manager.login(pair({ roles, act: context }))
  return manager
}

// ── The recording Api_Client ───────────────────────────────────────────────────

interface RecordingApi {
  readonly api: ApiClient
  /** Every request the browsing context issued, as `"method path"`, in order. */
  readonly requests: string[]
}

/** The status read the guard issues (Req 7 AC1). */
const STATUS_READ = `get ${ME_STATUS_PATH}`

/**
 * An Api_Client that answers `GET /me/status` with the given Account_Status and
 * records every request, so a request no screen should have made is visible.
 */
function recordingApi(status: AccountStatus, nextStep: string | null = null): RecordingApi {
  const requests: string[] = []

  const request = async (method: string, path: string): Promise<unknown> => {
    requests.push(`${method} ${path}`)
    if (path !== ME_STATUS_PATH) {
      throw new Error(`an unadmitted screen issued ${method} ${path}`)
    }
    return {
      data: { status, next_step: nextStep },
      response: new Response(null, { status: 200 }),
      supportReference: null,
    }
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

// ── Harness ───────────────────────────────────────────────────────────────────

let i18n: I18nextInstance

beforeEach(() => {
  clearAccountNotApproved()
  i18n = createI18n('en')
})

afterEach(() => {
  clearAccountNotApproved()
})

function renderApp(entry: string, manager: SessionManager, api: ApiClient | null = null) {
  const router = createMemoryRouter(appRoutes({ api }), { initialEntries: [entry] })
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

/** The heading of the rendered placeholder, i.e. the destination it stands for. */
function placeholderHeading(): string {
  return (
    within(screen.getByTestId('placeholder-screen')).getByRole('heading').textContent ?? ''
  )
}

/** Guarded paths carrying no `:param`, which a test can navigate to as declared. */
const CONCRETE_GUARDED_PATHS: readonly { readonly id: RoutePathId; readonly path: string }[] =
  GUARDED_ROUTE_GROUPS.flatMap((group) =>
    group.pathIds
      .filter((id) => !ROUTE_PATHS[id].includes(':'))
      .map((id) => ({ id, path: ROUTE_PATHS[id] })),
  )

// ── Requirement 8 AC2: the unauthenticated redirect ───────────────────────────

describe('appRoutes with no session (Requirement 8 AC2)', () => {
  it('sends a guarded navigation to the login screen retaining the location', async () => {
    const { api, requests } = recordingApi('Approved')
    const entry = `${ROUTE_PATHS.candidateCvs}?page=2`
    const router = renderApp(entry, stubManager(), api)

    expect(await screen.findByTestId('placeholder-screen')).toBeInTheDocument()
    expect(placeholderHeading()).toBe(i18n.t('shell:session.signIn'))
    expect(router.state.location.pathname).toBe(LOGIN_PATH)

    const retained = router.state.location.state
    expect(requestedLocationFrom(retained)).toBe(entry)
    expect(postLoginPath(retained, 'CANDIDATE')).toBe(entry)
    expect(requests).toEqual([])
  })

  for (const { id, path } of CONCRETE_GUARDED_PATHS) {
    it(`guards ${id} (${path})`, async () => {
      const router = renderApp(path, stubManager())

      await screen.findByTestId('placeholder-screen')
      expect(router.state.location.pathname).toBe(LOGIN_PATH)
      expect(requestedLocationFrom(router.state.location.state)).toBe(path)
    })
  }

  it('serves the login screen without a session and without a redirect loop', async () => {
    const router = renderApp(LOGIN_PATH, stubManager())

    expect(await screen.findByTestId('placeholder-screen')).toBeInTheDocument()
    expect(placeholderHeading()).toBe(i18n.t('shell:session.signIn'))
    // Nothing was retained, so signing in lands on the Active_Context destination.
    expect(requestedLocationFrom(router.state.location.state)).toBeNull()
    expect(postLoginPath(router.state.location.state, 'SENIOR')).toBe(LANDING_PATHS.SENIOR)
  })

  it('serves the registration and verification screens without a session', async () => {
    const registration = renderApp(registrationPath('tok-abc123'), stubManager())

    expect(await screen.findByTestId('placeholder-screen')).toBeInTheDocument()
    expect(placeholderHeading()).toBe(i18n.t('shell:route.registration'))
    expect(registration.state.location.pathname).toBe('/register/tok-abc123')
  })

  it('serves the Verification_Code entry screen without a session (Req 6 AC9)', async () => {
    const router = renderApp(VERIFICATION_PATH, stubManager())

    expect(await screen.findByTestId('placeholder-screen')).toBeInTheDocument()
    expect(placeholderHeading()).toBe(i18n.t('shell:route.verification'))
    expect(router.state.location.pathname).toBe(VERIFICATION_PATH)
  })

  it('answers an undeclared address with the not-found screen, not a denial', async () => {
    const router = renderApp('/no/such/address', stubManager())

    expect(await screen.findByTestId('not-found-screen')).toBeInTheDocument()
    // The catch-all sits outside every guard: it is not an authorization surface,
    // and it discloses nothing, because the address exists for nobody.
    expect(screen.queryByTestId('authorization-denied')).toBeNull()
    expect(router.state.location.pathname).toBe('/no/such/address')
  })
})

// ── Requirement 8 AC3, AC4: admission and refusal across the tree ─────────────

describe('appRoutes with an approved session (Requirement 8 AC3, AC4)', () => {
  it('admits a Candidate to a Candidate path', async () => {
    const { api, requests } = recordingApi('Approved')
    const router = renderApp(
      ROUTE_PATHS.candidateProfile,
      signedIn(['CANDIDATE'], 'CANDIDATE'),
      api,
    )

    expect(await screen.findByTestId('placeholder-screen')).toBeInTheDocument()
    expect(placeholderHeading()).toBe(i18n.t('shell:nav.profile'))
    expect(router.state.location.pathname).toBe(ROUTE_PATHS.candidateProfile)
    expect(requests).toEqual([STATUS_READ])
  })

  it('refuses that Candidate an Admin path without issuing the target request', async () => {
    const { api, requests } = recordingApi('Approved')
    const router = renderApp(ROUTE_PATHS.adminAccounts, signedIn(['CANDIDATE'], 'CANDIDATE'), api)

    expect(await screen.findByTestId('authorization-denied')).toBeInTheDocument()
    expect(screen.queryByTestId('placeholder-screen')).toBeNull()
    // Req 8 AC4: the only request made was the guard's own status read.
    expect(requests).toEqual([STATUS_READ])
    // Rendered in place, so the refusal stays out of the address bar.
    expect(router.state.location.pathname).toBe(ROUTE_PATHS.adminAccounts)
  })

  it('refuses a Candidate a Senior path', async () => {
    const { api, requests } = recordingApi('Approved')
    renderApp(ROUTE_PATHS.seniorJobs, signedIn(['CANDIDATE'], 'CANDIDATE'), api)

    expect(await screen.findByTestId('authorization-denied')).toBeInTheDocument()
    expect(requests).toEqual([STATUS_READ])
  })

  it('refuses a Senior a Candidate path', async () => {
    const { api, requests } = recordingApi('Approved')
    renderApp(ROUTE_PATHS.candidateCvs, signedIn(['SENIOR'], 'SENIOR'), api)

    expect(await screen.findByTestId('authorization-denied')).toBeInTheDocument()
    expect(requests).toEqual([STATUS_READ])
  })

  it('admits a Candidate to the shared job browsing path', async () => {
    const { api } = recordingApi('Approved')
    const router = renderApp(ROUTE_PATHS.jobs, signedIn(['CANDIDATE'], 'CANDIDATE'), api)

    expect(await screen.findByTestId('placeholder-screen')).toBeInTheDocument()
    expect(placeholderHeading()).toBe(i18n.t('shell:nav.jobs'))
    expect(router.state.location.pathname).toBe(ROUTE_PATHS.jobs)
  })

  it('admits a Senior to the shared job browsing path', async () => {
    const { api, requests } = recordingApi('Approved')
    const router = renderApp(ROUTE_PATHS.jobs, signedIn(['SENIOR'], 'SENIOR'), api)

    expect(await screen.findByTestId('placeholder-screen')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(ROUTE_PATHS.jobs)
    expect(requests).toEqual([STATUS_READ])
  })

  it('refuses an Admin the non-Admin browsing path, which is not in its menu', async () => {
    const { api, requests } = recordingApi('Approved')
    renderApp(ROUTE_PATHS.jobs, signedIn(['ADMIN'], 'ADMIN'), api)

    expect(await screen.findByTestId('authorization-denied')).toBeInTheDocument()
    expect(requests).toEqual([STATUS_READ])
  })

  it('admits any approved session to the session-wide paths', async () => {
    const { api } = recordingApi('Approved')
    renderApp(ROUTE_PATHS.diagnostics, signedIn(['ADMIN'], 'ADMIN'), api)

    expect(await screen.findByTestId('placeholder-screen')).toBeInTheDocument()
    expect(placeholderHeading()).toBe(i18n.t('shell:nav.diagnostics'))
  })
})

// ── Requirement 7 AC2, AC4: the Account_Status gate over the tree ─────────────

describe('appRoutes with a non-Approved session (Requirement 7 AC2)', () => {
  it('redirects a PendingApproval session from a feature path to the Status_Notice', async () => {
    const { api, requests } = recordingApi('PendingApproval', 'await_review')
    const router = renderApp(ROUTE_PATHS.jobs, signedIn(['CANDIDATE'], 'CANDIDATE'), api)

    expect(await screen.findByTestId('placeholder-screen')).toBeInTheDocument()
    expect(placeholderHeading()).toBe(i18n.t('shell:route.statusNotice'))
    expect(router.state.location.pathname).toBe(STATUS_NOTICE_PATH)
    expect(requests).toEqual([STATUS_READ])
  })

  /**
   * Requirement 7 AC4 — as far as it is assertable at this task.
   *
   * The control that navigates to the Verification_Code entry screen belongs to
   * the Status_Notice screen, which is still `PlaceholderScreen` until task 15.3
   * builds it. What is assertable now, and asserted here, is the routing half:
   * the Status_Notice is admitted for a `PendingVerification` session, and the
   * screen it has to link to is a declared, reachable route — the link target
   * exists before the link does. The link itself is covered by task 15.4.
   */
  it('admits the Status_Notice for a PendingVerification session', async () => {
    const { api } = recordingApi('PendingVerification', 'verify_email')
    const router = renderApp(STATUS_NOTICE_PATH, signedIn(['CANDIDATE'], 'CANDIDATE'), api)

    expect(await screen.findByTestId('placeholder-screen')).toBeInTheDocument()
    expect(placeholderHeading()).toBe(i18n.t('shell:route.statusNotice'))
    expect(router.state.location.pathname).toBe(STATUS_NOTICE_PATH)
    expect(screen.queryByTestId('authorization-denied')).toBeNull()
  })

  it('keeps the Verification_Code entry screen reachable for that session', async () => {
    const { api } = recordingApi('PendingVerification', 'verify_email')
    const router = renderApp(VERIFICATION_PATH, signedIn(['CANDIDATE'], 'CANDIDATE'), api)

    // The link target of Requirement 7 AC4 exists before the link does.
    expect(await screen.findByTestId('placeholder-screen')).toBeInTheDocument()
    expect(placeholderHeading()).toBe(i18n.t('shell:route.verification'))
    expect(router.state.location.pathname).toBe(VERIFICATION_PATH)
  })

  it('redirects a Suspended session from the index route to the Status_Notice', async () => {
    const { api } = recordingApi('Suspended', 'contact_support')
    const router = renderApp(ROUTE_PATHS.root, signedIn(['SENIOR'], 'SENIOR'), api)

    expect(await screen.findByTestId('placeholder-screen')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(STATUS_NOTICE_PATH)
  })
})

// ── Requirement 8 AC11: the index route ───────────────────────────────────────

describe('appRoutes index route (Requirement 8 AC11)', () => {
  const contexts: readonly ActiveContext[] = ['CANDIDATE', 'SENIOR', 'ADMIN']

  for (const context of contexts) {
    it(`lands a ${context} session on ${LANDING_PATHS[context]}`, async () => {
      const { api } = recordingApi('Approved')
      const router = renderApp(ROUTE_PATHS.root, signedIn([context], context), api)

      expect(await screen.findByTestId('placeholder-screen')).toBeInTheDocument()
      expect(router.state.location.pathname).toBe(LANDING_PATHS[context])
      // The landing destination is itself admitted, so it never bounces.
      expect(screen.queryByTestId('authorization-denied')).toBeNull()
    })
  }
})

// ── Structure: what keeps Requirement 8 AC4 structural ────────────────────────

describe('appRoutes structure', () => {
  function everyRoute(routes: readonly RouteObject[]): RouteObject[] {
    return routes.flatMap((route) => [route, ...everyRoute(route.children ?? [])])
  }

  it('declares no loader and no action anywhere in the tree', () => {
    const all = everyRoute(appRoutes())

    expect(all.length).toBeGreaterThan(0)
    for (const route of all) {
      // A loader runs before the matched element renders and is not subject to
      // the guard, so one would issue a refused route's request (Req 8 AC4).
      expect(route.loader).toBeUndefined()
      expect(route.action).toBeUndefined()
    }
  })

  it('declares every path as either public or guarded', () => {
    const ids = Object.keys(ROUTE_PATHS) as RoutePathId[]

    for (const id of ids) {
      if (id === 'root') {
        // The index route carries no path of its own; it redirects (AC11).
        continue
      }
      const guarded = routeAccessFor(id)
      const isPublic = PUBLIC_ROUTE_PATH_IDS.includes(id)
      expect(isPublic || guarded !== null).toBe(true)
      // Public and guarded are exclusive: a path has exactly one admission rule.
      expect(isPublic && guarded !== null).toBe(false)
    }
  })

  it('points every Navigation_Menu destination at a guarded path with the same access', () => {
    const idOf = new Map<string, RoutePathId>(
      (Object.keys(ROUTE_PATHS) as RoutePathId[]).map((id) => [ROUTE_PATHS[id], id]),
    )

    for (const destination of NAVIGATION_DESTINATIONS) {
      const pathId = idOf.get(destination.path)
      expect(pathId).toBeDefined()
      // Same preset object on the route and on the menu entry, so the menu and
      // the guard cannot disagree about a destination (Req 8 AC5).
      expect(routeAccessFor(pathId as RoutePathId)).toBe(destination.access)
    }
  })
})
