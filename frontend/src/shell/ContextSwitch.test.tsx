/**
 * The context-switch control, rendered inside the real shell (Requirement 8
 * AC10, AC11, AC12).
 *
 * Mounted through `AppShell` with a genuine runtime — real Session_Manager, real
 * Api_Client over a stub `fetch`, real TanStack Query cache, real router — because
 * AC11 is a statement about all four of them at once and a mocked collaborator
 * would assert only that this component called it. What is observed is the
 * outcome:
 *
 * | AC11 clause | assertion |
 * | --- | --- |
 * | replace both stored tokens | the Session_Manager holds the new Access_Token, and the next request carries it |
 * | discard every cached server-state entry | a seeded cache entry is gone |
 * | rebuild the Navigation_Menu from the new `act` | the Senior destinations are present and the Candidate ones are not |
 * | land on the new context | the router is at the Senior landing destination |
 *
 * AC10 and AC12 are asserted as presence and absence across the role sets that
 * matter, including `ADMIN+CANDIDATE+SENIOR`, which satisfies AC10's dual-role
 * condition and AC12's prohibition simultaneously.
 *
 * The failure path is asserted too: a refused switch must leave the session, the
 * cache and the location exactly as they were, because a half-applied switch is
 * how a screen ends up reading another context's data.
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Role } from '../api/enums'
import { LANDING_PATHS } from '../routing/paths'

import { createAppRuntime, resetSharedAppRuntime, type AppRuntime } from './appRuntime'
import { AppShell, AppShellLayout } from './AppShell'

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
function accessToken(claims: { readonly roles: readonly Role[]; readonly act: Role }): string {
  const payload = {
    sub: 'account-1',
    session_id: 'session-1',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  }
  return `${base64Url('{"alg":"HS256","typ":"JWT"}')}.${base64Url(JSON.stringify(payload))}.sig`
}

const DUAL_ROLES: readonly Role[] = ['CANDIDATE', 'SENIOR']

/** The Access_Token the switch response carries: same account, new `act`. */
const SENIOR_ACCESS_TOKEN = accessToken({ roles: DUAL_ROLES, act: 'SENIOR' })

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'req-abc' },
  })
}

/** What the stub Backend_Api answered, in order. */
interface Exchange {
  readonly pathname: string
  readonly body: string
  readonly authorization: string | null
}

interface Backend {
  /** Every request the Api_Client issued. */
  readonly exchanges: Exchange[]
  /** Replaces the `POST /auth/context` answer. */
  refuseSwitch(): void
  fetch(request: Request): Promise<Response>
}

function backend(): Backend {
  const exchanges: Exchange[] = []
  let switchResponse = (): Response =>
    jsonResponse({
      access_token: SENIOR_ACCESS_TOKEN,
      refresh_token: 'refresh-2',
      expires_in: 3600,
      token_type: 'bearer',
    })

  return {
    exchanges,
    refuseSwitch() {
      switchResponse = () =>
        jsonResponse({ error: 'context_not_available', message: 'nope', details: null }, 409)
    },
    async fetch(request: Request): Promise<Response> {
      const { pathname } = new URL(request.url)
      exchanges.push({
        pathname,
        body: await request.clone().text(),
        authorization: request.headers.get('Authorization'),
      })
      if (pathname.endsWith('/auth/context')) {
        return switchResponse()
      }
      if (pathname.endsWith('/me/status')) {
        return jsonResponse({ status: 'Approved', next_step: null })
      }
      if (pathname.endsWith('/auth/logout')) {
        return new Response(null, { status: 204 })
      }
      return jsonResponse({ error: 'not_found' }, 404)
    },
  }
}

let active: AppRuntime | null = null
let api: Backend

/** A runtime with no session held. */
function signedOut(): AppRuntime {
  const runtime = createAppRuntime({
    shellElement: <AppShellLayout />,
    apiRuntime: {
      baseUrl: 'https://backend.test/api/v1',
      locale: () => 'en',
      fetch: (request) => api.fetch(request),
    },
  })
  active = runtime
  return runtime
}

/** A runtime holding a session with the given `roles` claim and Active_Context. */
function signedInAs(roles: readonly Role[], act: Role): AppRuntime {
  const runtime = signedOut()
  runtime.session.login({ accessToken: accessToken({ roles, act }), refreshToken: 'refresh-1' })
  return runtime
}

beforeEach(() => {
  window.history.replaceState(null, '', '/candidate/profile')
  resetSharedAppRuntime()
  api = backend()
})

afterEach(() => {
  active?.router.dispose()
  active = null
  resetSharedAppRuntime()
})

// ── Presentation (AC10, AC12) ─────────────────────────────────────────────────

describe('presenting the context-switch control', () => {
  it('presents it for a dual-role account, naming the Active_Context and the target (AC10)', async () => {
    const runtime = signedInAs(DUAL_ROLES, 'CANDIDATE')

    render(<AppShell runtime={runtime} />)

    const control = await screen.findByTestId('context-switch')
    expect(within(control).getByText('Active role')).toBeInTheDocument()
    expect(within(control).getByTestId('context-switch-active')).toHaveTextContent('Candidate')
    expect(screen.getByTestId('context-switch-SENIOR')).toHaveAccessibleName('Switch to Senior')
    // The Active_Context is never offered as a target.
    expect(screen.queryByTestId('context-switch-CANDIDATE')).not.toBeInTheDocument()
  })

  it('presents nothing for an account holding the Admin role (AC12)', async () => {
    const runtime = signedInAs(['ADMIN', 'CANDIDATE', 'SENIOR'], 'ADMIN')

    render(<AppShell runtime={runtime} />)

    // The shell is up — so the absence below is the control's own decision.
    await screen.findByTestId('sign-out')
    expect(screen.queryByTestId('context-switch')).not.toBeInTheDocument()
  })

  it('presents nothing for a single-role account', async () => {
    const runtime = signedInAs(['CANDIDATE'], 'CANDIDATE')

    render(<AppShell runtime={runtime} />)

    await screen.findByTestId('sign-out')
    expect(screen.queryByTestId('context-switch')).not.toBeInTheDocument()
  })

  it('presents nothing without a session', async () => {
    const runtime = signedOut()

    render(<AppShell runtime={runtime} />)

    await waitFor(() => {
      expect(runtime.router.state.location.pathname).toBe('/login')
    })
    expect(screen.queryByTestId('context-switch')).not.toBeInTheDocument()
  })
})

// ── Switching (AC10, AC11) ────────────────────────────────────────────────────

describe('switching the Active_Context', () => {
  it('replaces both tokens, discards the cache, rebuilds the menu and lands on the new context (AC11)', async () => {
    const runtime = signedInAs(DUAL_ROLES, 'CANDIDATE')
    runtime.queryClient.setQueryData(['candidate', 'profile'], { full_name: 'from the old context' })

    render(<AppShell runtime={runtime} />)
    await userEvent.click(await screen.findByTestId('context-switch-SENIOR'))

    // Landed on the new context's landing destination.
    await waitFor(() => {
      expect(runtime.router.state.location.pathname).toBe(LANDING_PATHS.SENIOR)
    })

    // AC10: the target context was named in the request body.
    const call = api.exchanges.find((exchange) => exchange.pathname.endsWith('/auth/context'))
    expect(call).toBeDefined()
    expect(JSON.parse(call?.body ?? '{}')).toEqual({ context: 'SENIOR' })

    // Both tokens replaced: the new Access_Token is held and is what the next
    // request carries.
    expect(runtime.session.getAccessToken()).toBe(SENIOR_ACCESS_TOKEN)
    expect(runtime.session.getPrincipal()?.act).toBe('SENIOR')
    // The retained Account_Status is re-read for the new context, and that read
    // is what shows the new pair is the one now in use.
    await waitFor(() => {
      const statusReads = api.exchanges.filter((exchange) => exchange.pathname.endsWith('/me/status'))
      expect(statusReads.at(-1)?.authorization).toBe(`Bearer ${SENIOR_ACCESS_TOKEN}`)
    })

    // Every cached server-state entry discarded.
    expect(runtime.queryClient.getQueryData(['candidate', 'profile'])).toBeUndefined()

    // Navigation_Menu rebuilt from the new `act`.
    const menu = await screen.findByTestId('navigation-menu')
    expect(menu.querySelector('[data-destination="senior-jobs"]')).not.toBeNull()
    expect(menu.querySelector('[data-destination="candidate-cvs"]')).toBeNull()

    // And the control now offers the way back.
    expect(screen.getByTestId('context-switch-CANDIDATE')).toBeInTheDocument()
    expect(screen.queryByTestId('context-switch-SENIOR')).not.toBeInTheDocument()
  })

  it('leaves the session, the cache and the location untouched when the switch is refused', async () => {
    api.refuseSwitch()
    const runtime = signedInAs(DUAL_ROLES, 'CANDIDATE')
    const held = runtime.session.getAccessToken()
    runtime.queryClient.setQueryData(['candidate', 'profile'], { full_name: 'still valid' })

    render(<AppShell runtime={runtime} />)
    await userEvent.click(await screen.findByTestId('context-switch-SENIOR'))

    // The localized reason is announced without moving focus (Req 20 AC7, Req 21 AC1).
    const failure = await screen.findByTestId('context-switch-error')
    expect(failure).toHaveAttribute('role', 'alert')
    expect(failure.textContent?.trim()).not.toBe('')

    expect(runtime.session.getAccessToken()).toBe(held)
    expect(runtime.session.getPrincipal()?.act).toBe('CANDIDATE')
    expect(runtime.queryClient.getQueryData(['candidate', 'profile'])).toEqual({
      full_name: 'still valid',
    })
    expect(runtime.router.state.location.pathname).toBe('/candidate/profile')
    // Still offering the switch, so the user can retry.
    expect(screen.getByTestId('context-switch-SENIOR')).toBeEnabled()
  })
})
