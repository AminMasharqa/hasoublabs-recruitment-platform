/**
 * The multi-factor code step as it is actually rendered (Requirement 5 AC1, AC3).
 *
 * `mfaChallenge.test.ts` already pins the request body, the six-digit rule and the
 * classification as pure functions. What is left — and what only a rendering can
 * show — is the wiring:
 *
 * - AC1 is a statement about two components at once. The step collects the code and
 *   resubmits `POST /auth/login`, but the *session* is the login screen's to
 *   establish; a step that posted the right body and then dropped the token pair
 *   would satisfy every unit test and no user. So the case below drives the whole
 *   stack — real Session_Manager, real Api_Client over a stub `fetch`, real router —
 *   and asserts the session holds the returned token and the router has moved, the
 *   same way `LoginScreen.test.tsx` asserts Requirement 4 AC2.
 * - AC3 is a statement about what survives a refusal: the step, an empty input, and
 *   the localized entry of the `error` member the Backend_Api sent. All three are
 *   observable only in the DOM.
 *
 * The credential submission is answered `mfa_required` so the step is reached the
 * way the application reaches it, rather than by mounting it with hand-made props.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Role } from '../../api/enums'
import { clearAccountNotApproved } from '../../routing/accountStatus'
import { LANDING_PATHS, LOGIN_PATH } from '../../routing/paths'
import { clearSessionEnd } from '../../session/sessionEndNotice'
import { createAppRuntime, resetSharedAppRuntime, type AppRuntime } from '../../shell/appRuntime'
import { AppShell, AppShellLayout } from '../../shell/AppShell'
import { LoginScreen } from '../auth/LoginScreen'

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

/** The account the second factor belongs to: an Admin (Requirement 5). */
const ADMIN_ACCESS_TOKEN = accessToken({ roles: ['ADMIN'], act: 'ADMIN' })

const CREDENTIALS = {
  email: 'admin@example.com',
  password: 'correct horse battery',
  role: 'ADMIN',
} as const

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'req-abc' },
  })
}

/** What the stub Backend_Api was asked, in order. */
interface Exchange {
  readonly pathname: string
  readonly body: string
}

interface Backend {
  readonly exchanges: Exchange[]
  /** Replaces the answer to the login carrying an `mfa_code` member. */
  answerCodeWith(response: () => Response): void
  fetch(request: Request): Promise<Response>
}

/**
 * A Backend_Api that requires a second factor.
 *
 * The credential submission — a body with no `mfa_code` — is answered
 * `mfa_required`, which is what puts the screen into the step (AC1). The
 * resubmission is answered by whatever the case scripted.
 */
function backend(): Backend {
  const exchanges: Exchange[] = []
  let codeResponse = (): Response =>
    jsonResponse({
      access_token: ADMIN_ACCESS_TOKEN,
      refresh_token: 'refresh-1',
      expires_in: 3600,
      token_type: 'bearer',
    })

  return {
    exchanges,
    answerCodeWith(response) {
      codeResponse = response
    },
    async fetch(request: Request): Promise<Response> {
      const { pathname } = new URL(request.url)
      const body = await request.clone().text()
      exchanges.push({ pathname, body })
      if (pathname.endsWith('/auth/login')) {
        return 'mfa_code' in (JSON.parse(body === '' ? '{}' : body) as Record<string, unknown>)
          ? codeResponse()
          : jsonResponse({ error: 'mfa_required', message: null }, 401)
      }
      if (pathname.endsWith('/me/status')) {
        return jsonResponse({ status: 'Approved', next_step: null })
      }
      return jsonResponse({ error: 'not_found' }, 404)
    },
  }
}

let active: AppRuntime | null = null
let api: Backend

function signedOutRuntime(): AppRuntime {
  const runtime = createAppRuntime({
    shellElement: <AppShellLayout />,
    elements: { login: <LoginScreen /> },
    apiRuntime: {
      baseUrl: 'https://backend.test/api/v1',
      locale: () => 'en',
      fetch: (request) => api.fetch(request),
    },
  })
  active = runtime
  return runtime
}

function loginExchanges(): Exchange[] {
  return api.exchanges.filter((exchange) => exchange.pathname.endsWith('/auth/login'))
}

/** Signs in with credentials the Backend_Api answers `mfa_required` to. */
async function reachCodeStep(): Promise<void> {
  await userEvent.type(await screen.findByLabelText('Email address'), CREDENTIALS.email)
  await userEvent.type(screen.getByLabelText('Password'), CREDENTIALS.password)
  await userEvent.selectOptions(screen.getByLabelText('Sign in as'), CREDENTIALS.role)
  await userEvent.click(screen.getByTestId('login-submit'))
  await screen.findByTestId('mfa-code-step')
}

/** Enters a code into the step and submits it. */
async function submitCode(code: string): Promise<void> {
  await userEvent.type(screen.getByTestId('mfa-code-input'), code)
  await userEvent.click(screen.getByTestId('mfa-code-submit'))
}

beforeEach(() => {
  window.history.replaceState(null, '', LOGIN_PATH)
  resetSharedAppRuntime()
  clearAccountNotApproved()
  clearSessionEnd()
  api = backend()
})

afterEach(() => {
  active?.router.dispose()
  active = null
  resetSharedAppRuntime()
  clearAccountNotApproved()
  clearSessionEnd()
})

// ── The resubmission and the session it produces (AC1) ────────────────────────

describe('the code step of a login that requires a second factor (AC1)', () => {
  it('resubmits the credentials with the collected code', async () => {
    render(<AppShell runtime={signedOutRuntime()} />)

    await reachCodeStep()
    await submitCode('123456')

    await waitFor(() => {
      expect(loginExchanges()).toHaveLength(2)
    })
    expect(loginExchanges()[1]?.pathname).toBe('/api/v1/auth/login')
    // AC1: the email address, the password, the role — and the code.
    expect(JSON.parse(loginExchanges()[1]?.body ?? '{}')).toEqual({
      email: CREDENTIALS.email,
      password: CREDENTIALS.password,
      role: CREDENTIALS.role,
      mfa_code: '123456',
    })
  })

  it('hands a 200 to the login screen, which establishes the session and lands', async () => {
    const runtime = signedOutRuntime()
    render(<AppShell runtime={runtime} />)

    await reachCodeStep()
    await submitCode('123456')

    // Req 4 AC2 reached through the step: the tokens are held and the router moved.
    await waitFor(() => {
      expect(runtime.router.state.location.pathname).toBe(LANDING_PATHS.ADMIN)
    })
    expect(runtime.session.getAccessToken()).toBe(ADMIN_ACCESS_TOKEN)
    expect(runtime.session.getSnapshot().authenticated).toBe(true)
    // Awaited rather than asserted synchronously: the router reports the landing
    // address as soon as the navigation is decided, and the step leaves the DOM on
    // the render that follows it. Reading the DOM in between is a race, not a
    // requirement — what AC1 asks is that the step is gone once the landing route is
    // on screen.
    await waitFor(() => {
      expect(screen.queryByTestId('mfa-code-step')).not.toBeInTheDocument()
    })
  })
})

// ── A refused code (AC3) ──────────────────────────────────────────────────────

describe('a code the Backend_Api does not accept (AC3)', () => {
  it('retains the step, clears the input and renders the localized message', async () => {
    api.answerCodeWith(() =>
      jsonResponse({ error: 'invalid_mfa_code', message: 'server wording' }, 401),
    )
    const runtime = signedOutRuntime()
    render(<AppShell runtime={runtime} />)

    await reachCodeStep()
    await submitCode('123456')

    const refused = await screen.findByTestId('mfa-code-refused')
    // The catalogue entry for the `error` member the Backend_Api sent, not its own
    // wording (Requirement 19 AC5).
    expect(refused).toHaveTextContent('That authenticator code is incorrect.')
    expect(refused).toHaveAttribute('role', 'alert')
    expect(document.body.textContent ?? '').not.toContain('server wording')

    // The step is still the screen, with an empty input ready for the next code.
    expect(screen.getByTestId('mfa-code-step')).toBeInTheDocument()
    expect(screen.getByTestId('mfa-code-input')).toHaveValue('')
    expect(screen.queryByTestId('login-form')).not.toBeInTheDocument()
    // No session, and the uniform credential rejection is not what was rendered.
    expect(runtime.session.getAccessToken()).toBeNull()
    expect(screen.queryByTestId('login-rejected')).not.toBeInTheDocument()
    expect(runtime.router.state.location.pathname).toBe(LOGIN_PATH)
  })

  it('accepts a further code on the retained step and signs in', async () => {
    let attempt = 0
    api.answerCodeWith(() => {
      attempt += 1
      return attempt === 1
        ? jsonResponse({ error: 'invalid_mfa_code', message: null }, 401)
        : jsonResponse({
            access_token: ADMIN_ACCESS_TOKEN,
            refresh_token: 'refresh-1',
            expires_in: 3600,
            token_type: 'bearer',
          })
    })
    const runtime = signedOutRuntime()
    render(<AppShell runtime={runtime} />)

    await reachCodeStep()
    await submitCode('111111')
    await screen.findByTestId('mfa-code-refused')

    await submitCode('222222')

    await waitFor(() => {
      expect(runtime.session.getAccessToken()).toBe(ADMIN_ACCESS_TOKEN)
    })
    // The second code went out on its own resubmission, not appended to the first.
    expect(JSON.parse(loginExchanges()[2]?.body ?? '{}')).toMatchObject({ mfa_code: '222222' })
  })
})
