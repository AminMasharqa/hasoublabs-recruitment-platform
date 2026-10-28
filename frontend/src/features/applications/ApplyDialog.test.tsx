/**
 * The apply outcomes, asserted through the dialog the Candidate actually sees
 * (Requirement 14 AC4, AC5, AC6, AC7, AC8).
 *
 * `applicationRules.test.ts` already states each outcome as a pure fact — which
 * success recorded an Application, which of the three refusals an envelope is, and
 * what machine context each one carries. None of that is restated here. What it
 * cannot state is the wiring, and that is what every case below is about:
 *
 * - **AC4/AC5** the 200 that carries a `redirect_url` renders a control that opens the
 *   address, says in words that no Application was recorded, and — the part only a
 *   rendered test can establish — *nothing navigates on its own*: `window.open` is
 *   never called and the document's address never changes, so the only path to the
 *   employer's page is the anchor the Candidate activates.
 * - **AC6** each entry of `details.unmet` reaches the DOM as its own condition, in the
 *   reported order, so a Candidate told about one of three unmet conditions is a
 *   failure rather than a rounding.
 * - **AC7** `conflicting_state` says an application for this role already exists,
 *   instead of the generic catalogue entry the Error_Presenter would render.
 * - **AC8** `rate_limited` names the reported `details.retry_after_seconds`.
 *
 * So the dialog is mounted whole over a stub Api_Client that answers the CV_Variant
 * read and whichever apply outcome the case is about, and the assertions are about
 * the rendered surface and the wire. Nothing mocks the mutation, the query cache or
 * the message catalogue: a refusal classified correctly but rendered as the generic
 * error would pass a test of either half alone.
 *
 * The apply control that opens this dialog is Requirement 12's, covered by
 * `jobs/JobStatusControls.test.tsx`, so the dialog is mounted directly with
 * `opened`.
 */

import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { i18n as I18nextInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiClient, ApiFailure, ApiSuccess } from '../../api/client'
import { createI18n } from '../../i18n'
import { AppServicesContext, type AppServices } from '../../shell/appServices'
import { CV_VARIANTS_PATH } from '../cvs/variantApi'
import type { CvVariant } from '../cvs/variantRules'

import { ApplyDialog } from './ApplyDialog'
import { APPLY_PATH } from './applicationsApi'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const JD_ID = 'jd-7'
const JD_TITLE = 'Platform engineer'

/** One active, primary CV_Variant, so the selection has a default to open on (AC2). */
function variant(): CvVariant {
  return {
    id: 'cv-1',
    name: 'Backend CV',
    description: null,
    is_primary: true,
    is_archived: false,
    version_count: 1,
    created_at: '2025-01-01T00:00:00Z',
  }
}

/** An Error_Envelope as the Api_Client throws it. */
function failure(overrides: Partial<ApiFailure> = {}): ApiFailure {
  return {
    error: 'precondition_unmet',
    message: 'The submission was refused.',
    details: {},
    request_id: 'req-apply-1',
    httpStatus: 409,
    supportReference: 'req-apply-1',
    refreshEligible: false,
    authOutcome: 'other',
    fieldViolations: [],
    method: 'post',
    path: APPLY_PATH,
    retryAfter: null,
    retryAfterSeconds: null,
    upstreamService: null,
    retryable: false,
    ...overrides,
  } as ApiFailure
}

/** What the apply submission answers: a success, or a refusal to reject with. */
type ApplyAnswer =
  | { readonly kind: 'success'; readonly httpStatus: number; readonly body: unknown }
  | { readonly kind: 'failure'; readonly envelope: ApiFailure }

interface Backend {
  /** Every path the dialog asked for, in order. */
  readonly paths: string[]
  readonly api: ApiClient
}

function answered<T>(data: T, httpStatus = 200): Promise<ApiSuccess<T>> {
  return Promise.resolve({
    data,
    response: new Response(null, { status: httpStatus }),
    supportReference: 'req-ok',
  })
}

/**
 * An Api_Client answering the CV_Variant read and one apply submission.
 *
 * The apply answer is given per case, because the five acceptance criteria here are
 * exactly five different answers to the same request.
 */
function backend(answer: ApplyAnswer): Backend {
  const paths: string[] = []

  const request = vi.fn((method: string, path: string) => {
    paths.push(path)

    if (method === 'get' && path === CV_VARIANTS_PATH) {
      return answered([variant()])
    }
    if (method === 'post' && path === APPLY_PATH) {
      return answer.kind === 'success'
        ? answered(answer.body, answer.httpStatus)
        : Promise.reject(answer.envelope)
    }
    return Promise.reject(new Error(`unexpected ${method} ${path}`))
  })

  return {
    paths,
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
            <MemoryRouter initialEntries={[`/jobs/${JD_ID}`]}>
              <ApplyDialog
                jdId={JD_ID}
                title={JD_TITLE}
                opened
                onClose={() => undefined}
              />
            </MemoryRouter>
          </AppServicesContext.Provider>
        </QueryClientProvider>
      </I18nextProvider>
    </MantineProvider>,
  )
}

/** Submits the dialog once the CV_Variant selection has settled. */
async function submit(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await screen.findByTestId('apply-variant-select')
  await user.click(screen.getByTestId('apply-submit'))
}

// ── AC4/AC5: the external destination ─────────────────────────────────────────

describe('a 200 carrying a redirect_url (Req 14 AC4, AC5)', () => {
  const REDIRECT_URL = 'https://employer.example.com/careers/platform-engineer'

  /** `window.open`, which nothing in the apply flow may call. */
  let open: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    open = vi.spyOn(window, 'open').mockReturnValue(null)
  })

  afterEach(() => {
    open.mockRestore()
  })

  it('offers a control that opens the address and states that no Application was recorded', async () => {
    const user = userEvent.setup()
    mount(backend({ kind: 'success', httpStatus: 200, body: { redirect_url: REDIRECT_URL } }).api)

    await submit(user)

    // AC4, first half: the surface says no in-platform Application exists, and says
    // it in words rather than by omitting the confirmation.
    const notice = await screen.findByTestId('apply-external')
    expect(screen.getByTestId('apply-external-not-recorded')).toHaveTextContent(
      'No application was recorded on the platform.',
    )
    expect(screen.queryByTestId('apply-recorded')).toBeNull()
    expect(notice).toHaveAttribute('role', 'status')

    // AC4, second half: the control names the reported address and opens a new
    // browsing context.
    const control = screen.getByTestId('apply-external-open')
    expect(control.tagName).toBe('A')
    expect(control).toHaveAttribute('href', REDIRECT_URL)
    expect(control).toHaveAttribute('target', '_blank')
    expect(control.getAttribute('rel')).toContain('noopener')

    // Req 20 AC7: the outcome is announced, and the announcement repeats that
    // nothing was recorded.
    expect(screen.getByTestId('live-announcement')).toHaveTextContent(
      'no application was recorded',
    )
  })

  it('navigates nowhere on its own initiative', async () => {
    const user = userEvent.setup()
    const address = window.location.href
    mount(backend({ kind: 'success', httpStatus: 200, body: { redirect_url: REDIRECT_URL } }).api)

    await submit(user)
    await screen.findByTestId('apply-external')

    // AC5: the address reached the DOM as a control and nothing else. No browsing
    // context was opened for it, and this one was not pointed at it either — so the
    // only remaining path to the employer's page is the Candidate activating the
    // anchor asserted above.
    expect(open).not.toHaveBeenCalled()
    expect(window.location.href).toBe(address)
    expect(screen.getByTestId('apply-external-open')).toHaveAttribute('href', REDIRECT_URL)
  })
})

// ── AC6: every unmet condition, separately ────────────────────────────────────

describe('a precondition_unmet refusal (Req 14 AC6)', () => {
  it('renders each reported entry as its own condition, in the reported order', async () => {
    const user = userEvent.setup()
    mount(
      backend({
        kind: 'failure',
        envelope: failure({
          error: 'precondition_unmet',
          details: {
            unmet: [
              'profile_incomplete',
              'no_cv_version',
              // An entry the catalogue does not name: it still renders as its own
              // condition, from the sentence the Backend_Api supplied.
              { code: 'interview_pending', message: 'Your screening interview is not done.' },
            ],
          },
        }),
      }).api,
    )

    await submit(user)

    await screen.findByTestId('apply-precondition-unmet')
    const conditions = screen.getAllByTestId('apply-unmet-condition')
    // Three reported, three rendered: nothing collapsed, deduplicated or truncated.
    expect(conditions).toHaveLength(3)
    expect(conditions.map((condition) => condition.textContent)).toEqual([
      'Your candidate profile is still a draft.',
      'The selected CV variant has no uploaded version.',
      'Your screening interview is not done.',
    ])
    // The named refusal replaces the generic catalogue entry rather than joining it.
    expect(screen.queryByTestId('error-state')).toBeNull()
  })
})

// ── AC7: an Application already exists ───────────────────────────────────────

describe('a conflicting_state refusal (Req 14 AC7)', () => {
  it('states that an application for this job description already exists', async () => {
    const user = userEvent.setup()
    mount(
      backend({
        kind: 'failure',
        envelope: failure({ error: 'conflicting_state', httpStatus: 409 }),
      }).api,
    )

    await submit(user)

    expect(await screen.findByTestId('apply-conflicting-state')).toHaveTextContent(
      'You have already submitted an application for this job description.',
    )
    expect(screen.queryByTestId('error-state')).toBeNull()
  })
})

// ── AC8: the throttled submission names its wait ─────────────────────────────

describe('a rate_limited refusal (Req 14 AC8)', () => {
  it('names the reported details.retry_after_seconds', async () => {
    const user = userEvent.setup()
    mount(
      backend({
        kind: 'failure',
        envelope: failure({
          error: 'rate_limited',
          httpStatus: 429,
          details: { retry_after_seconds: 42 },
          retryAfter: '42',
          retryAfterSeconds: 42,
        }),
      }).api,
    )

    await submit(user)

    expect(await screen.findByTestId('apply-rate-limited')).toHaveTextContent(
      'Too many attempts. Try again in 42 seconds.',
    )
    expect(screen.queryByTestId('error-state')).toBeNull()
  })

  it('still says to wait when the envelope named no interval', async () => {
    const user = userEvent.setup()
    mount(
      backend({
        kind: 'failure',
        envelope: failure({ error: 'rate_limited', httpStatus: 429, details: {} }),
      }).api,
    )

    await submit(user)

    // Not "try again in undefined seconds": the sentence stands without the member.
    const notice = await screen.findByTestId('apply-rate-limited')
    expect(notice).toHaveTextContent('Too many attempts. Try again shortly.')
    expect(notice.textContent).not.toContain('undefined')
  })
})
