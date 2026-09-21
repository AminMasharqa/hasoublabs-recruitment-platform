/**
 * The Verification_Code screen, reached the way the application reaches it
 * (Requirement 6 AC11, AC12).
 *
 * `verifyCode.test.ts` already pins the two request bodies, the six-digit rule
 * and the `code_entry_locked` classification as pure functions. What only a
 * rendering can show is the pair of state transitions those functions feed:
 *
 * - AC11 a refused submission carrying `code_entry_locked` disables the code
 *   input and leaves the resend control as the *only* control — the submit
 *   control is absent from the document, not disabled next to it.
 * - AC12 a resend answered 204 re-enables the input and clears what was entered,
 *   and a resend that is *not* answered 204 changes neither.
 *
 * The screen is reached by registering, not by mounting it with hand-made props:
 * the account identifier it submits arrives in router state from the registration
 * screen (`verificationHandoff.ts`), so a locally mounted component would be
 * verifying an account the application never created. Everything below therefore
 * runs on the genuine runtime — real Api_Client over a stub `fetch`, real
 * TanStack Query cache, real router, the real `SCREEN_ELEMENTS` table.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { RESOURCES } from '../../i18n'
import { registrationPath } from '../../routing/paths'
import { createAppRuntime, resetSharedAppRuntime, type AppRuntime } from '../../shell/appRuntime'
import { AppShell, AppShellLayout } from '../../shell/AppShell'
import { SCREEN_ELEMENTS } from '../../shell/screenElements'

// ── The stub Backend_Api ──────────────────────────────────────────────────────

const TOKEN = 'link-token-1'

/** The identifier the registration returns and the verification must submit. */
const ACCOUNT_ID = 'account-7'

/** A well-formed code, so nothing below is refused by the client-side rule. */
const CODE = '123456'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'req-abc' },
  })
}

interface Exchange {
  readonly method: string
  readonly pathname: string
  readonly body: string
}

interface Backend {
  readonly exchanges: Exchange[]
  answerCodeWith(response: () => Response): void
  answerResendWith(response: () => Response): void
  fetch(request: Request): Promise<Response>
}

function backend(): Backend {
  const exchanges: Exchange[] = []
  const account = {
    id: ACCOUNT_ID,
    email: 'dana@example.com',
    roles: ['CANDIDATE'],
    status: 'PendingVerification',
    language_preference: 'en',
    mfa_enrolled: false,
    created_at: '2030-01-01T00:00:00.000Z',
  }
  let codeResponse = (): Response => jsonResponse(account)
  // The contract's own answer to a resend (AC12).
  let resendResponse = (): Response => new Response(null, { status: 204 })

  return {
    exchanges,
    answerCodeWith(response) {
      codeResponse = response
    },
    answerResendWith(response) {
      resendResponse = response
    },
    async fetch(request: Request): Promise<Response> {
      const { pathname } = new URL(request.url)
      exchanges.push({
        method: request.method,
        pathname,
        body: await request.clone().text(),
      })
      if (pathname.startsWith('/api/v1/registration-links/')) {
        return jsonResponse({
          id: '11111111-1111-4111-8111-111111111111',
          role: 'CANDIDATE',
          expires_at: '2030-01-01T00:00:00.000Z',
        })
      }
      if (pathname.startsWith('/api/v1/register/')) {
        return jsonResponse(account, 201)
      }
      if (pathname === '/api/v1/verify/code') {
        return codeResponse()
      }
      if (pathname === '/api/v1/verify/resend') {
        return resendResponse()
      }
      return jsonResponse({ error: 'not_found' }, 404)
    },
  }
}

let active: AppRuntime | null = null
let api: Backend

function runtime(): AppRuntime {
  const built = createAppRuntime({
    shellElement: <AppShellLayout />,
    // The table the shell itself passes, so the screen under test is the
    // registered one and not a second, test-local mounting.
    elements: SCREEN_ELEMENTS,
    apiRuntime: {
      baseUrl: 'https://backend.test/api/v1',
      locale: () => 'en',
      fetch: (request) => api.fetch(request),
    },
  })
  active = built
  return built
}

function requestsTo(path: string): Exchange[] {
  return api.exchanges.filter((exchange) => exchange.pathname === path)
}

function codeRequests(): Exchange[] {
  return requestsTo('/api/v1/verify/code')
}

function resendRequests(): Exchange[] {
  return requestsTo('/api/v1/verify/resend')
}

beforeEach(() => {
  window.history.replaceState(null, '', registrationPath(TOKEN))
  resetSharedAppRuntime()
  api = backend()
})

afterEach(() => {
  active?.router.dispose()
  active = null
  resetSharedAppRuntime()
})

// ── Reaching the screen ───────────────────────────────────────────────────────

/**
 * Types into one input.
 *
 * `fireEvent.change` rather than `userEvent.type`, as in `RegistrationScreen.test.tsx`:
 * every keystroke of a controlled input re-renders the form, and what is asserted
 * here is the submitted body and the rendered outcome. Keyboard operability is
 * Requirement 20's own gate.
 */
function fill(input: HTMLElement, value: string): void {
  fireEvent.change(input, { target: { value } })
}

/** Lets an in-flight request reach the stub before the absence of one is asserted. */
function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

/** The code input, whatever state it is in. */
function codeInput(): HTMLElement {
  return screen.getByLabelText(/^Verification code/)
}

/**
 * Registers, so the verification screen is reached carrying the account
 * identifier AC8 retained — the only way it is ever reached.
 */
async function reachVerification(): Promise<void> {
  render(<AppShell runtime={runtime()} />)

  fill(await screen.findByLabelText(/^Full name/), 'Dana Cohen')
  fill(screen.getByLabelText(/^Email address/), 'dana@example.com')
  fill(screen.getByLabelText(/^Password/), 'a long enough passphrase')
  fill(screen.getByLabelText(/^Mobile phone number/), '+972500000000')
  await userEvent.click(screen.getByTestId('registration-submit'))

  await screen.findByTestId('verification-form')
}

/** Enters a code and submits it. */
async function submitCode(code: string = CODE): Promise<void> {
  fill(codeInput(), code)
  await userEvent.click(screen.getByTestId('verification-submit'))
}

/** Reaches the locked state of AC11 by having one submission refused. */
async function reachLocked(): Promise<void> {
  api.answerCodeWith(() => jsonResponse({ error: 'code_entry_locked', message: null }, 403))
  await reachVerification()
  await submitCode()
  await waitFor(() => {
    expect(codeInput()).toBeDisabled()
  })
}

// ── AC11: the lock ────────────────────────────────────────────────────────────

describe('a submission refused with code_entry_locked (AC11)', () => {
  it('disables the code input and leaves the resend control as the only one', async () => {
    await reachLocked()

    // The submitted body, en route to the lock: the retained identifier and the
    // collected code (AC9).
    expect(codeRequests()).toHaveLength(1)
    expect(JSON.parse(codeRequests()[0]?.body ?? '{}')).toEqual({
      account_id: ACCOUNT_ID,
      code: CODE,
    })

    // "Present only the resend control": the submit control is gone from the
    // document rather than sitting next to the resend in a disabled state.
    expect(screen.queryByTestId('verification-submit')).toBeNull()
    const resend = screen.getByTestId('verification-resend')
    expect(resend).toBeEnabled()
    expect(within(screen.getByTestId('verification-form')).getAllByRole('button')).toEqual([resend])

    // Req 21 AC1: the localized catalogue entry for the `error` member, which is
    // also the instruction to use the control that is left.
    expect(screen.getByTestId('error-state')).toHaveTextContent(
      RESOURCES.en.errors.code_entry_locked,
    )
  })

  it('submits nothing further while entry is locked', async () => {
    await reachLocked()

    // Whatever else could submit the form — a stray Enter, a restored control —
    // finds a screen that issues no second submission.
    fireEvent.submit(screen.getByTestId('verification-form'))
    await flush()

    expect(codeRequests()).toHaveLength(1)
  })
})

// ── AC12: the resend ──────────────────────────────────────────────────────────

describe('the resend control (AC12)', () => {
  it('calls the resend endpoint with the retained account identifier', async () => {
    await reachVerification()

    await userEvent.click(screen.getByTestId('verification-resend'))

    await waitFor(() => {
      expect(resendRequests()).toHaveLength(1)
    })
    expect(resendRequests()[0]?.method).toBe('POST')
    expect(JSON.parse(resendRequests()[0]?.body ?? '{}')).toEqual({ account_id: ACCOUNT_ID })
    // The resend never submits the code alongside itself.
    expect(codeRequests()).toHaveLength(0)
  })

  it('re-enables the input and clears the entered code on a 204', async () => {
    await reachLocked()

    await userEvent.click(screen.getByTestId('verification-resend'))

    await waitFor(() => {
      expect(codeInput()).toBeEnabled()
    })
    expect(codeInput()).toHaveValue('')
    // The submit control is back, so the new code can actually be submitted.
    expect(screen.getByTestId('verification-submit')).toBeEnabled()
    // The lock notice is gone with the lock.
    expect(screen.queryByTestId('error-state')).toBeNull()
    expect(screen.getByTestId('verification-resent')).toHaveTextContent(
      RESOURCES.en.registration.verification.resent,
    )
  })

  it('clears a code that was entered without ever being submitted', async () => {
    await reachVerification()
    fill(codeInput(), '000111')

    await userEvent.click(screen.getByTestId('verification-resend'))

    await waitFor(() => {
      expect(codeInput()).toHaveValue('')
    })
    expect(codeInput()).toBeEnabled()
  })

  it('leaves the lock in place when the resend is refused', async () => {
    await reachLocked()
    api.answerResendWith(() => jsonResponse({ error: 'rate_limited', message: null }, 429))

    await userEvent.click(screen.getByTestId('verification-resend'))

    // Only the 204 of AC12 unlocks: the refusal is reported and nothing else moves.
    expect(await screen.findByText(RESOURCES.en.errors.rate_limited)).toBeInTheDocument()
    expect(codeInput()).toBeDisabled()
    expect(codeInput()).toHaveValue(CODE)
    expect(screen.queryByTestId('verification-submit')).toBeNull()
    expect(screen.queryByTestId('verification-resent')).toBeNull()
  })
})
