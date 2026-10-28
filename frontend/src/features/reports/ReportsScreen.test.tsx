/**
 * Component tests for the reports destination (tasks 24.1 and 24.2).
 *
 * The export half of the suite drives the poll with `vi.useFakeTimers()`, so
 * "at an interval of at most 5 seconds" is asserted by advancing exactly one
 * interval and counting the requests that resulted — never by waiting on a real
 * clock — and "stops at a terminal status" is asserted by advancing far past the
 * interval and watching the request count stay put. The lifecycle *rules*
 * themselves belong to `exportPolling.test.ts`; what is asserted here is the
 * wiring: which requests leave, when they stop, and what the screen renders.
 *
 * Requirement 18:
 * - AC1 every returned activity metric is rendered.
 * - AC2 the applied date range and Job_Description are sent as query parameters
 *   of the activity report.
 * - AC3 each candidate-progress row renders the email address, the
 *   Account_Status, the creation timestamp and every Application status.
 * - AC4 at most 20 rows are requested and the next-page control sends the
 *   response's `next_cursor` as `after_id`.
 * - AC5 each row carries drill-down controls to the account, the
 *   Job_Description and the Application.
 * - AC6 the export control posts to the entity's path with the applied filters.
 * - AC7 the 202's `job_id` is polled at an interval of at most 5 seconds until
 *   the status is terminal, and dismissal stops the poll.
 * - AC8 a ready job renders the download control and `expires_at`.
 * - AC9 a failed job renders the server `error_message` with the
 *   Support_Reference.
 * - AC10 the reports stay usable while an export polls.
 */

import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { i18n as I18nextInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiClient, ApiSuccess } from '../../api/client'
import { clearFailedSupportReference } from '../../errors/supportReferenceStore'
import { createI18n } from '../../i18n'
import { AppServicesContext, type AppServices } from '../../shell/appServices'

import type { ExportJob } from './exportPolling'
import { ReportsScreen } from './ReportsScreen'
import type { ActivityReport, CandidateProgressPage } from './reportsApi'

// ── Harness ───────────────────────────────────────────────────────────────────

let i18n: I18nextInstance

/**
 * jsdom implements no `scrollIntoView`, and Mantine's `Combobox` calls it on the
 * active option from a timer after a selection — which lands as an unhandled
 * error once the test that made the selection has already finished. Stubbed here
 * rather than in the shared setup because this is the only suite in the slice that
 * opens a dropdown.
 */
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    writable: true,
    configurable: true,
    value: () => undefined,
  })
}

beforeEach(() => {
  i18n = createI18n('en')
  clearFailedSupportReference()
})

afterEach(() => {
  vi.useRealTimers()
})

/** One recorded request: what the screen asked for, and with what. */
interface RecordedRequest {
  readonly method: string
  readonly path: string
  readonly query: Record<string, unknown> | undefined
  readonly pathParams: Record<string, unknown> | undefined
  readonly body: unknown
}

const ACTIVITY: ActivityReport = {
  applications_closed: 1,
  applications_forwarded: 2,
  applications_submitted: 3,
  applications_under_review: 4,
  candidates_approved: 5,
  candidates_registered: 6,
  candidates_rejected: 7,
  cv_versions_uploaded: 8,
  period_from: '2024-04-01T00:00:00Z',
  period_to: '2024-04-30T23:59:59Z',
}

const PROGRESS: CandidateProgressPage = {
  has_next: true,
  next_cursor: 'acc-20',
  rows: [
    {
      account_id: 'acc-1',
      account_status: 'Approved',
      created_at: '2024-04-01T08:00:00Z',
      email: 'candidate@example.test',
      applications: [
        {
          application_id: 'app-1',
          jd_id: 'jd-1',
          jd_title: 'Platform engineer',
          status: 'Under Review',
          submitted_at: '2024-04-02T08:00:00Z',
        },
      ],
    },
  ],
}

function jobFixture(overrides: Partial<ExportJob> = {}): ExportJob {
  return {
    created_at: '2024-04-01T08:00:00Z',
    download_url: null,
    entity_type: 'candidates',
    error_message: null,
    expires_at: null,
    job_id: 'job-1',
    status: 'pending',
    ...overrides,
  }
}

/**
 * An Api_Client answering both reports from fixtures and the export endpoints
 * from a queue: the first entry answers the enqueue, and each later poll takes
 * the next one, holding on the last.
 */
function apiAnswering(
  options: {
    readonly activity?: ActivityReport
    readonly progress?: CandidateProgressPage
    readonly exports?: readonly ExportJob[]
    readonly supportReference?: string
    /**
     * The Support_Reference of each poll answer, in poll order — the *n*th entry
     * answers the *n*th poll — holding on the last.
     *
     * AC9 asks for the reference of the response that *reported the failure*, so a
     * poll has to be able to answer with a different one from the enqueue and from
     * the two reports — otherwise "the right reference" cannot be told apart from
     * "the only reference".
     */
    readonly pollSupportReferences?: readonly string[]
  } = {},
) {
  const requests: RecordedRequest[] = []
  const exports = options.exports ?? [jobFixture()]
  let polls = 0

  const request = vi.fn((method: string, path: string, init?: unknown) => {
    const typed = init as
      | { params?: { query?: Record<string, unknown>; path?: Record<string, unknown> }; body?: unknown }
      | undefined
    requests.push({
      method,
      path,
      query: typed?.params?.query,
      pathParams: typed?.params?.path,
      body: typed?.body,
    })

    const answer = (data: unknown, reference?: string): Promise<ApiSuccess<unknown>> =>
      Promise.resolve({
        data,
        response: new Response(null, { status: 200 }),
        supportReference: reference ?? options.supportReference ?? 'req-1',
      })

    if (path === '/api/v1/admin/reports/activity') {
      return answer(options.activity ?? ACTIVITY)
    }
    if (path === '/api/v1/admin/reports/candidate-progress') {
      return answer(options.progress ?? PROGRESS)
    }
    if (path === '/api/v1/admin/exports/{entity_type}') {
      return answer(exports[0])
    }
    polls += 1
    const references = options.pollSupportReferences
    return answer(
      exports[Math.min(polls, exports.length - 1)],
      references === undefined
        ? undefined
        : references[Math.min(polls - 1, references.length - 1)],
    )
  })

  const api: ApiClient = {
    request: request as unknown as ApiClient['request'],
    exchangeRefreshToken: () => Promise.reject(new Error('not used')),
    revokeSession: () => Promise.resolve(),
  }
  return { api, requests }
}

function requestsTo(requests: readonly RecordedRequest[], path: string): RecordedRequest[] {
  return requests.filter((entry) => entry.path === path)
}

function renderScreen(api: ApiClient, location = '/admin/reports') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const services: AppServices = { api, queryClient, clearServerState: () => undefined }

  return render(
    <MantineProvider>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <AppServicesContext.Provider value={services}>
            <MemoryRouter initialEntries={[location]}>
              <Routes>
                <Route path="/admin/reports" element={<ReportsScreen />} />
              </Routes>
            </MemoryRouter>
          </AppServicesContext.Provider>
        </QueryClientProvider>
      </I18nextProvider>
    </MantineProvider>,
  )
}

// ── AC1, AC2 ──────────────────────────────────────────────────────────────────

describe('the activity report (Req 18 AC1, AC2)', () => {
  it('renders every returned metric and the period it covers', async () => {
    const { api } = apiAnswering()
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('activity-report')).toBeInTheDocument()
    })

    expect(screen.getByTestId('activity-metric-value-candidates_registered')).toHaveTextContent('6')
    expect(screen.getByTestId('activity-metric-value-candidates_approved')).toHaveTextContent('5')
    expect(screen.getByTestId('activity-metric-value-candidates_rejected')).toHaveTextContent('7')
    expect(screen.getByTestId('activity-metric-value-cv_versions_uploaded')).toHaveTextContent('8')
    expect(screen.getByTestId('activity-metric-value-applications_submitted')).toHaveTextContent('3')
    expect(screen.getByTestId('activity-metric-value-applications_under_review')).toHaveTextContent(
      '4',
    )
    expect(screen.getByTestId('activity-metric-value-applications_forwarded')).toHaveTextContent('2')
    expect(screen.getByTestId('activity-metric-value-applications_closed')).toHaveTextContent('1')
    expect(screen.getByTestId('activity-period')).toHaveTextContent('2024')
  })

  it('sends the applied date range and Job_Description as query parameters', async () => {
    const { api, requests } = apiAnswering()
    renderScreen(api, '/admin/reports?date_from=2024-04-01&date_to=2024-04-30&jd_id=jd-1')

    await waitFor(() => {
      expect(screen.getByTestId('activity-report')).toBeInTheDocument()
    })

    expect(requestsTo(requests, '/api/v1/admin/reports/activity')[0]?.query).toEqual({
      date_from: '2024-04-01T00:00:00.000Z',
      date_to: '2024-04-30T23:59:59.999Z',
      jd_id: 'jd-1',
    })
    // The values stay on the controls, ready to be narrowed further.
    expect(screen.getByTestId('report-filter-date-from')).toHaveValue('2024-04-01')
    expect(screen.getByTestId('report-filter-jd-id')).toHaveValue('jd-1')
  })

  it('applies an edited filter as a query parameter of the next request', async () => {
    const user = userEvent.setup()
    const { api, requests } = apiAnswering()
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('activity-report')).toBeInTheDocument()
    })

    await user.type(screen.getByTestId('report-filter-jd-id'), 'jd-9')
    await user.click(screen.getByTestId('report-filters-apply'))

    await waitFor(() => {
      const activity = requestsTo(requests, '/api/v1/admin/reports/activity')
      expect(activity[activity.length - 1]?.query).toEqual({ jd_id: 'jd-9' })
    })
  })
})

// ── AC3, AC4, AC5 ─────────────────────────────────────────────────────────────

describe('the candidate-progress report (Req 18 AC3, AC4, AC5)', () => {
  it('renders the four row fields and requests at most 20 rows', async () => {
    const { api, requests } = apiAnswering()
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('progress-row-acc-1')).toBeInTheDocument()
    })

    expect(screen.getByTestId('progress-email-acc-1')).toHaveTextContent('candidate@example.test')
    expect(screen.getByTestId('progress-status-acc-1')).toHaveTextContent('Approved')
    expect(screen.getByTestId('progress-created-at-acc-1')).toHaveTextContent('2024')
    expect(screen.getByTestId('progress-application-status-app-1')).toHaveTextContent('Under review')

    expect(requestsTo(requests, '/api/v1/admin/reports/candidate-progress')[0]?.query).toEqual({
      limit: 20,
    })
  })

  it('sends the advertised next_cursor as after_id', async () => {
    const user = userEvent.setup()
    const { api, requests } = apiAnswering()
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('progress-next-page')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('progress-next-page'))

    await waitFor(() => {
      const pages = requestsTo(requests, '/api/v1/admin/reports/candidate-progress')
      expect(pages[pages.length - 1]?.query).toEqual({ limit: 20, after_id: 'acc-20' })
    })
  })

  it('presents no next-page control when no further page is advertised', async () => {
    const { api } = apiAnswering({
      progress: { ...PROGRESS, has_next: false, next_cursor: null },
    })
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('candidate-progress-table')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('progress-next-page')).toBeNull()
  })

  it('carries a drill-down control to the account, the job description and the application', async () => {
    const { api } = apiAnswering()
    renderScreen(api)

    await waitFor(() => {
      expect(screen.getByTestId('progress-row-acc-1')).toBeInTheDocument()
    })

    expect(screen.getByTestId('progress-account-link-acc-1')).toHaveAttribute(
      'href',
      '/admin/candidates/acc-1',
    )
    expect(screen.getByTestId('progress-jd-link-app-1')).toHaveAttribute('href', '/admin/jobs/jd-1')
    expect(screen.getByTestId('progress-application-link-app-1')).toHaveAttribute(
      'href',
      '/admin/applications?application_id=app-1',
    )
  })
})

// ── AC6, AC7, AC8, AC10 ───────────────────────────────────────────────────────

describe('the export lifecycle (Req 18 AC6, AC7, AC8, AC10)', () => {
  it('posts to the entity path with the applied filters and polls to readiness', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { api, requests } = apiAnswering({
      exports: [
        jobFixture({ status: 'running' }),
        jobFixture({
          status: 'ready',
          download_url: 'https://files.example.test/export.xlsx',
          expires_at: '2024-04-01T09:00:00Z',
        }),
      ],
    })
    renderScreen(api, '/admin/reports?date_from=2024-04-01&jd_id=jd-1')

    await user.click(screen.getByTestId('export-request'))

    // AC6: the entity in the path, the applied filters in the body.
    await waitFor(() => {
      expect(requestsTo(requests, '/api/v1/admin/exports/{entity_type}')).toHaveLength(1)
    })
    const enqueue = requestsTo(requests, '/api/v1/admin/exports/{entity_type}')[0]
    expect(enqueue?.pathParams).toEqual({ entity_type: 'candidates' })
    expect(enqueue?.body).toEqual({ date_from: '2024-04-01T00:00:00.000Z', jd_id: 'jd-1' })

    // AC10: the progress indicator is up and both reports are still on screen.
    await waitFor(() => {
      expect(screen.getByTestId('export-polling')).toBeInTheDocument()
    })
    expect(screen.getByTestId('activity-report')).toBeInTheDocument()
    expect(screen.getByTestId('candidate-progress-table')).toBeInTheDocument()

    // AC7: one interval is enough for the next poll to land.
    await vi.advanceTimersByTimeAsync(5_000)

    // AC8: the download control and the expiry.
    await waitFor(() => {
      expect(screen.getByTestId('export-download')).toHaveAttribute(
        'href',
        'https://files.example.test/export.xlsx',
      )
    })
    expect(screen.getByTestId('export-expires-at')).toHaveTextContent('2024')
    expect(screen.queryByTestId('export-polling')).toBeNull()

    // AC7: a terminal status ends the poll — no further request is issued.
    const pollsSoFar = requestsTo(requests, '/api/v1/admin/exports/{job_id}').length
    await vi.advanceTimersByTimeAsync(15_000)
    expect(requestsTo(requests, '/api/v1/admin/exports/{job_id}')).toHaveLength(pollsSoFar)
  })

  it('stops polling when the user dismisses the export', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { api, requests } = apiAnswering({ exports: [jobFixture({ status: 'running' })] })
    renderScreen(api)

    await user.click(screen.getByTestId('export-request'))
    await waitFor(() => {
      expect(screen.getByTestId('export-polling')).toBeInTheDocument()
    })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(requestsTo(requests, '/api/v1/admin/exports/{job_id}').length).toBeGreaterThan(0)

    await user.click(screen.getByTestId('export-dismiss'))
    await waitFor(() => {
      expect(screen.queryByTestId('export-polling')).toBeNull()
    })

    const pollsAtDismissal = requestsTo(requests, '/api/v1/admin/exports/{job_id}').length
    await vi.advanceTimersByTimeAsync(20_000)
    expect(requestsTo(requests, '/api/v1/admin/exports/{job_id}')).toHaveLength(pollsAtDismissal)
  })

  it('exports the chosen entity type', async () => {
    const user = userEvent.setup()
    const { api, requests } = apiAnswering()
    renderScreen(api)

    await user.click(screen.getByTestId('export-entity-type'))
    await user.click(screen.getByText('Job descriptions'))
    await user.click(screen.getByTestId('export-request'))

    await waitFor(() => {
      expect(requestsTo(requests, '/api/v1/admin/exports/{entity_type}')[0]?.pathParams).toEqual({
        entity_type: 'job_descriptions',
      })
    })
  })
})

// ── AC7 ───────────────────────────────────────────────────────────────────────

describe('the cadence of the export poll (Req 18 AC7, AC10)', () => {
  it('issues one poll per five-second interval while the status is non-terminal', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { api, requests } = apiAnswering({
      exports: [
        jobFixture({ status: 'pending' }),
        jobFixture({ status: 'running' }),
        jobFixture({ status: 'running' }),
      ],
    })
    renderScreen(api)

    await user.click(screen.getByTestId('export-request'))
    await waitFor(() => {
      expect(screen.getByTestId('export-polling')).toBeInTheDocument()
    })

    // The 202 seeded the poll's cache entry, so the status it reported has not been
    // re-read: the indicator is up before any `GET` has left.
    expect(requestsTo(requests, '/api/v1/admin/exports/{job_id}')).toHaveLength(0)
    expect(screen.getByTestId('export-status')).toHaveTextContent('Queued')

    // AC7: one interval is enough for the first poll, which is what "at most 5
    // seconds" means from the screen's side.
    await vi.advanceTimersByTimeAsync(5_000)
    await waitFor(() => {
      expect(requestsTo(requests, '/api/v1/admin/exports/{job_id}')).toHaveLength(1)
    })
    expect(requestsTo(requests, '/api/v1/admin/exports/{job_id}')[0]?.pathParams).toEqual({
      job_id: 'job-1',
    })
    // AC10: the indicator names what the poll last reported.
    await waitFor(() => {
      expect(screen.getByTestId('export-status')).toHaveTextContent('Being produced')
    })

    // Still non-terminal, so the next interval issues the next poll — one per
    // interval, not a burst.
    await vi.advanceTimersByTimeAsync(5_000)
    await waitFor(() => {
      expect(requestsTo(requests, '/api/v1/admin/exports/{job_id}')).toHaveLength(2)
    })
    expect(screen.getByTestId('export-polling')).toBeInTheDocument()
    expect(screen.queryByTestId('export-ready')).toBeNull()
    expect(screen.queryByTestId('export-failed')).toBeNull()
  })

  it('stops at the first terminal status, however the server would answer next', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { api, requests } = apiAnswering({
      exports: [
        jobFixture({ status: 'running' }),
        jobFixture({
          status: 'ready',
          download_url: 'https://files.example.test/export.xlsx',
          expires_at: '2024-04-01T09:00:00Z',
        }),
        // Handed out by a second poll. No second poll is issued, so this answer
        // never reaches the screen — which is what tells a stopped poll apart from
        // a poll whose answers happen to repeat.
        jobFixture({ status: 'failed', error_message: 'never read' }),
      ],
    })
    renderScreen(api)

    await user.click(screen.getByTestId('export-request'))
    await vi.advanceTimersByTimeAsync(5_000)
    await waitFor(() => {
      expect(screen.getByTestId('export-ready')).toBeInTheDocument()
    })
    expect(requestsTo(requests, '/api/v1/admin/exports/{job_id}')).toHaveLength(1)

    // AC7: far past several intervals, the count has not grown.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(requestsTo(requests, '/api/v1/admin/exports/{job_id}')).toHaveLength(1)
    expect(screen.queryByTestId('export-failed')).toBeNull()
    expect(screen.getByTestId('export-download')).toBeInTheDocument()
  })
})

// ── AC8 ───────────────────────────────────────────────────────────────────────

describe('a ready export (Req 18 AC8)', () => {
  it('opens the download safely and states that no expiry was reported', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { api } = apiAnswering({
      exports: [
        jobFixture({ status: 'running' }),
        jobFixture({ status: 'ready', download_url: 'https://files.example.test/export.xlsx' }),
      ],
    })
    renderScreen(api)

    await user.click(screen.getByTestId('export-request'))
    await vi.advanceTimersByTimeAsync(5_000)

    await waitFor(() => {
      expect(screen.getByTestId('export-download')).toBeInTheDocument()
    })
    const download = screen.getByTestId('export-download')
    expect(download).toHaveAttribute('href', 'https://files.example.test/export.xlsx')
    // A cross-origin object-storage URL, so the new tab gets no handle on this one.
    expect(download).toHaveAttribute('target', '_blank')
    expect(download).toHaveAttribute('rel', 'noopener noreferrer')
    expect(download).toHaveAccessibleName('Download the Candidates export')

    // AC8: the job reported no `expires_at`, and the panel says so rather than
    // rendering a blank line where the expiry would be.
    expect(screen.getByTestId('export-expires-at')).toHaveTextContent('reports no expiry')
    // A Support_Reference belongs to a failure, not to a success (Req 23 AC4).
    expect(screen.queryByTestId('support-reference')).toBeNull()
  })

  it('offers a re-read rather than a download when a ready job reports no usable link', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { api, requests } = apiAnswering({
      exports: [
        jobFixture({ status: 'running' }),
        jobFixture({ status: 'ready' }),
        jobFixture({
          status: 'ready',
          download_url: 'https://files.example.test/export.xlsx',
          expires_at: '2024-04-01T09:00:00Z',
        }),
      ],
    })
    renderScreen(api)

    await user.click(screen.getByTestId('export-request'))
    await vi.advanceTimersByTimeAsync(5_000)

    // Ready, but with nothing to open: neither a download control nor a wait.
    await waitFor(() => {
      expect(screen.getByTestId('export-ready-without-url')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('export-download')).toBeNull()
    expect(screen.queryByTestId('export-polling')).toBeNull()

    const pollsBefore = requestsTo(requests, '/api/v1/admin/exports/{job_id}').length
    await user.click(screen.getByTestId('export-recheck'))

    // AC8: the re-read is a poll of the same job, and the URL it brings back is
    // what the download control opens.
    await waitFor(() => {
      expect(screen.getByTestId('export-download')).toHaveAttribute(
        'href',
        'https://files.example.test/export.xlsx',
      )
    })
    expect(requestsTo(requests, '/api/v1/admin/exports/{job_id}')).toHaveLength(pollsBefore + 1)
    expect(screen.getByTestId('export-expires-at')).toHaveTextContent('2024')
    expect(screen.queryByTestId('export-ready-without-url')).toBeNull()
  })
})

// ── AC9 ───────────────────────────────────────────────────────────────────────

describe('a failed export (Req 18 AC9)', () => {
  it('renders the server error_message together with the Support_Reference', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { api } = apiAnswering({
      // Every other response carries a different reference, so the rendered one
      // can only be right by being the failing response's.
      supportReference: 'req-reports',
      pollSupportReferences: ['req-poll-running', 'req-export-9'],
      exports: [
        jobFixture({ status: 'pending' }),
        jobFixture({ status: 'running' }),
        jobFixture({ status: 'failed', error_message: 'The worker ran out of memory' }),
      ],
    })
    renderScreen(api)

    await user.click(screen.getByTestId('export-request'))
    // Two intervals: the first poll still reports `running` and carries its own
    // reference, the second reports the failure and carries the one AC9 asks for.
    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(5_000)

    await waitFor(() => {
      expect(screen.getByTestId('export-failed')).toBeInTheDocument()
    })
    expect(screen.getByTestId('export-error-message')).toHaveTextContent(
      'The worker ran out of memory',
    )
    expect(screen.getByTestId('support-reference-value')).toHaveTextContent('req-export-9')
    // The failure arrived as a 200 whose body reports it, not as an Error_Envelope,
    // so the generic error surface has nothing to say here.
    expect(screen.queryByTestId('error-state')).toBeNull()
    // A terminal status, so the progress indicator is gone.
    expect(screen.queryByTestId('export-polling')).toBeNull()
  })

  it('renders the server message verbatim and isolated for direction', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    // Backend_Api text carries its own direction regardless of the active Locale
    // (Req 19 AC10), so an Arabic message under an English interface is the case
    // that matters.
    const arabic = 'تعذّر إنتاج الملف: نفدت الذاكرة'
    const { api } = apiAnswering({
      exports: [
        jobFixture({ status: 'running' }),
        jobFixture({ status: 'failed', error_message: arabic }),
      ],
    })
    renderScreen(api)

    await user.click(screen.getByTestId('export-request'))
    await vi.advanceTimersByTimeAsync(5_000)

    await waitFor(() => {
      expect(screen.getByTestId('export-failed')).toBeInTheDocument()
    })
    const isolated = screen.getByTestId('export-error-message').querySelector('span[dir="auto"]')
    expect(isolated?.textContent).toBe(arabic)
    expect(isolated?.className).toContain('bidi-isolate')
  })

  it('stops the poll and offers no download once the failure is reported', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { api, requests } = apiAnswering({
      exports: [
        jobFixture({ status: 'running' }),
        jobFixture({ status: 'failed', error_message: 'The worker ran out of memory' }),
        // A later answer that would offer a download. No further poll asks for it.
        jobFixture({ status: 'ready', download_url: 'https://files.example.test/export.xlsx' }),
      ],
    })
    renderScreen(api)

    await user.click(screen.getByTestId('export-request'))
    await vi.advanceTimersByTimeAsync(5_000)
    await waitFor(() => {
      expect(screen.getByTestId('export-failed')).toBeInTheDocument()
    })

    // AC7: `failed` is terminal too, so the count stops growing here as well.
    expect(requestsTo(requests, '/api/v1/admin/exports/{job_id}')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(requestsTo(requests, '/api/v1/admin/exports/{job_id}')).toHaveLength(1)
    expect(screen.queryByTestId('export-download')).toBeNull()
    expect(screen.queryByTestId('export-ready')).toBeNull()
  })

  it('states the failure in its own words when the job named no message', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { api } = apiAnswering({
      exports: [jobFixture({ status: 'running' }), jobFixture({ status: 'failed' })],
    })
    renderScreen(api)

    await user.click(screen.getByTestId('export-request'))
    await vi.advanceTimersByTimeAsync(5_000)

    await waitFor(() => {
      expect(screen.getByTestId('export-error-message')).toHaveTextContent('reported no reason')
    })
  })
})

// ── AC10 ──────────────────────────────────────────────────────────────────────

describe('the reports while an export polls (Req 18 AC10)', () => {
  /** Starts an export that stays `running`, so the poll is live for the whole test. */
  async function startRunningExport(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByTestId('export-request'))
    await waitFor(() => {
      expect(screen.getByTestId('export-polling')).toBeInTheDocument()
    })
    await vi.advanceTimersByTimeAsync(5_000)
  }

  it('walks to the next candidate-progress page without interrupting the poll', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { api, requests } = apiAnswering({ exports: [jobFixture({ status: 'running' })] })
    renderScreen(api)

    await startRunningExport(user)
    const pollsBefore = requestsTo(requests, '/api/v1/admin/exports/{job_id}').length
    expect(pollsBefore).toBeGreaterThan(0)

    await user.click(screen.getByTestId('progress-next-page'))

    // The report answered while the export was polling: the poll is a background
    // cache entry, not a wait the screen sits behind.
    await waitFor(() => {
      const pages = requestsTo(requests, '/api/v1/admin/reports/candidate-progress')
      expect(pages[pages.length - 1]?.query).toEqual({ limit: 20, after_id: 'acc-20' })
    })
    await waitFor(() => {
      expect(screen.getByTestId('progress-row-acc-1')).toBeInTheDocument()
    })
    expect(screen.getByTestId('export-polling')).toBeInTheDocument()

    // And the poll survived the page walk: the next interval still lands.
    await vi.advanceTimersByTimeAsync(5_000)
    await waitFor(() => {
      expect(
        requestsTo(requests, '/api/v1/admin/exports/{job_id}').length,
      ).toBeGreaterThan(pollsBefore)
    })
  })

  it('applies a new filter to the activity report without interrupting the poll', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { api, requests } = apiAnswering({ exports: [jobFixture({ status: 'running' })] })
    renderScreen(api)

    await startRunningExport(user)
    const pollsBefore = requestsTo(requests, '/api/v1/admin/exports/{job_id}').length

    await user.type(screen.getByTestId('report-filter-jd-id'), 'jd-9')
    await user.click(screen.getByTestId('report-filters-apply'))

    await waitFor(() => {
      const activity = requestsTo(requests, '/api/v1/admin/reports/activity')
      expect(activity[activity.length - 1]?.query).toEqual({ jd_id: 'jd-9' })
    })
    expect(screen.getByTestId('activity-report')).toBeInTheDocument()
    expect(screen.getByTestId('export-polling')).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(5_000)
    await waitFor(() => {
      expect(
        requestsTo(requests, '/api/v1/admin/exports/{job_id}').length,
      ).toBeGreaterThan(pollsBefore)
    })
  })
})
