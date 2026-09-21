/**
 * Component tests for the `illegal_transition` reaction of the authoring screen
 * (task 19.2).
 *
 * Requirement 13 AC18: a Job_Description mutation answered with an Error_Envelope
 * whose `error` member is `illegal_transition` renders a localized message naming the
 * reported `details.from` and `details.to`, and the displayed Job_Description is
 * refreshed from the Backend_Api.
 *
 * `illegalTransitionOf` — which reads the two members out of the envelope — has its
 * own unit tests in `authoringRules.test.ts`. What is asserted here is the pair of
 * obligations as they are actually observed: the message reaching the screen, and the
 * refetch happening and the controls being re-derived from whatever the Backend_Api
 * then reports. A failure that is *not* an `illegal_transition` is asserted to do
 * neither, so the refresh is not a blanket reaction to any failed mutation.
 *
 * The read count is asserted exactly rather than "at least once", because *one*
 * re-read is the requirement: a refresh that re-entered its own effect would satisfy
 * "was refetched" while re-reading the Job_Description for as long as the notice
 * stays on screen.
 */

import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { i18n as I18nextInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiClient, ApiFailure, ApiSuccess } from '../../api/client'
import { clearFailedSupportReference } from '../../errors/supportReferenceStore'
import { createI18n } from '../../i18n'
import { SessionContext, type SessionContextValue } from '../../session/sessionState'
import { AppServicesContext, type AppServices } from '../../shell/appServices'

import { JOB_PATH, JOB_PUBLISH_PATH } from './authoringApi'
import { JobAuthoringScreen } from './JobAuthoringScreen'
import type { JobDescription } from './jobsApi'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function jobFixture(overrides: Partial<JobDescription> = {}): JobDescription {
  return {
    // Not `External_Careers_URL`, so the AC13 publish precondition is satisfied and
    // the publish control is the one thing standing between the test and a refusal.
    application_channel: 'Senior_Dashboard',
    closed_at: null,
    company: 'HasoubLabs',
    created_at: '2024-04-01T08:00:00Z',
    creator_account_id: 'acc-1',
    description: 'Build the platform.',
    employment_type: 'Full-time',
    experience_level: 'Mid-level',
    external_url: null,
    id: 'jd-1',
    location: 'Haifa',
    published_at: null,
    // Empty, so no Skill_Taxonomy read is issued for this screen.
    required_skill_ids: [],
    status: 'Draft',
    title: 'Platform engineer',
    updated_at: '2024-04-02T09:30:00Z',
    work_model: 'Hybrid',
    ...overrides,
  }
}

/** An Error_Envelope as the Api_Client throws it. */
function failure(overrides: Partial<ApiFailure> = {}): ApiFailure {
  return {
    error: 'illegal_transition',
    message: 'The job description cannot be published from its current state.',
    details: { from: 'Closed', to: 'Open' },
    request_id: 'req-transition-1',
    httpStatus: 409,
    supportReference: 'req-transition-1',
    refreshEligible: false,
    authOutcome: 'other',
    fieldViolations: [],
    method: 'post',
    path: JOB_PUBLISH_PATH,
    retryAfter: null,
    retryAfterSeconds: null,
    upstreamService: null,
    retryable: false,
    ...overrides,
  } as ApiFailure
}

// ── Harness ───────────────────────────────────────────────────────────────────

let i18n: I18nextInstance

beforeEach(() => {
  i18n = createI18n('en')
  clearFailedSupportReference()
})

/** One recorded request. */
interface RecordedRequest {
  readonly method: string
  readonly path: string
}

/**
 * An Api_Client answering `GET /jobs/{jd_id}` from a queue — each read takes the
 * next entry and holds on the last, so a refetch can report a different status —
 * and refusing the publish with `rejection`.
 */
function apiAnswering(options: {
  readonly reads: readonly JobDescription[]
  readonly rejection: unknown
}) {
  const requests: RecordedRequest[] = []
  let reads = 0

  const request = vi.fn((method: string, path: string) => {
    requests.push({ method, path })

    if (path === JOB_PUBLISH_PATH) {
      return Promise.reject(options.rejection)
    }
    const answered = options.reads[Math.min(reads, options.reads.length - 1)]
    reads += 1
    return Promise.resolve({
      data: answered,
      response: new Response(null, { status: 200 }),
      supportReference: 'req-ok',
    } satisfies ApiSuccess<unknown>)
  })

  const api: ApiClient = {
    request: request as unknown as ApiClient['request'],
    exchangeRefreshToken: () => Promise.reject(new Error('not used')),
    revokeSession: () => Promise.resolve(),
  }
  return { api, requests }
}

/** How often the Job_Description itself was read. */
function detailReads(requests: readonly RecordedRequest[]): number {
  return requests.filter((entry) => entry.method === 'get' && entry.path === JOB_PATH).length
}

/** A Senior session: the screen reads `act` and nothing else. */
const SENIOR_SESSION: SessionContextValue = {
  authenticated: true,
  principal: null,
  roles: ['SENIOR'],
  act: 'SENIOR',
  status: 'Approved',
  nextStep: null,
  subject: { roles: ['SENIOR'], act: 'SENIOR', status: 'Approved' },
  establishSession: () => null,
  retainStatus: () => undefined,
  logout: () => Promise.resolve(),
  clear: () => undefined,
}

function renderScreen(api: ApiClient) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const services: AppServices = { api, queryClient, clearServerState: () => undefined }

  return render(
    <MantineProvider>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <AppServicesContext.Provider value={services}>
            <SessionContext.Provider value={SENIOR_SESSION}>
              <MemoryRouter initialEntries={['/senior/jobs/jd-1']}>
                <Routes>
                  <Route path="/senior/jobs/:jdId" element={<JobAuthoringScreen />} />
                </Routes>
              </MemoryRouter>
            </SessionContext.Provider>
          </AppServicesContext.Provider>
        </QueryClientProvider>
      </I18nextProvider>
    </MantineProvider>,
  )
}

// ── AC18 ──────────────────────────────────────────────────────────────────────

describe('a refused lifecycle transition (Req 13 AC18)', () => {
  it('names the reported states and refetches the Job_Description', async () => {
    const user = userEvent.setup()
    const { api, requests } = apiAnswering({
      reads: [jobFixture()],
      rejection: failure(),
    })
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('job-publish')).toBeEnabled()
    })
    const readsBefore = detailReads(requests)

    await user.click(screen.getByTestId('job-publish'))

    // The two reported states, in the localized message.
    await waitFor(() => {
      expect(screen.getByTestId('job-illegal-transition')).toBeInTheDocument()
    })
    const notice = screen.getByTestId('job-illegal-transition')
    expect(notice).toHaveTextContent('Closed')
    expect(notice).toHaveTextContent('Open')
    expect(notice).toHaveAttribute('role', 'alert')

    // The envelope itself is still presented by the Error_Presenter with its
    // Support_Reference, so AC18 adds context rather than replacing the failure.
    expect(screen.getByTestId('error-state')).toBeInTheDocument()
    expect(screen.getByTestId('support-reference-value')).toHaveTextContent('req-transition-1')

    // The displayed Job_Description is re-read from the Backend_Api.
    await waitFor(() => {
      expect(detailReads(requests)).toBe(readsBefore + 1)
    })
  })

  it('re-derives the controls from the status the refetch reported', async () => {
    const user = userEvent.setup()
    const { api, requests } = apiAnswering({
      // The refusal is the Backend_Api saying the role is already open; the refetch
      // is what tells the screen so.
      reads: [jobFixture({ status: 'Draft' }), jobFixture({ status: 'Open' })],
      rejection: failure({ details: { from: 'Open', to: 'Open' } }),
    })
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('job-publish')).toBeInTheDocument()
    })
    expect(screen.getByTestId('job-status')).toHaveTextContent('Draft')

    await user.click(screen.getByTestId('job-publish'))

    // The refreshed status admits no publish, so the control is gone — the controls
    // follow the Backend_Api rather than what the screen believed.
    await waitFor(() => {
      expect(screen.queryByTestId('job-publish')).toBeNull()
    })
    expect(screen.getByTestId('job-status')).toHaveTextContent('Open')
    expect(screen.getByTestId('job-close')).toBeInTheDocument()
    // Exactly one refresh: the read of the mount, and the AC18 re-read.
    expect(detailReads(requests)).toBe(2)
  })

  it('neither names a transition nor refetches for any other failure', async () => {
    const user = userEvent.setup()
    const { api, requests } = apiAnswering({
      reads: [jobFixture()],
      rejection: failure({
        error: 'conflicting_state',
        details: null,
        message: 'The job description was changed elsewhere.',
      }),
    })
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('job-publish')).toBeEnabled()
    })
    const readsBefore = detailReads(requests)

    await user.click(screen.getByTestId('job-publish'))

    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('job-illegal-transition')).toBeNull()
    expect(detailReads(requests)).toBe(readsBefore)
  })
})
