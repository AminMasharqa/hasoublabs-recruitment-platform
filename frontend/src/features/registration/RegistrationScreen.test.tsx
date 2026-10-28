/**
 * The Registration_Link screen, mounted on its real route (Requirement 6 AC1,
 * AC2, AC3, AC5, AC6, AC8, AC13).
 *
 * Driven through the genuine runtime — real Api_Client over a stub `fetch`, real
 * TanStack Query cache, real router, the real `SCREEN_ELEMENTS` table — because
 * AC1 is a statement about the route as much as about the component: the screen
 * has to be reachable at `/register/:token` *without a session*, and the token in
 * the address has to be the one validated. A locally mounted component could not
 * show either.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { RESOURCES } from '../../i18n'
import { registrationPath, ROUTE_PATHS } from '../../routing/paths'
import { createAppRuntime, resetSharedAppRuntime, type AppRuntime } from '../../shell/appRuntime'
import { AppShell, AppShellLayout } from '../../shell/AppShell'
import { SCREEN_ELEMENTS } from '../../shell/screenElements'

// ── The stub Backend_Api ──────────────────────────────────────────────────────

const TOKEN = 'link-token-1'

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
  answerLinkWith(response: () => Response): void
  answerRegistrationWith(response: () => Response): void
  fetch(request: Request): Promise<Response>
}

function backend(): Backend {
  const exchanges: Exchange[] = []
  let linkResponse = (): Response =>
    jsonResponse({
      id: '11111111-1111-4111-8111-111111111111',
      role: 'CANDIDATE',
      expires_at: '2030-01-01T00:00:00.000Z',
    })
  let registrationResponse = (): Response =>
    jsonResponse(
      {
        id: 'account-1',
        email: 'dana@example.com',
        roles: ['CANDIDATE'],
        status: 'PendingVerification',
        language_preference: 'en',
        mfa_enrolled: false,
        created_at: '2030-01-01T00:00:00.000Z',
      },
      201,
    )

  return {
    exchanges,
    answerLinkWith(response) {
      linkResponse = response
    },
    answerRegistrationWith(response) {
      registrationResponse = response
    },
    async fetch(request: Request): Promise<Response> {
      const { pathname } = new URL(request.url)
      exchanges.push({
        method: request.method,
        pathname,
        body: await request.clone().text(),
      })
      if (pathname.startsWith('/api/v1/registration-links/')) {
        return linkResponse()
      }
      if (pathname.startsWith('/api/v1/register/')) {
        return registrationResponse()
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
    // The table the shell itself passes, so this asserts the registration of the
    // screen and not a second, test-local one.
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

function registrationRequests(): Exchange[] {
  return api.exchanges.filter((exchange) => exchange.pathname.startsWith('/api/v1/register/'))
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

/**
 * Types into one input.
 *
 * `fireEvent.change` rather than `userEvent.type`: every keystroke of a
 * controlled input re-renders the whole form, and this file fills six of them
 * across five cases. What is being asserted is the submitted body and the
 * rendered outcome, not the keystroke handling — keyboard operability is
 * Requirement 20's own gate.
 */
function fill(input: HTMLElement, value: string): void {
  fireEvent.change(input, { target: { value } })
}

/** Fills everything Requirement 6 AC4 collects except the Residency_Proof. */
async function fillIdentity(): Promise<void> {
  fill(await screen.findByLabelText(/^Full name/), 'Dana Cohen')
  fill(screen.getByLabelText(/^Email address/), 'dana@example.com')
  fill(screen.getByLabelText(/^Password/), 'a long enough passphrase')
}

// ── Validating the token (AC1, AC2, AC3) ──────────────────────────────────────

describe('validating the Registration_Link (AC1)', () => {
  it('validates the token from the address without a session', async () => {
    render(<AppShell runtime={runtime()} />)

    await screen.findByTestId('registration-form')
    const validation = api.exchanges.filter((exchange) =>
      exchange.pathname.startsWith('/api/v1/registration-links/'),
    )
    expect(validation).toHaveLength(1)
    expect(validation[0]?.pathname).toBe(`/api/v1/registration-links/${TOKEN}`)
    expect(validation[0]?.method).toBe('GET')
  })

  it('renders the form for the role the link named, offering no role control (AC2)', async () => {
    api.answerLinkWith(() =>
      jsonResponse({
        id: '11111111-1111-4111-8111-111111111111',
        role: 'SENIOR',
        expires_at: '2030-01-01T00:00:00.000Z',
      }),
    )
    render(<AppShell runtime={runtime()} />)

    expect(await screen.findByTestId('registration-role')).toHaveTextContent(
      'This link creates a senior account.',
    )
    // The role is shown as text: its label addresses no control.
    expect(screen.queryByLabelText('Account type')).toBeNull()
  })

  it('renders the invalid-or-expired screen and no form when the link is refused (AC3)', async () => {
    api.answerLinkWith(() => jsonResponse({ error: 'not_found', message: 'gone' }, 404))
    render(<AppShell runtime={runtime()} />)

    expect(await screen.findByTestId('registration-invalid-link')).toBeInTheDocument()
    expect(screen.queryByTestId('registration-form')).toBeNull()
    expect(registrationRequests()).toHaveLength(0)
  })

  /**
   * AC3 is scoped to "a status code in the range 400 to 599", so the surface is
   * pinned at both ends of that range rather than only on the 404 above — and it
   * is the *same* surface each time, carrying the localized instruction to ask
   * for a new link and nothing the Backend_Api said about the refusal.
   */
  it.each([
    [400, 'bad_request'],
    [403, 'not_authorized'],
    [422, 'validation_error'],
    [500, 'internal_server_error'],
    [599, 'http_error'],
  ])('renders the localized instruction and no form for a %i (AC3)', async (status, error) => {
    api.answerLinkWith(() => jsonResponse({ error, message: 'server wording' }, status))
    render(<AppShell runtime={runtime()} />)

    expect(await screen.findByTestId('registration-invalid-link')).toHaveTextContent(
      RESOURCES.en.registration.invalidLink.body,
    )
    expect(screen.queryByTestId('registration-form')).toBeNull()
    expect(screen.queryByTestId('registration-submit')).toBeNull()
    // Nothing about the refusal is echoed back: not the wording, not the
    // Support_Reference. A bad link tells the user only what they already know.
    const rendered = document.body.textContent ?? ''
    expect(rendered).not.toContain('server wording')
    expect(rendered).not.toContain('req-abc')
    expect(registrationRequests()).toHaveLength(0)
  })

  it('renders the invalid-or-expired screen for a link naming a role it cannot register', async () => {
    api.answerLinkWith(() =>
      jsonResponse({
        id: '11111111-1111-4111-8111-111111111111',
        role: 'ADMIN',
        expires_at: '2030-01-01T00:00:00.000Z',
      }),
    )
    render(<AppShell runtime={runtime()} />)

    expect(await screen.findByTestId('registration-invalid-link')).toBeInTheDocument()
    expect(screen.queryByTestId('registration-form')).toBeNull()
  })
})

// ── Submitting (AC5, AC6, AC8, AC13) ──────────────────────────────────────────

describe('submitting the form', () => {
  it('posts the collected values and the token to the role’s endpoint (AC6)', async () => {
    render(<AppShell runtime={runtime()} />)

    await fillIdentity()
    fill(screen.getByLabelText(/^Mobile phone number/), '+972500000000')
    await userEvent.click(screen.getByTestId('registration-submit'))

    await waitFor(() => {
      expect(registrationRequests()).toHaveLength(1)
    })
    const request = registrationRequests()[0]
    expect(request?.pathname).toBe('/api/v1/register/candidate')
    expect(JSON.parse(request?.body ?? '{}')).toEqual({
      role: 'CANDIDATE',
      link_token: TOKEN,
      full_name: 'Dana Cohen',
      email: 'dana@example.com',
      password: 'a long enough passphrase',
      language_preference: 'en',
      residency_proof_type: 'MobilePhone',
      residency_proof_value: '+972500000000',
    })
  })

  it('composes the separately collected address into residency_proof_value (AC5)', async () => {
    render(<AppShell runtime={runtime()} />)

    await fillIdentity()
    await userEvent.selectOptions(screen.getByLabelText(/^Residency proof/), 'Address')

    const address = await screen.findByTestId('registration-address')
    expect(address).toBeInTheDocument()
    fill(screen.getByLabelText(/^Street/), 'Herzl')
    fill(screen.getByLabelText(/^House or building number/), '12')
    fill(screen.getByLabelText(/^City/), 'Haifa')
    fill(screen.getByLabelText(/^Country/), 'Israel')
    await userEvent.click(screen.getByTestId('registration-submit'))

    await waitFor(() => {
      expect(registrationRequests()).toHaveLength(1)
    })
    const body = JSON.parse(registrationRequests()[0]?.body ?? '{}') as Record<string, unknown>
    expect(body.residency_proof_type).toBe('Address')
    expect(body.residency_proof_value).toBe('Herzl 12, Haifa, Israel')
  })

  it('navigates to the Verification_Code screen on 201 (AC8)', async () => {
    render(<AppShell runtime={runtime()} />)

    await fillIdentity()
    fill(screen.getByLabelText(/^Mobile phone number/), '+972500000000')
    await userEvent.click(screen.getByTestId('registration-submit'))

    await waitFor(() => {
      expect(window.location.pathname).toBe(ROUTE_PATHS.verification)
    })
  })

  it('names the email conflict and renders no other account detail (AC13)', async () => {
    api.answerRegistrationWith(() =>
      jsonResponse(
        {
          error: 'conflicting_state',
          message: 'account 42 for dana@example.com is already Approved',
          details: { status: 'Approved', account_id: '42' },
        },
        409,
      ),
    )
    render(<AppShell runtime={runtime()} />)

    await fillIdentity()
    fill(screen.getByLabelText(/^Mobile phone number/), '+972500000000')
    await userEvent.click(screen.getByTestId('registration-submit'))

    const conflict = await screen.findByTestId('registration-email-conflict')
    expect(conflict).toHaveTextContent('An account already exists for this email address.')
    // Neither the envelope message nor its details reach the screen.
    expect(document.body.textContent).not.toContain('Approved')
    expect(document.body.textContent).not.toContain('42')
    // The entered values are retained (AC14).
    expect(screen.getByLabelText(/^Full name/)).toHaveValue('Dana Cohen')
  })

  it('places a reported Field_Violation on the input its path addresses (AC14)', async () => {
    api.answerRegistrationWith(() =>
      jsonResponse(
        {
          error: 'validation_error',
          message: 'invalid',
          details: [{ loc: ['body', 'email'], type: 'value_error', msg: 'not deliverable' }],
        },
        422,
      ),
    )
    render(<AppShell runtime={runtime()} />)

    await fillIdentity()
    fill(screen.getByLabelText(/^Mobile phone number/), '+972500000000')
    await userEvent.click(screen.getByTestId('registration-submit'))

    const email = await screen.findByLabelText(/^Email address/)
    await waitFor(() => {
      expect(email).toHaveAttribute('aria-invalid', 'true')
    })
    expect(email).toHaveValue('dana@example.com')
    expect(screen.getByLabelText(/^Full name/)).toHaveValue('Dana Cohen')
  })

  /**
   * AC13 for both `error` members that mean it.
   *
   * The taxonomy's narrower `duplicate_email` reaches the same fixed sentence as
   * `conflicting_state`, and the assertion is the whole catalogue entry rather
   * than a fragment of it — so a future surface that appended the envelope's own
   * wording to the sentence would still fail here.
   */
  it.each(['conflicting_state', 'duplicate_email'])(
    'renders one fixed localized sentence for a %s refusal and nothing else (AC13)',
    async (error) => {
      api.answerRegistrationWith(() =>
        jsonResponse(
          {
            error,
            message: 'account 42 for dana@example.com is already Approved',
            details: { status: 'Approved', account_id: '42' },
          },
          409,
        ),
      )
      render(<AppShell runtime={runtime()} />)

      await fillIdentity()
      fill(screen.getByLabelText(/^Mobile phone number/), '+972500000000')
      await userEvent.click(screen.getByTestId('registration-submit'))

      expect(await screen.findByTestId('registration-email-conflict')).toHaveTextContent(
        RESOURCES.en.registration.emailConflict,
      )
      // No Error_Presenter surface either: the conflict is not accompanied by the
      // envelope's message, its details or its Support_Reference.
      expect(screen.queryByTestId('error-state')).toBeNull()
      const rendered = document.body.textContent ?? ''
      expect(rendered).not.toContain('Approved')
      expect(rendered).not.toContain('42')
      expect(rendered).not.toContain('req-abc')
    },
  )

  /**
   * AC14 in full: *each* Field_Violation on the input its path addresses, every
   * entered value retained, and — Requirement 20 AC6 — focus on the first
   * affected input in rendering order rather than the first one the envelope
   * happened to list.
   */
  it('places every reported violation at once, keeps the entry and moves focus (AC14)', async () => {
    api.answerRegistrationWith(() =>
      jsonResponse(
        {
          error: 'validation_error',
          message: 'invalid',
          details: [
            // Deliberately not in rendering order.
            { path: 'residency_proof_value', code: 'invalid_e164' },
            { path: 'email', code: 'invalid_email' },
            // Addresses no rendered input: the token came from the address bar.
            { path: 'link_token', code: 'invalid' },
          ],
        },
        422,
      ),
    )
    render(<AppShell runtime={runtime()} />)

    await fillIdentity()
    fill(screen.getByLabelText(/^Mobile phone number/), '+972500000000')
    await userEvent.click(screen.getByTestId('registration-submit'))

    expect(await screen.findByTestId('violation-email')).toHaveTextContent(
      RESOURCES.en.errors.field.invalid_email,
    )
    expect(screen.getByTestId('violation-residency_proof_value')).toHaveTextContent(
      RESOURCES.en.errors.field.invalid_e164,
    )
    // Req 22 AC10: the unaddressable one is reported in the form-level region
    // rather than dropped.
    expect(screen.getByTestId('registration-form-violations')).toHaveTextContent(
      RESOURCES.en.errors.field.invalid,
    )

    // Req 20 AC6: the email input is affected and renders before the
    // Residency_Proof, so it is where a person starts correcting.
    expect(screen.getByLabelText(/^Email address/)).toHaveFocus()

    // AC14: every value the user entered is still there.
    expect(screen.getByLabelText(/^Full name/)).toHaveValue('Dana Cohen')
    expect(screen.getByLabelText(/^Email address/)).toHaveValue('dana@example.com')
    expect(screen.getByLabelText(/^Password/)).toHaveValue('a long enough passphrase')
    expect(screen.getByLabelText(/^Mobile phone number/)).toHaveValue('+972500000000')
    expect(screen.getByLabelText(/^Preferred language/)).toHaveValue('en')
  })
})
