/**
 * Component tests for the append-only Review_Timeline (task 21.2).
 *
 * Requirement 15:
 * - AC4 the correction control opens the review form pre-filled with the prior
 *   Review's values, and the submission carries that Review's identifier in
 *   `corrects_review_id`.
 * - AC5 no control edits or deletes a submitted Review.
 * - AC6 a Review carrying `corrects_review_id` renders a correction indicator
 *   linking it to the Review it corrects.
 *
 * `reviewRules.test.ts` already states the pure halves — which draft
 * `draftFromReview` produces, which body `submitReviewBody` builds, which pairs
 * `correctionLinks` reports — so none of that is restated here. What is asserted is
 * the wiring those facts are worthless without:
 *
 * - the pre-fill reaching the *rendered* inputs of the Review the control names,
 *   and the body that actually goes on the wire when that form is submitted;
 * - AC5 as an absence at the rendering level: over a timeline of several Reviews,
 *   no edit control and no delete control exists — not a disabled one, none — and
 *   the only per-Review control is the correction;
 * - the indicator as two rendered, navigable links between the correcting Review
 *   and the corrected one, including the case where the corrected Review sits off
 *   the page and the indicator has to name it instead of disappearing.
 *
 * The Admin timeline screen is the one mounted because it is the surface that
 * renders every Review of a Candidate — a correction and the Review it corrects can
 * only sit side by side there. The Senior screen composes the same
 * `ReviewTimeline`, `ReviewCard` and `ReviewSubmissionPanel`, and its own-only
 * endpoint choice is covered by `reviewsRouteAccess.test.ts`.
 */

import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { i18n as I18nextInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiClient, ApiSuccess } from '../../api/client'
import { createI18n } from '../../i18n'
import { AppServicesContext, type AppServices } from '../../shell/appServices'

import { AdminCandidateReviewsScreen } from './AdminCandidateReviewsScreen'
import { CANDIDATE_REVIEWS_PATH } from './reviewsApi'
import { reviewElementId, type Review, type SubmitReviewBody } from './reviewRules'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CANDIDATE_ID = 'cand-1'

/** A Review with every member the contract's `ReviewDTO` declares. */
function reviewFixture(overrides: Partial<Review> = {}): Review {
  return {
    assessment: 'Solid fundamentals, communicates clearly.',
    candidate_id: CANDIDATE_ID,
    corrects_review_id: null,
    created_at: '2026-01-01T10:00:00Z',
    id: 'rev-1',
    jd_id: 'jd-7',
    rating_communication: 4,
    rating_culture_fit: 3,
    rating_overall: 2,
    rating_technical: 5,
    reviewer_account_id: 'acc-admin',
    seq: 1,
    ...overrides,
  }
}

/** The first Review: the one every correction case corrects. */
const FIRST = reviewFixture()

/** A second, unrelated Review — neither corrects nor is corrected. */
const SECOND = reviewFixture({
  assessment: 'Second opinion after the take-home.',
  created_at: '2026-01-02T10:00:00Z',
  id: 'rev-2',
  jd_id: null,
  rating_communication: 3,
  rating_culture_fit: 4,
  rating_overall: 4,
  rating_technical: 3,
  seq: 2,
})

/** A correction of {@link FIRST}. */
const CORRECTION = reviewFixture({
  assessment: 'Revised after seeing the system design round.',
  corrects_review_id: FIRST.id,
  created_at: '2026-01-03T10:00:00Z',
  id: 'rev-3',
  rating_communication: 5,
  rating_culture_fit: 5,
  rating_overall: 4,
  rating_technical: 4,
  seq: 3,
})

// ── Harness ───────────────────────────────────────────────────────────────────

let i18n: I18nextInstance

beforeEach(() => {
  i18n = createI18n('en')
})

/** One recorded request. */
interface RecordedRequest {
  readonly method: string
  readonly path: string
  readonly body: unknown
}

/**
 * An Api_Client answering the timeline read with a fixed page and accepting the
 * append.
 *
 * The read answers the same page after a submission, because what is asserted here
 * is the body that was issued rather than the row the Backend_Api would then
 * return; the Review a correction appends is the server's to assign a `seq` and a
 * `created_at` to, and `reviewQueries.ts` invalidates rather than patching.
 */
function apiAnswering(page: readonly Review[]) {
  const requests: RecordedRequest[] = []

  const request = vi.fn((method: string, path: string, init?: unknown) => {
    const body = (init as { body?: unknown } | undefined)?.body
    requests.push({ method, path, body })

    if (method === 'post') {
      return Promise.resolve({
        data: reviewFixture({ id: 'rev-appended', seq: 9 }),
        response: new Response(null, { status: 201 }),
        supportReference: 'req-appended',
      } satisfies ApiSuccess<unknown>)
    }
    return Promise.resolve({
      data: [...page],
      response: new Response(null, { status: 200 }),
      supportReference: 'req-timeline',
    } satisfies ApiSuccess<unknown>)
  })

  const api: ApiClient = {
    request: request as unknown as ApiClient['request'],
    exchangeRefreshToken: () => Promise.reject(new Error('not used')),
    revokeSession: () => Promise.resolve(),
  }
  return { api, requests }
}

/** The bodies of every Review appended, in order. */
function appended(requests: readonly RecordedRequest[]): SubmitReviewBody[] {
  return requests
    .filter((entry) => entry.method === 'post' && entry.path === CANDIDATE_REVIEWS_PATH)
    .map((entry) => entry.body as SubmitReviewBody)
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
            <MemoryRouter initialEntries={[`/admin/candidates/${CANDIDATE_ID}/reviews`]}>
              <Routes>
                <Route
                  path="/admin/candidates/:accountId/reviews"
                  element={<AdminCandidateReviewsScreen />}
                />
              </Routes>
            </MemoryRouter>
          </AppServicesContext.Provider>
        </QueryClientProvider>
      </I18nextProvider>
    </MantineProvider>,
  )
}

/** Waits for the timeline to have rendered the page. */
async function timelineRendered(reviews: readonly Review[]): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId('review-timeline')).toBeInTheDocument()
  })
  for (const review of reviews) {
    expect(screen.getByTestId(`review-card-${review.id}`)).toBeInTheDocument()
  }
}

/** One Review's rendered card. */
function card(review: Review): HTMLElement {
  return screen.getByTestId(`review-card-${review.id}`)
}

/** The correction form's input for one path. */
function correctionInput(path: string): HTMLInputElement | HTMLTextAreaElement {
  return screen.getByTestId(`review-correction-${path}`) as HTMLInputElement
}

// ── AC4: the correction control pre-fills, and names the Review it corrects ────

describe('the correction control (Req 15 AC4)', () => {
  it('opens the form pre-filled with the prior Review’s ratings, assessment and Job_Description', async () => {
    const user = userEvent.setup()
    const { api } = apiAnswering([FIRST, SECOND])
    renderScreen(api)

    await timelineRendered([FIRST, SECOND])
    await user.click(screen.getByTestId(`review-correct-${FIRST.id}`))

    // Every collected value of AC1, seeded from the Review the control names.
    expect(await screen.findByTestId('review-correction-form')).toBeInTheDocument()
    expect(correctionInput('rating_technical')).toHaveValue(FIRST.rating_technical)
    expect(correctionInput('rating_communication')).toHaveValue(FIRST.rating_communication)
    expect(correctionInput('rating_culture_fit')).toHaveValue(FIRST.rating_culture_fit)
    expect(correctionInput('rating_overall')).toHaveValue(FIRST.rating_overall)
    expect(correctionInput('assessment')).toHaveValue(FIRST.assessment)
    expect(correctionInput('jd')).toHaveValue(FIRST.jd_id)

    // The panel says which Review is being corrected, and that the original stays.
    expect(screen.getByTestId('review-correction-corrects')).toHaveTextContent(
      'Correcting review 1',
    )
    expect(screen.getByTestId('review-correction-corrects')).toHaveTextContent(
      'The original stays in the timeline',
    )
  })

  it('submits the prior Review’s identifier as `corrects_review_id`', async () => {
    const user = userEvent.setup()
    const { api, requests } = apiAnswering([FIRST, SECOND])
    renderScreen(api)

    await timelineRendered([FIRST, SECOND])
    await user.click(screen.getByTestId(`review-correct-${FIRST.id}`))
    await screen.findByTestId('review-correction-form')

    // Corrected in the one respect the reviewer changed his mind about; everything
    // else goes back as the pre-fill left it.
    await user.clear(correctionInput('rating_overall'))
    await user.type(correctionInput('rating_overall'), '4')
    await user.click(screen.getByTestId('review-correction-submit'))

    await waitFor(() => {
      expect(appended(requests)).toHaveLength(1)
    })
    expect(appended(requests)[0]).toEqual({
      assessment: FIRST.assessment,
      corrects_review_id: FIRST.id,
      jd_id: FIRST.jd_id,
      rating_communication: FIRST.rating_communication,
      rating_culture_fit: FIRST.rating_culture_fit,
      rating_overall: 4,
      rating_technical: FIRST.rating_technical,
    })
    // Appended, never updated: the correction is a `POST`, and the corrected
    // Review is left exactly where it was.
    expect(requests.every((entry) => entry.method === 'get' || entry.method === 'post')).toBe(true)
  })

  it('re-seeds from whichever Review the control names, replacing an open correction', async () => {
    const user = userEvent.setup()
    const { api } = apiAnswering([FIRST, SECOND])
    renderScreen(api)

    await timelineRendered([FIRST, SECOND])
    await user.click(screen.getByTestId(`review-correct-${FIRST.id}`))
    await screen.findByTestId('review-correction-form')
    expect(correctionInput('assessment')).toHaveValue(FIRST.assessment)

    // Correcting a different Review while the first correction is open: the form
    // is the other Review's, not a leftover draft.
    await user.click(screen.getByTestId(`review-correct-${SECOND.id}`))

    await waitFor(() => {
      expect(correctionInput('assessment')).toHaveValue(SECOND.assessment)
    })
    expect(correctionInput('rating_technical')).toHaveValue(SECOND.rating_technical)
    // `jd_id` is null on the second Review, so the association opens blank rather
    // than carrying the first Review's.
    expect(correctionInput('jd')).toHaveValue('')
    expect(screen.getByTestId('review-correction-corrects')).toHaveTextContent(
      'Correcting review 2',
    )
  })

  it('submits no correction target for a first Review', async () => {
    const user = userEvent.setup()
    const { api, requests } = apiAnswering([FIRST])
    renderScreen(api)

    await timelineRendered([FIRST])
    await user.click(screen.getByTestId('review-compose-open'))

    await user.type(await screen.findByTestId('review-new-rating_technical'), '5')
    await user.type(screen.getByTestId('review-new-rating_communication'), '4')
    await user.type(screen.getByTestId('review-new-rating_culture_fit'), '4')
    await user.type(screen.getByTestId('review-new-rating_overall'), '5')
    await user.type(screen.getByTestId('review-new-assessment'), 'A first impression.')
    await user.click(screen.getByTestId('review-new-submit'))

    await waitFor(() => {
      expect(appended(requests)).toHaveLength(1)
    })
    // AC4 is a property of a correction only: an ordinary submission says nothing
    // about a prior Review.
    expect(appended(requests)[0]).not.toHaveProperty('corrects_review_id')
    expect(screen.queryByTestId('review-correction-corrects')).toBeNull()
  })
})

// ── AC5: append-only, at the rendering level ──────────────────────────────────

describe('a rendered Review carries no edit or delete control (Req 15 AC5)', () => {
  /** Anything that would read as editing or removing a Review. */
  const FORBIDDEN = ['edit', 'update', 'change', 'modify', 'delete', 'remove', 'withdraw', 'revoke']

  it('offers no such control anywhere over a timeline of several Reviews', async () => {
    const { api, requests } = apiAnswering([FIRST, SECOND, CORRECTION])
    renderScreen(api)

    await timelineRendered([FIRST, SECOND, CORRECTION])

    const labels = screen
      .getAllByRole('button')
      .map((control) => (control.textContent ?? '').toLowerCase())
    for (const forbidden of FORBIDDEN) {
      expect(labels.some((label) => label.includes(forbidden))).toBe(false)
    }

    // Absent rather than refused: a disabled control would still tell a reader the
    // operation exists.
    const timeline = screen.getByTestId('review-timeline')
    for (const control of within(timeline).getAllByRole('button')) {
      expect(control).toBeEnabled()
    }

    // Nothing on the screen issued anything but the read.
    expect(requests.every((entry) => entry.method === 'get')).toBe(true)
  })

  it('renders the correction as each Review’s only control', async () => {
    const { api } = apiAnswering([FIRST, SECOND, CORRECTION])
    renderScreen(api)

    await timelineRendered([FIRST, SECOND, CORRECTION])

    for (const review of [FIRST, SECOND, CORRECTION]) {
      const controls = within(card(review)).getAllByRole('button')
      expect(controls).toHaveLength(1)
      expect(controls[0]).toHaveAttribute('data-testid', `review-correct-${review.id}`)
      // "Correct", not "edit": the label says what the Backend_Api does.
      expect(controls[0]).toHaveTextContent('Submit a correction')
      expect(within(card(review)).queryByTestId(`review-edit-${review.id}`)).toBeNull()
      expect(within(card(review)).queryByTestId(`review-delete-${review.id}`)).toBeNull()
    }
  })
})

// ── AC6: the correction indicator ─────────────────────────────────────────────

describe('the correction indicator (Req 15 AC6)', () => {
  it('links the correcting Review to the corrected one, and back', async () => {
    const { api } = apiAnswering([FIRST, SECOND, CORRECTION])
    renderScreen(api)

    await timelineRendered([FIRST, SECOND, CORRECTION])

    // On the correcting Review: an indicator naming the Review it corrects.
    expect(screen.getByTestId(`review-correction-badge-${CORRECTION.id}`)).toHaveTextContent(
      'Correction',
    )
    const forward = within(screen.getByTestId(`review-corrects-link-${CORRECTION.id}`)).getByRole(
      'link',
    )
    expect(forward).toHaveTextContent('Corrects review 1')
    expect(forward).toHaveAttribute('href', `#${reviewElementId(FIRST.id)}`)

    // On the corrected Review: the reverse indicator.
    expect(screen.getByTestId(`review-corrected-badge-${FIRST.id}`)).toHaveTextContent(
      'Corrected later',
    )
    const backward = within(screen.getByTestId(`review-corrected-link-${FIRST.id}`)).getByRole(
      'link',
    )
    expect(backward).toHaveTextContent('Corrected by review 3')
    expect(backward).toHaveAttribute('href', `#${reviewElementId(CORRECTION.id)}`)

    // Both links address a Review actually on the page.
    expect(card(FIRST)).toHaveAttribute('id', reviewElementId(FIRST.id))
    expect(card(CORRECTION)).toHaveAttribute('id', reviewElementId(CORRECTION.id))

    // The uncorrected Review carries neither indicator.
    expect(screen.queryByTestId(`review-correction-badge-${SECOND.id}`)).toBeNull()
    expect(screen.queryByTestId(`review-corrected-badge-${SECOND.id}`)).toBeNull()
  })

  it('still names the corrected Review when it sits off the page', async () => {
    const { api } = apiAnswering([CORRECTION])
    renderScreen(api)

    await timelineRendered([CORRECTION])

    // The corrected Review is on an earlier page, so there is nothing to anchor to
    // — but the indicator names it rather than disappearing.
    expect(screen.getByTestId(`review-correction-badge-${CORRECTION.id}`)).toBeInTheDocument()
    const indicator = screen.getByTestId(`review-corrects-link-${CORRECTION.id}`)
    expect(indicator).toHaveTextContent(FIRST.id)
    expect(indicator).toHaveTextContent('not on this page')
    expect(within(indicator).queryByRole('link')).toBeNull()

    // And no reverse indicator is invented for a Review that is not rendered.
    expect(screen.queryByTestId(`review-corrected-badge-${FIRST.id}`)).toBeNull()
  })
})
