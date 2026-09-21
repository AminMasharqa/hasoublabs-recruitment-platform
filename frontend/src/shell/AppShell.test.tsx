/**
 * The application shell, rendered.
 *
 * Four things can only be observed by mounting the whole stack, and they are what
 * this file covers:
 *
 * - the chrome exists and is structurally sound: a skip link as the first
 *   focusable element, a `main` landmark, the application name (Requirement 20
 *   AC1, AC4, Requirement 19 AC2),
 * - the chrome is scoped to the session: no Navigation_Menu and no sign-out
 *   control without one (Requirement 8 AC5, Requirement 7 AC5),
 * - the logout control tears the session down through the shell's own wiring —
 *   cache cleared, login screen reached (Requirement 4 AC9),
 * - the recovery boundary sits *inside* the chrome, so a crashing screen leaves
 *   the header and the Navigation_Menu mounted and operable (Requirement 21 AC11),
 * - the Api_Client and the cache reset reach a routed screen through context, which
 *   is what the ContextSwitch control of Requirement 8 AC11 will use.
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAppRuntime, resetSharedAppRuntime, type AppRuntime } from './appRuntime'
import { AppShell, AppShellLayout, MAIN_CONTENT_ID } from './AppShell'
import { useApiClient, useClearServerState } from './appServices'
import { SCREEN_ELEMENTS } from './screenElements'

import type { ScreenElements } from '../routing/routes'

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

/** The Backend_Api stand-in: an approved account, a health probe, a logout that succeeds. */
function respond(request: Request): Response {
  const { pathname } = new URL(request.url)
  if (pathname.endsWith('/me/status')) {
    return jsonResponse({ status: 'Approved', next_step: null })
  }
  if (pathname.endsWith('/health')) {
    return jsonResponse({ status: 'ok' })
  }
  if (pathname.endsWith('/auth/logout')) {
    return new Response(null, { status: 204 })
  }
  return jsonResponse({ error: 'not_found' }, 404)
}

let active: AppRuntime | null = null

function buildRuntime(elements?: ScreenElements): AppRuntime {
  const runtime = createAppRuntime({
    shellElement: <AppShellLayout />,
    ...(elements === undefined ? {} : { elements }),
    apiRuntime: {
      baseUrl: 'https://backend.test/api/v1',
      locale: () => 'en',
      fetch: async (request) => respond(request),
    },
  })
  active = runtime
  return runtime
}

/** Signs in as an approved Candidate. */
function signIn(runtime: AppRuntime): void {
  runtime.session.login({ accessToken: accessToken(), refreshToken: 'refresh-1' })
}

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  resetSharedAppRuntime()
})

afterEach(() => {
  active?.router.dispose()
  active = null
  resetSharedAppRuntime()
})

// ── The chrome ────────────────────────────────────────────────────────────────

describe('AppShell chrome', () => {
  it('renders a skip link, the application name and a main landmark', async () => {
    const runtime = buildRuntime()

    render(<AppShell runtime={runtime} />)

    const skip = await screen.findByTestId('skip-to-content')
    expect(skip).toHaveTextContent('Skip to main content')
    expect(skip).toHaveAttribute('href', `#${MAIN_CONTENT_ID}`)
    expect(screen.getByText('HasoubLabs Recruitment')).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveAttribute('id', MAIN_CONTENT_ID)
  })

  it('presents no navigation and no sign-out control without a session', async () => {
    const runtime = buildRuntime()

    render(<AppShell runtime={runtime} />)

    // No token: the Route_Guard sends every guarded group to the login screen.
    await waitFor(() => {
      expect(runtime.router.state.location.pathname).toBe('/login')
    })
    expect(screen.queryByTestId('navigation-menu')).not.toBeInTheDocument()
    expect(screen.queryByTestId('navigation-toggle')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sign-out')).not.toBeInTheDocument()
  })

  it('presents the Navigation_Menu and the sign-out control for an approved session', async () => {
    const runtime = buildRuntime()
    signIn(runtime)

    render(<AppShell runtime={runtime} />)

    const menu = await screen.findByTestId('navigation-menu')
    // Req 8 AC6: the Candidate context, and nothing from another one.
    expect(within(menu).getByText('My profile')).toBeInTheDocument()
    expect(within(menu).getByText('Jobs')).toBeInTheDocument()
    expect(within(menu).queryByText('Accounts')).not.toBeInTheDocument()
    expect(screen.getByTestId('sign-out')).toBeInTheDocument()
    expect(screen.getByTestId('navigation-toggle')).toBeInTheDocument()
  })
})

// ── Logout (Req 4 AC9) ────────────────────────────────────────────────────────

describe('the sign-out control', () => {
  it('discards the session and the cache and lands on the login screen', async () => {
    const runtime = buildRuntime()
    signIn(runtime)
    runtime.queryClient.setQueryData(['jobs'], ['a'])

    render(<AppShell runtime={runtime} />)
    await userEvent.click(await screen.findByTestId('sign-out'))

    await waitFor(() => {
      expect(runtime.router.state.location.pathname).toBe('/login')
    })
    expect(runtime.session.getAccessToken()).toBeNull()
    expect(runtime.queryClient.getQueryCache().getAll()).toHaveLength(0)
    expect(screen.queryByTestId('sign-out')).not.toBeInTheDocument()
  })
})

// ── The recovery boundary's placement (Req 21 AC11) ───────────────────────────

function CrashingScreen(): never {
  throw new Error('screen crashed')
}

describe('the recovery boundary', () => {
  it('replaces the routed region only, retaining the chrome', async () => {
    // React reports a caught rendering error to the console itself; the boundary
    // adds no log of its own, so silencing this keeps the run readable.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    window.history.replaceState(null, '', '/account')
    const runtime = buildRuntime({ account: <CrashingScreen /> })
    signIn(runtime)

    render(<AppShell runtime={runtime} />)

    expect(await screen.findByTestId('recovery-boundary')).toBeInTheDocument()
    // The chrome is still mounted and still operable.
    expect(screen.getByText('HasoubLabs Recruitment')).toBeInTheDocument()
    expect(screen.getByTestId('navigation-menu')).toBeInTheDocument()
    expect(screen.getByTestId('sign-out')).toBeInTheDocument()
    expect(screen.getByTestId('recovery-reload')).toBeInTheDocument()

    consoleError.mockRestore()
  })
})

// ── The registered screens ────────────────────────────────────────────────────

describe('SCREEN_ELEMENTS', () => {
  it('renders the diagnostics screen on /diagnostics rather than the placeholder', async () => {
    window.history.replaceState(null, '', '/diagnostics')
    // The same table `AppShell` passes to the shared runtime, so this asserts the
    // registration itself and not a second, test-local one (Req 23 AC5, AC6).
    const runtime = buildRuntime(SCREEN_ELEMENTS)
    signIn(runtime)

    render(<AppShell runtime={runtime} />)

    expect(await screen.findByTestId('diagnostics-screen')).toBeInTheDocument()
    expect(screen.queryByTestId('placeholder-screen')).not.toBeInTheDocument()
    // The probe went through the Api_Client and was reported (Req 23 AC6).
    expect(await screen.findByTestId('diagnostics-health-status')).toHaveTextContent('ok')
  })
})

// ── The published services (Req 8 AC11) ───────────────────────────────────────

function ServicesProbe() {
  const api = useApiClient()
  const clearServerState = useClearServerState()

  return (
    <button
      type="button"
      data-testid="probe"
      data-has-api={typeof api.request === 'function'}
      onClick={() => {
        clearServerState('context-switch')
      }}
    >
      switch
    </button>
  )
}

describe('AppServicesContext', () => {
  it('publishes the Api_Client and the context-switch cache reset to a routed screen', async () => {
    window.history.replaceState(null, '', '/diagnostics')
    const runtime = buildRuntime({ diagnostics: <ServicesProbe /> })
    signIn(runtime)
    runtime.queryClient.setQueryData(['jobs'], ['a'])

    render(<AppShell runtime={runtime} />)
    const probe = await screen.findByTestId('probe')
    expect(probe).toHaveAttribute('data-has-api', 'true')

    await userEvent.click(probe)

    expect(runtime.queryClient.getQueryCache().getAll()).toHaveLength(0)
  })
})
