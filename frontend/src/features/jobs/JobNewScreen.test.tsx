/**
 * Component tests for the Job_Description creation screen (task 19.2).
 *
 * Requirement 13:
 * - AC5 the extraction draft is polled at an interval of at most 5 seconds while the
 *   reported `status` is `pending`, and the poll stops on the first terminal status.
 * - AC7 every reported skill candidate is presented for explicit confirmation or
 *   replacement, and submission is blocked until each one has been decided.
 * - AC10 no Job_Description persistence request is issued for an extraction draft
 *   before the user confirms.
 *
 * The pure rules behind all three — `extractionPollInterval`, `decideSkillCandidate`,
 * `canConfirmExtraction` — already have their own unit tests in `extraction.test.ts`.
 * What is asserted here is the wiring those tests cannot see: that the poll is driven
 * off a real timer, that the gate actually reaches the submit control, and that a
 * blocked control issues nothing.
 *
 * Time is controlled with `vi.useFakeTimers()`, so "at most 5 seconds" is asserted by
 * advancing exactly one interval and counting the requests that resulted, rather than
 * by waiting on a real clock.
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
import { createI18n } from '../../i18n'
import { SessionContext, type SessionContextValue } from '../../session/sessionState'
import { AppServicesContext, type AppServices } from '../../shell/appServices'

import {
  EXTRACT_CONFIRM_PATH,
  EXTRACT_DRAFT_PATH,
  EXTRACT_TEXT_PATH,
  JOBS_PATH,
} from './authoringApi'
import type { ExtractionDraftDTO } from './extraction'
import { JobNewScreen } from './JobNewScreen'
import type { JobDescription } from './jobsApi'

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Enough text to satisfy the `POST /jobs/extract:text` bounds of AC4. */
const POSTING_TEXT = 'Platform engineer at HasoubLabs'

/** The values a ready draft pre-populates the form with (AC6). */
const EXTRACTED_FIELDS: Record<string, unknown> = {
  title: 'Platform engineer',
  company: 'HasoubLabs',
  location: 'Haifa',
  work_model: 'Hybrid',
  employment_type: 'Full-time',
  experience_level: 'Mid-level',
  description: 'Build the platform.',
}

function draftFixture(overrides: Partial<ExtractionDraftDTO> = {}): ExtractionDraftDTO {
  return {
    created_at: '2024-04-01T08:00:00Z',
    expires_at: '2024-04-01T09:00:00Z',
    extracted_fields: {},
    id: 'draft-1',
    skill_candidates: [],
    source: 'text',
    status: 'pending',
    ...overrides,
  }
}

/** A `ready` draft proposing three candidate skills (AC6, AC7). */
function readyDraft(): ExtractionDraftDTO {
  return draftFixture({
    status: 'ready',
    extracted_fields: EXTRACTED_FIELDS,
    skill_candidates: [
      { term: 'TypeScript', confidence: 0.9 },
      { term: 'Postgres' },
      { term: 'Fax machines', confidence: 0.1 },
    ],
  })
}

function createdJob(): JobDescription {
  return {
    application_channel: null,
    closed_at: null,
    company: 'HasoubLabs',
    created_at: '2024-04-01T08:00:00Z',
    creator_account_id: 'acc-1',
    description: 'Build the platform.',
    employment_type: 'Full-time',
    experience_level: 'Mid-level',
    external_url: null,
    id: 'jd-new',
    location: 'Haifa',
    published_at: null,
    required_skill_ids: [],
    status: 'Draft',
    title: 'Platform engineer',
    updated_at: '2024-04-01T08:00:00Z',
    work_model: 'Hybrid',
  }
}

// ── Harness ───────────────────────────────────────────────────────────────────

let i18n: I18nextInstance

beforeEach(() => {
  i18n = createI18n('en')
})

afterEach(() => {
  vi.useRealTimers()
})

/** One recorded request: what the screen asked for, and with what. */
interface RecordedRequest {
  readonly method: string
  readonly path: string
  readonly pathParams: Record<string, unknown> | undefined
  readonly body: unknown
}

/**
 * An Api_Client answering the extraction endpoints.
 *
 * `POST /jobs/extract:text` answers the 202 with `start`, and each later poll takes
 * the next entry of `polls`, holding on the last — so a queue of
 * `[pending, ready]` models a worker that finishes between the first and the
 * second poll.
 */
function apiAnswering(options: {
  readonly start?: ExtractionDraftDTO
  readonly polls: readonly ExtractionDraftDTO[]
}) {
  const requests: RecordedRequest[] = []
  let polls = 0

  const request = vi.fn((method: string, path: string, init?: unknown) => {
    const typed = init as
      | { params?: { path?: Record<string, unknown> }; body?: unknown }
      | undefined
    requests.push({ method, path, pathParams: typed?.params?.path, body: typed?.body })

    const answer = (data: unknown): Promise<ApiSuccess<unknown>> =>
      Promise.resolve({
        data,
        response: new Response(null, { status: 200 }),
        supportReference: 'req-ok',
      })

    if (path === EXTRACT_TEXT_PATH) {
      return answer(options.start ?? draftFixture())
    }
    if (path === EXTRACT_DRAFT_PATH) {
      const answered = options.polls[Math.min(polls, options.polls.length - 1)]
      polls += 1
      return answer(answered ?? draftFixture())
    }
    return answer(createdJob())
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
              <MemoryRouter initialEntries={['/senior/jobs/new']}>
                <Routes>
                  <Route path="/senior/jobs/new" element={<JobNewScreen />} />
                  {/* Where a created Job_Description lands (AC2, AC9). */}
                  <Route
                    path="/senior/jobs/:jdId"
                    element={<div data-testid="authoring-landing" />}
                  />
                </Routes>
              </MemoryRouter>
            </SessionContext.Provider>
          </AppServicesContext.Provider>
        </QueryClientProvider>
      </I18nextProvider>
    </MantineProvider>,
  )
}

/** Starts a text extraction and returns the user-event instance that did it. */
async function startExtraction(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByTestId('job-extract-text'), POSTING_TEXT)
  await user.click(screen.getByTestId('job-extract-text-submit'))
  // The 202 seeds the poll's cache entry, so the pending state is on screen at once.
  await waitFor(() => {
    expect(screen.getByTestId('job-extract-pending')).toBeInTheDocument()
  })
}

// ── AC5 ───────────────────────────────────────────────────────────────────────

describe('polling an extraction draft (Req 13 AC5)', () => {
  it('polls within five seconds while pending and stops on the first terminal status', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { api, requests } = apiAnswering({
      polls: [draftFixture(), readyDraft()],
    })
    renderScreen(api)

    await startExtraction(user)

    // The 202 already reported the status, so no poll has been issued for it yet.
    expect(requestsTo(requests, EXTRACT_DRAFT_PATH)).toHaveLength(0)

    // One interval is enough for the first poll: the interval is at most 5 seconds.
    await vi.advanceTimersByTimeAsync(5_000)
    await waitFor(() => {
      expect(requestsTo(requests, EXTRACT_DRAFT_PATH)).toHaveLength(1)
    })
    expect(requestsTo(requests, EXTRACT_DRAFT_PATH)[0]?.pathParams).toEqual({
      draft_id: 'draft-1',
    })
    // Still pending, so the poll is still running.
    expect(screen.getByTestId('job-extract-pending')).toBeInTheDocument()

    // The second poll reports `ready`, which is terminal.
    await vi.advanceTimersByTimeAsync(5_000)
    await waitFor(() => {
      expect(screen.getByTestId('job-extract-ready')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('job-extract-pending')).toBeNull()

    // AC5: no request is issued after the status left `pending`.
    const pollsAtTerminal = requestsTo(requests, EXTRACT_DRAFT_PATH).length
    expect(pollsAtTerminal).toBe(2)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(requestsTo(requests, EXTRACT_DRAFT_PATH)).toHaveLength(pollsAtTerminal)
  })

  it('stops polling when the user discards the extraction', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { api, requests } = apiAnswering({ polls: [draftFixture()] })
    renderScreen(api)

    await startExtraction(user)
    await vi.advanceTimersByTimeAsync(5_000)
    await waitFor(() => {
      expect(requestsTo(requests, EXTRACT_DRAFT_PATH).length).toBeGreaterThan(0)
    })

    await user.click(screen.getByTestId('job-extract-discard'))
    await waitFor(() => {
      expect(screen.queryByTestId('job-extract-pending')).toBeNull()
    })

    const pollsAtDiscard = requestsTo(requests, EXTRACT_DRAFT_PATH).length
    await vi.advanceTimersByTimeAsync(20_000)
    expect(requestsTo(requests, EXTRACT_DRAFT_PATH)).toHaveLength(pollsAtDiscard)
  })
})

// ── AC7, AC10 ─────────────────────────────────────────────────────────────────

describe('the skill-candidate confirmation gate (Req 13 AC7, AC10)', () => {
  /** Brings the screen to a `ready` draft with three undecided candidates. */
  async function reachReadyDraft(user: ReturnType<typeof userEvent.setup>) {
    await startExtraction(user)
    await vi.advanceTimersByTimeAsync(5_000)
    await waitFor(() => {
      expect(screen.getByTestId('job-skill-candidates')).toBeInTheDocument()
    })
  }

  it('blocks submission while a candidate is undecided and issues no persistence request', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { api, requests } = apiAnswering({ polls: [readyDraft()] })
    renderScreen(api)

    await reachReadyDraft(user)

    // AC7: every reported candidate is presented, each one undecided.
    expect(screen.getByTestId('job-skill-candidate-0')).toHaveTextContent('TypeScript')
    expect(screen.getByTestId('job-skill-candidate-1')).toHaveTextContent('Postgres')
    expect(screen.getByTestId('job-skill-candidate-2')).toHaveTextContent('Fax machines')
    expect(screen.getByTestId('job-skill-candidates-undecided')).toHaveAttribute(
      'data-undecided',
      '3',
    )
    expect(screen.getByTestId('job-skill-candidate-state-0')).toHaveAttribute(
      'data-decision',
      'pending',
    )

    // AC7: the submit control is disabled, and says why.
    const submit = screen.getByTestId('job-form-submit')
    expect(submit).toBeDisabled()
    expect(submit).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('job-form-blocked')).toHaveTextContent(
      'Confirm or replace every suggested skill before creating this job description.',
    )
    expect(submit.getAttribute('aria-describedby')).toBe(
      screen.getByTestId('job-form-blocked').id,
    )

    // A partial set of decisions still blocks.
    await user.click(screen.getByTestId('job-skill-candidate-0-confirmed'))
    expect(screen.getByTestId('job-skill-candidates-undecided')).toHaveAttribute(
      'data-undecided',
      '2',
    )
    expect(screen.getByTestId('job-form-submit')).toBeDisabled()

    // AC10: nothing has been persisted — not a creation, not a confirmation.
    await user.click(screen.getByTestId('job-form-submit'))
    expect(requestsTo(requests, JOBS_PATH)).toHaveLength(0)
    expect(requestsTo(requests, EXTRACT_CONFIRM_PATH)).toHaveLength(0)
  })

  it('confirms the draft once every candidate is decided', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { api, requests } = apiAnswering({ polls: [readyDraft()] })
    renderScreen(api)

    await reachReadyDraft(user)

    // The three decisions AC7 admits: keep it, replace it, drop it.
    await user.click(screen.getByTestId('job-skill-candidate-0-confirmed'))
    await user.click(screen.getByTestId('job-skill-candidate-1-replaced'))
    const replacement = screen.getByTestId('job-skill-candidate-1-replacement')
    await user.clear(replacement)
    // A replacement with nothing typed yet is not a decision.
    expect(screen.getByTestId('job-form-submit')).toBeDisabled()
    await user.type(replacement, 'PostgreSQL')
    await user.click(screen.getByTestId('job-skill-candidate-2-discarded'))

    await waitFor(() => {
      expect(screen.getByTestId('job-skill-candidates-undecided')).toHaveAttribute(
        'data-undecided',
        '0',
      )
    })
    expect(screen.getByTestId('job-form-submit')).toBeEnabled()
    expect(screen.queryByTestId('job-form-blocked')).toBeNull()

    await user.click(screen.getByTestId('job-form-submit'))

    // AC9: the confirmation is addressed to the polled draft and carries the
    // pre-populated values together with the kept and substituted terms.
    await waitFor(() => {
      expect(requestsTo(requests, EXTRACT_CONFIRM_PATH)).toHaveLength(1)
    })
    const confirmation = requestsTo(requests, EXTRACT_CONFIRM_PATH)[0]
    expect(confirmation?.pathParams).toEqual({ draft_id: 'draft-1' })
    expect(confirmation?.body).toEqual({
      title: 'Platform engineer',
      company: 'HasoubLabs',
      location: 'Haifa',
      work_model: 'Hybrid',
      employment_type: 'Full-time',
      experience_level: 'Mid-level',
      description: 'Build the platform.',
      application_channel: null,
      external_url: null,
      // The dropped candidate contributes nothing.
      required_skill_terms: ['TypeScript', 'PostgreSQL'],
    })
    // AC10: confirming is the *only* persistence request that was issued.
    expect(requestsTo(requests, JOBS_PATH)).toHaveLength(0)

    await waitFor(() => {
      expect(screen.getByTestId('authoring-landing')).toBeInTheDocument()
    })
  })

  it('leaves the control enabled for a ready draft that proposed no candidate', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { api } = apiAnswering({
      polls: [draftFixture({ status: 'ready', extracted_fields: EXTRACTED_FIELDS })],
    })
    renderScreen(api)

    await startExtraction(user)
    await vi.advanceTimersByTimeAsync(5_000)

    await waitFor(() => {
      expect(screen.getByTestId('job-extract-ready')).toBeInTheDocument()
    })
    // Nothing to confirm, so nothing to block: the gate is about candidates only.
    expect(screen.queryByTestId('job-skill-candidates')).toBeNull()
    expect(screen.getByTestId('job-form-submit')).toBeEnabled()
    expect(screen.queryByTestId('job-form-blocked')).toBeNull()
  })
})
