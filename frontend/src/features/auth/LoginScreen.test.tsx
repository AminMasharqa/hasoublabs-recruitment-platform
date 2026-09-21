/**
 * The login screen, mounted inside the real shell (Requirement 4 AC1, AC2, AC7,
 * AC12).
 *
 * Driven through a genuine runtime — real Session_Manager, real Api_Client over a
 * stub `fetch`, real TanStack Query cache, real router — because AC2 is a statement
 * about all of them at once: "store the returned tokens, decode the claims, and
 * redirect to the landing destination for the decoded Active_Context" is only
 * observable as the session holding the new token *and* the router having moved.
 * A mocked Session_Manager would assert that this component called something.
 *
 * AC12 is asserted as indistinguishability rather than as wording: the surface
 * rendered for a 401 and the surface rendered for a 403 are compared as markup,
 * so any future variation — a status code, an `error` key, a Support_Reference —
 * fails here.
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

import { LoginScreen } from './LoginScreen'

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

const CANDIDATE_ACCESS_TOKEN = accessToken({ roles: ['CANDIDATE'], act: 'CANDIDATE' })

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
  /** Replaces the `POST /auth/login` answer. */
  answerLoginWith(response: () => Response): void
  fetch(request: Request): Promise<Response>
}

function backend(): Backend {
  const exchanges: Exchange[] = []
  let loginResponse = (): Response =>
    jsonResponse({
      access_token: CANDIDATE_ACCESS_TOKEN,
      refresh_token: 'refresh-1',
      expires_in: 3600,
      token_type: 'bearer',
    })

  return {
    exchanges,
    answerLoginWith(response) {
      loginResponse = response
    },
    async fetch(request: Request): Promise<Response> {
      const { pathname } = new URL(request.url)
      exchanges.push({ pathname, body: await request.clone().text() })
      if (pathname.endsWith('/auth/login')) {
        return loginResponse()
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

/** Fills the three inputs Requirement 4 AC1 collects and submits the form. */
async function signIn(
  credentials: { email: string; password: string; role: string } = {
    email: 'person@example.com',
    password: 'correct horse battery',
    role: 'CANDIDATE',
  },
): Promise<void> {
  await userEvent.type(await screen.findByLabelText('Email address'), credentials.email)
  await userEvent.type(screen.getByLabelText('Password'), credentials.password)
  await userEvent.selectOptions(screen.getByLabelText('Sign in as'), credentials.role)
  await userEvent.click(screen.getByTestId('login-submit'))
}

beforeEach(() => {
  window.history.replaceState(null, '', LOGIN_PATH)
  resetSharedAppRuntime()
  // Requirement 7 AC6 is reported through a browsing-context-scoped store, and one
  // of the refusals below is an `account_not_approved` envelope. Left behind, it
  // would be applied to the *next* test's session and gate it to the Status_Notice.
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

// ── The form (AC1) ────────────────────────────────────────────────────────────

describe('the login form (AC1)', () => {
  it('collects an email address, a password and a role of ADMIN, CANDIDATE or SENIOR', async () => {
    render(<AppShell runtime={signedOutRuntime()} />)

    await screen.findByTestId('login-screen')
    expect(screen.getByLabelText('Email address')).toHaveAttribute('type', 'email')
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')

    const role = screen.getByLabelText('Sign in as')
    const offered = [...role.querySelectorAll('option')]
      .map((option) => option.value)
      .filter((value) => value !== '')
    expect(offered).toEqual(['ADMIN', 'CANDIDATE', 'SENIOR'])
  })

  it('submits the collected values to POST /api/v1/auth/login', async () => {
    render(<AppShell runtime={signedOutRuntime()} />)

    await signIn({ email: 'person@example.com', password: 'a password', role: 'SENIOR' })

    await waitFor(() => {
      expect(loginExchanges()).toHaveLength(1)
    })
    expect(loginExchanges()[0]?.pathname).toBe('/api/v1/auth/login')
    expect(JSON.parse(loginExchanges()[0]?.body ?? '{}')).toEqual({
      email: 'person@example.com',
      password: 'a password',
      role: 'SENIOR',
    })
  })

  it('reports every unmet client-side rule at once and issues no request', async () => {
    render(<AppShell runtime={signedOutRuntime()} />)

    await screen.findByTestId('login-screen')
    await userEvent.type(screen.getByLabelText('Email address'), 'not-an-address')
    await userEvent.click(screen.getByTestId('login-submit'))

    expect(await screen.findByTestId('login-email-violation')).toBeInTheDocument()
    expect(screen.getByTestId('login-password-violation')).toBeInTheDocument()
    expect(screen.getByTestId('login-role-violation')).toBeInTheDocument()
    expect(loginExchanges()).toHaveLength(0)

    // Req 20 AC6: the message is associated with its input, and focus is on the
    // first affected one.
    const email = screen.getByLabelText('Email address')
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email.getAttribute('aria-describedby')).toContain('login-email-violation')
    expect(email).toHaveFocus()
    // Req 22 AC11: what was entered is still there.
    expect(email).toHaveValue('not-an-address')
  })
})

// ── Establishing the session (AC2) ────────────────────────────────────────────

describe('a successful sign-in (AC2)', () => {
  it('stores both tokens and lands on the Active_Context destination', async () => {
    const runtime = signedOutRuntime()
    render(<AppShell runtime={runtime} />)

    await signIn()

    await waitFor(() => {
      expect(runtime.router.state.location.pathname).toBe(LANDING_PATHS.CANDIDATE)
    })
    expect(runtime.session.getAccessToken()).toBe(CANDIDATE_ACCESS_TOKEN)
    expect(runtime.session.getPrincipal()).toMatchObject({
      sub: 'account-1',
      act: 'CANDIDATE',
      roles: ['CANDIDATE'],
    })
    // The Refresh_Token is held too — it is never exposed, so the proof is that
    // the session reports itself established rather than half-established.
    expect(runtime.session.getSnapshot().authenticated).toBe(true)
    await waitFor(() => {
      expect(screen.queryByTestId('login-screen')).not.toBeInTheDocument()
    })
  })
})

// ── Refusal (AC12) ────────────────────────────────────────────────────────────

describe('a refused sign-in (AC12)', () => {
  /**
   * Renders one refusal, captures the markup of the surface it produced, and tears
   * the whole application down again — so the next refusal is rendered into an
   * empty document by a fresh runtime, and the two are genuinely separate
   * observations rather than two screens alive at once.
   */
  async function refusalMarkup(status: number, error: string, details: unknown): Promise<string> {
    api.answerLoginWith(() => jsonResponse({ error, message: 'server wording', details }, status))
    const { unmount } = render(<AppShell runtime={signedOutRuntime()} />)

    await signIn()

    const notice = await screen.findByTestId('login-rejected')
    const markup = notice.outerHTML

    unmount()
    active?.router.dispose()
    active = null
    resetSharedAppRuntime()
    clearAccountNotApproved()
    clearSessionEnd()
    api = backend()
    window.history.replaceState(null, '', LOGIN_PATH)

    return markup
  }

  // Two complete sign-in cycles through the real stack, so this one case costs
  // roughly twice what every other case here does.
  it(
    'renders the same surface for a 401 and for a 403',
    async () => {
      const wrongCredentials = await refusalMarkup(401, 'authentication_required', null)

      const notApproved = await refusalMarkup(403, 'account_not_approved', {
        status: 'PendingApproval',
        next_step: 'Wait for an administrator to approve your account.',
      })

      // Byte-identical: nothing about which refusal occurred reached the surface.
      expect(notApproved).toBe(wrongCredentials)
    },
    20_000,
  )

  it('discloses neither the account nor the reason, and keeps the entered values', async () => {
    api.answerLoginWith(() =>
      jsonResponse(
        {
          error: 'account_not_approved',
          message: 'Account person@example.com is pending approval',
          details: { status: 'PendingApproval', next_step: 'wait' },
        },
        403,
      ),
    )
    const runtime = signedOutRuntime()
    render(<AppShell runtime={runtime} />)

    await signIn()

    const notice = await screen.findByTestId('login-rejected')
    const rendered = document.body.textContent ?? ''
    expect(rendered).not.toContain('pending approval')
    expect(rendered).not.toContain('PendingApproval')
    expect(rendered).not.toContain('req-abc')
    expect(notice).toHaveAttribute('role', 'alert')

    // No session was established and the user stayed put with their entry intact.
    expect(runtime.session.getAccessToken()).toBeNull()
    expect(runtime.router.state.location.pathname).toBe(LOGIN_PATH)
    expect(screen.getByLabelText('Email address')).toHaveValue('person@example.com')
    expect(screen.getByTestId('login-submit')).toBeEnabled()
  })

  it('presents the multi-factor code step rather than the uniform rejection (Req 5 AC1)', async () => {
    api.answerLoginWith(() => jsonResponse({ error: 'mfa_required', message: null }, 401))
    render(<AppShell runtime={signedOutRuntime()} />)

    await signIn()

    // The code step of `features/mfa`, presented in place of the credential form.
    expect(await screen.findByTestId('mfa-code-step')).toBeInTheDocument()
    expect(screen.queryByTestId('login-form')).not.toBeInTheDocument()
    expect(screen.queryByTestId('login-rejected')).not.toBeInTheDocument()
  })
})

// ── Other failures ────────────────────────────────────────────────────────────

describe('a failure that says nothing about the account', () => {
  it('places 422 Field_Violations back onto their inputs and retains the values', async () => {
    api.answerLoginWith(() =>
      jsonResponse(
        {
          error: 'validation_error',
          message: null,
          details: [{ path: 'email', code: 'invalid_email' }],
        },
        422,
      ),
    )
    render(<AppShell runtime={signedOutRuntime()} />)

    await signIn()

    const violation = await screen.findByTestId('login-email-violation')
    expect(violation).toHaveTextContent('Enter a valid email address.')
    expect(screen.getByLabelText('Email address')).toHaveValue('person@example.com')
    expect(screen.queryByTestId('login-rejected')).not.toBeInTheDocument()
  })

  it('renders the localized message and the Support_Reference for a 5xx', async () => {
    api.answerLoginWith(() =>
      jsonResponse({ error: 'internal_server_error', message: null }, 500),
    )
    render(<AppShell runtime={signedOutRuntime()} />)

    await signIn()

    const state = await screen.findByTestId('error-state')
    expect(state).toHaveTextContent('Something went wrong. Please try again.')
    expect(state).toHaveTextContent('req-abc')
  })
})

// ── The session-expired notice (AC7) ──────────────────────────────────────────

describe('the session-expired notice (AC7)', () => {
  it('renders no notice for a direct visit to the login screen', async () => {
    render(<AppShell runtime={signedOutRuntime()} />)

    await screen.findByTestId('login-screen')
    expect(screen.queryByTestId('login-session-expired')).not.toBeInTheDocument()
  })

  it('renders the notice when a held session was discarded as expired', async () => {
    window.history.replaceState(null, '', LANDING_PATHS.CANDIDATE)
    const runtime = signedOutRuntime()
    runtime.session.login({ accessToken: CANDIDATE_ACCESS_TOKEN, refreshToken: 'refresh-1' })

    render(<AppShell runtime={runtime} />)
    await waitFor(() => {
      expect(runtime.router.state.location.pathname).toBe(LANDING_PATHS.CANDIDATE)
    })

    // What the Session_Manager does when a Refresh_Token exchange is refused.
    runtime.session.clear('session-expired')

    expect(await screen.findByTestId('login-session-expired')).toBeInTheDocument()
    expect(screen.getByTestId('login-screen')).toBeInTheDocument()
  })
})
