/**
 * The Admin enrolment panel as it is actually rendered (Requirement 5 AC4, AC5,
 * AC6).
 *
 * `mfaEnrolment.test.ts` pins the two requests and the decoders. All three criteria
 * here are about the rendering those decoders feed:
 *
 * - AC4 the returned `qr_code_png_b64` is *an image*, and the `provisioning_uri` is
 *   selectable text rather than an input the user could edit;
 * - AC5 the image's text alternative directs the reader to that `provisioning_uri` —
 *   asserted against the label the value is actually rendered under, so a text
 *   alternative pointing at something that is not on screen fails;
 * - AC6 the verification control posts a 6-digit code and renders the confirmation
 *   only when the response reports a verified outcome.
 *
 * A stub Api_Client rather than a stub `fetch`: no session, no router and no token
 * custody takes part in any of these, and the panel reads the client through
 * `AppServicesContext` exactly as it does in the application.
 */

import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { i18n as I18nextInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiClient, ApiSuccess } from '../../api/client'
import { createI18n } from '../../i18n'
import { AppServicesContext, type AppServices } from '../../shell/appServices'

import { MFA_ENROLL_PATH, MFA_VERIFY_PATH } from './mfaEnrolment'
import { MfaEnrolmentPanel } from './MfaEnrolmentPanel'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ACCOUNT_ID = 'account-1'

/** A `provisioning_uri` of the shape an authenticator app consumes. */
const PROVISIONING_URI =
  'otpauth://totp/HasoubLabs:admin@example.com?secret=JBSWY3DPEHPK3PXP&issuer=HasoubLabs'

/** Valid base64, so `qrCodeImageSource` renders it rather than refusing it. */
const QR_PNG_B64 = 'iVBORw0KGgo='

/** One request the panel issued. */
interface Call {
  readonly method: string
  readonly path: string
  readonly body: unknown
}

interface Backend {
  readonly calls: Call[]
  /** Replaces the answer to `POST /auth/mfa/verify`. */
  answerVerifyWith(answer: () => Promise<unknown>): void
  readonly api: ApiClient
}

/**
 * An Api_Client answering the two enrolment endpoints.
 *
 * `POST /auth/mfa/enroll` returns both artefacts; the verify answer is whatever the
 * case scripted, so a refusal is thrown as the {@link ApiFailure} shape the real
 * client throws.
 */
function backend(
  enrolment: Record<string, unknown> = {
    provisioning_uri: PROVISIONING_URI,
    qr_code_png_b64: QR_PNG_B64,
  },
): Backend {
  const calls: Call[] = []
  let verify = (): Promise<unknown> => Promise.resolve({ verified: true })

  const success = (data: unknown): ApiSuccess<unknown> => ({
    data,
    response: new Response(null, { status: 200 }),
    supportReference: 'req-ok',
  })

  const request = vi.fn(async (method: string, path: string, init?: { body?: unknown }) => {
    calls.push({ method, path, body: init?.body })
    if (path === MFA_ENROLL_PATH) {
      return success(enrolment)
    }
    if (path === MFA_VERIFY_PATH) {
      return success(await verify())
    }
    return Promise.reject(new Error(`unexpected request: ${method} ${path}`))
  })

  return {
    calls,
    answerVerifyWith(answer) {
      verify = answer
    },
    api: {
      request: request as unknown as ApiClient['request'],
      exchangeRefreshToken: () => Promise.reject(new Error('not used')),
      revokeSession: () => Promise.resolve(),
    },
  }
}

let i18n: I18nextInstance

beforeEach(() => {
  i18n = createI18n('en')
})

/** Mounts the panel under the providers it reads its client and strings from. */
function mount(api: ApiClient) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const services: AppServices = { api, queryClient, clearServerState: () => undefined }

  return render(
    <MantineProvider>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <AppServicesContext.Provider value={services}>
            <MfaEnrolmentPanel accountId={ACCOUNT_ID} />
          </AppServicesContext.Provider>
        </QueryClientProvider>
      </I18nextProvider>
    </MantineProvider>,
  )
}

/** Activates the enrolment control and waits for the artefacts to render. */
async function startEnrolment(): Promise<void> {
  await userEvent.click(screen.getByTestId('mfa-enrol-start'))
  await screen.findByTestId('mfa-enrolment')
}

// ── The artefacts (AC4, AC5) ──────────────────────────────────────────────────

describe('the enrolment artefacts (AC4, AC5)', () => {
  it('renders nothing until the enrolment control is activated', () => {
    const { api, calls } = backend()
    mount(api)

    // A mount must not mint a secret: every call replaces the stored one.
    expect(calls).toHaveLength(0)
    expect(screen.queryByTestId('mfa-enrolment')).toBeNull()
    expect(screen.getByTestId('mfa-enrol-replaces-notice')).toBeInTheDocument()
  })

  it('renders the returned QR bytes as an image and the URI as selectable text', async () => {
    const { api, calls } = backend()
    mount(api)

    await startEnrolment()

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `post ${MFA_ENROLL_PATH}`,
    ])

    // AC4: the bytes are the image, carried inline rather than re-requested.
    const image = screen.getByTestId('mfa-qr-image')
    expect(image.tagName).toBe('IMG')
    expect(image).toHaveAttribute('src', `data:image/png;base64,${QR_PNG_B64}`)

    // AC4: the URI is text, byte-identical and not an editable control.
    const uri = screen.getByTestId('mfa-provisioning-uri')
    expect(uri.textContent).toBe(PROVISIONING_URI)
    expect(uri.querySelector('input, textarea')).toBeNull()
  })

  it('directs the text alternative to the setup address rendered beside it (AC5)', async () => {
    const { api } = backend()
    mount(api)

    await startEnrolment()

    // The label the `provisioning_uri` is rendered under, from the catalogue.
    const label = i18n.t('auth:mfa.provisioningUri')
    const alternative = screen.getByTestId('mfa-qr-image').getAttribute('alt') ?? ''

    // AC5: the alternative names the value's own label, so a reader who cannot use
    // the image is sent to something that is on the screen — and it is the URI.
    expect(alternative.toLowerCase()).toContain(String(label).toLowerCase())
    expect(screen.getByTestId('mfa-provisioning-uri').textContent).toBe(PROVISIONING_URI)
    // Not a description of a square pattern, and never the secret itself.
    expect(alternative).not.toContain('JBSWY3DPEHPK3PXP')
  })

  it('says so rather than rendering a broken image when the bytes are unusable', async () => {
    const { api } = backend({ provisioning_uri: PROVISIONING_URI, qr_code_png_b64: 'not base64!' })
    mount(api)

    await startEnrolment()

    // An unusable value would become a relative `img src` the browser would fetch.
    expect(screen.queryByTestId('mfa-qr-image')).toBeNull()
    expect(screen.getByTestId('mfa-qr-missing')).toBeInTheDocument()
    // The authoritative value is still there, which is the point of AC5.
    expect(screen.getByTestId('mfa-provisioning-uri').textContent).toBe(PROVISIONING_URI)
  })
})

// ── The verification control (AC6) ────────────────────────────────────────────

describe('the verification control (AC6)', () => {
  it('posts the 6-digit code and renders the confirmation of a verified outcome', async () => {
    const { api, calls } = backend()
    mount(api)

    await startEnrolment()
    await userEvent.type(screen.getByTestId('mfa-verify-input'), '654321')
    await userEvent.click(screen.getByTestId('mfa-verify-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('mfa-verified')).toBeInTheDocument()
    })
    const verifyCall = calls.find((call) => call.path === MFA_VERIFY_PATH)
    expect(verifyCall?.method).toBe('post')
    expect(verifyCall?.body).toEqual({ account_id: ACCOUNT_ID, code: '654321' })
    expect(screen.getByTestId('mfa-verified')).toHaveTextContent(
      'Two-step verification is confirmed for this account.',
    )
    // The code is not left sitting in the input after it has been spent.
    expect(screen.getByTestId('mfa-verify-input')).toHaveValue('')
  })

  it('withholds the code until six digits have been entered', async () => {
    const { api, calls } = backend()
    mount(api)

    await startEnrolment()
    await userEvent.type(screen.getByTestId('mfa-verify-input'), '65')

    expect(screen.getByTestId('mfa-verify-submit')).toBeDisabled()
    expect(calls.some((call) => call.path === MFA_VERIFY_PATH)).toBe(false)
  })

  it('renders no confirmation for a 200 that does not report a verified outcome', async () => {
    const { api, answerVerifyWith } = backend()
    answerVerifyWith(() => Promise.resolve({ verified: false }))
    mount(api)

    await startEnrolment()
    await userEvent.type(screen.getByTestId('mfa-verify-input'), '000000')
    await userEvent.click(screen.getByTestId('mfa-verify-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('mfa-unverified')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('mfa-verified')).toBeNull()
  })

  it('renders the localized message of a refused code and clears the input', async () => {
    const { api, answerVerifyWith } = backend()
    answerVerifyWith(() =>
      Promise.reject({
        error: 'invalid_mfa_code',
        message: 'server wording',
        httpStatus: 401,
        fieldViolations: [],
      }),
    )
    mount(api)

    await startEnrolment()
    await userEvent.type(screen.getByTestId('mfa-verify-input'), '123456')
    await userEvent.click(screen.getByTestId('mfa-verify-submit'))

    const refused = await screen.findByTestId('mfa-verify-refused')
    expect(refused).toHaveTextContent('That authenticator code is incorrect.')
    expect(screen.queryByTestId('mfa-verified')).toBeNull()
    expect(screen.getByTestId('mfa-verify-input')).toHaveValue('')
  })
})
