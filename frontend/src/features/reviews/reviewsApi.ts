/**
 * The three Review requests, issued through the Api_Client.
 *
 * | request | endpoint | requirement |
 * | --- | --- | --- |
 * | submit a Review | `POST /candidates/{candidate_id}/reviews` | 15.2, 15.4 |
 * | the full timeline | `GET /candidates/{candidate_id}/reviews` | 15.7, 15.8, 15.11 |
 * | a Senior's own Reviews | `GET /candidates/{candidate_id}/reviews/mine` | 15.9, 15.11 |
 *
 * There is deliberately no fourth: the contract exposes no update and no delete
 * for a Review, and this module adds none — which is the structural half of
 * Requirement 15 AC5. A screen cannot offer an edit control that reaches the
 * Backend_Api, because there is no function here for it to call.
 *
 * Each request is a one-line call into {@link ApiClient.request}, so credential
 * attachment, `Accept-Language`, the 30-second budget, the read retry policy, the
 * 401 refresh-and-replay path, Error_Envelope decoding and the Support_Reference
 * are the Api_Client's (Requirement 3 AC1) rather than restated per screen. The
 * path templates are keys of the generated declarations, so a contract change that
 * renamed one fails `npm run typecheck` instead of a request at runtime.
 *
 * Separate from `reviewQueries.ts` because these are plain promises with no React
 * in them: a test can drive the slice's data access with a stub Api_Client and no
 * renderer.
 *
 * Requirements: 15.2, 15.4, 15.7, 15.8, 15.9, 15.11.
 */

import type { ApiClient } from '../../api/client'

import type { Review, SubmitReviewBody } from './reviewRules'
import type { OwnTimelineQueryParams, TimelineQueryParams } from './timelineFilters'

// ── Paths ─────────────────────────────────────────────────────────────────────

/** `POST` and Admin `GET` path of one Candidate's Reviews (AC2, AC7). */
export const CANDIDATE_REVIEWS_PATH = '/api/v1/candidates/{candidate_id}/reviews'

/** Senior `GET` path of the authenticated Senior's own Reviews (AC9). */
export const OWN_CANDIDATE_REVIEWS_PATH = '/api/v1/candidates/{candidate_id}/reviews/mine'

// ── Cache keys ────────────────────────────────────────────────────────────────

/** Root of every cache entry this slice owns, so one call can invalidate them all. */
export const REVIEWS_QUERY_SCOPE = 'reviews' as const

/**
 * Cache key of one Admin timeline page (AC7, AC8, AC11).
 *
 * The request query is part of the identity of the page, so two equal filter sets
 * share one entry and a cursor walk keeps each visited page cached — pressing
 * "next" and then going back re-renders rather than re-reads.
 */
export function candidateReviewsQueryKey(
  candidateId: string,
  query: TimelineQueryParams,
): readonly unknown[] {
  return [REVIEWS_QUERY_SCOPE, 'timeline', candidateId, query]
}

/** Cache key of one page of a Senior's own Reviews (AC9, AC11). */
export function ownReviewsQueryKey(
  candidateId: string,
  query: OwnTimelineQueryParams,
): readonly unknown[] {
  return [REVIEWS_QUERY_SCOPE, 'mine', candidateId, query]
}

/**
 * Every cache entry belonging to one Candidate's Reviews.
 *
 * What a successful submission invalidates: a new Review changes every page of
 * every filter set of both timelines, so the whole subtree goes rather than a
 * hand-picked page.
 */
export function candidateReviewsScopeKey(candidateId: string): readonly unknown[] {
  return [REVIEWS_QUERY_SCOPE, 'timeline', candidateId]
}

/** The own-timeline counterpart of {@link candidateReviewsScopeKey}. */
export function ownReviewsScopeKey(candidateId: string): readonly unknown[] {
  return [REVIEWS_QUERY_SCOPE, 'mine', candidateId]
}

// ── Requests ──────────────────────────────────────────────────────────────────

/**
 * `POST /candidates/{candidate_id}/reviews` — appends a Review (AC2, AC4).
 *
 * The body carries `corrects_review_id` when the form was opened by a correction
 * control; nothing else distinguishes a correction from a first Review, because
 * the Backend_Api appends both.
 */
export async function submitReview(
  api: ApiClient,
  candidateId: string,
  body: SubmitReviewBody,
): Promise<Review> {
  const { data } = await api.request('post', CANDIDATE_REVIEWS_PATH, {
    params: { path: { candidate_id: candidateId } },
    body,
  })
  return data
}

/**
 * `GET /candidates/{candidate_id}/reviews` — the full timeline (AC7, AC8, AC11).
 *
 * Admin only, enforced by the Backend_Api guard and by the route group the screen
 * sits in; a Senior reaching this endpoint receives a denial the Error_Presenter
 * renders uniformly (Requirement 21 AC3).
 */
export async function listCandidateReviews(
  api: ApiClient,
  candidateId: string,
  query: TimelineQueryParams,
  signal?: AbortSignal,
): Promise<readonly Review[]> {
  const { data } = await api.request('get', CANDIDATE_REVIEWS_PATH, {
    params: { path: { candidate_id: candidateId }, query },
    ...(signal === undefined ? {} : { signal }),
  })
  return data
}

/**
 * `GET /candidates/{candidate_id}/reviews/mine` — the authenticated Senior's own
 * Reviews for one Candidate (AC9, AC11).
 *
 * The scoping to "own" is the endpoint's, not a client-side filter: the Senior
 * screen reads this path and never the Admin one, so there is no request in which
 * another reviewer's Review could arrive and be filtered out afterwards.
 */
export async function listOwnReviews(
  api: ApiClient,
  candidateId: string,
  query: OwnTimelineQueryParams,
  signal?: AbortSignal,
): Promise<readonly Review[]> {
  const { data } = await api.request('get', OWN_CANDIDATE_REVIEWS_PATH, {
    params: { path: { candidate_id: candidateId }, query },
    ...(signal === undefined ? {} : { signal }),
  })
  return data
}
