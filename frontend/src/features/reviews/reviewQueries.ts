/**
 * The TanStack Query bindings of the Review slice: two reads and one mutation.
 *
 * The mutation invalidates both timeline subtrees of the reviewed Candidate on
 * success, so the timeline a screen renders is always the Backend_Api's answer
 * rather than a locally patched guess. That matters for Requirement 15 AC6 and
 * AC7 specifically: a correction has to appear in ascending creation order beside
 * the Review it corrects, and only the server knows the `seq` it was assigned.
 *
 * Nothing here writes the cache optimistically. A Review is append-only and
 * carries a server-assigned `seq` and `created_at`; inventing either locally would
 * render a row in the wrong position until the refetch landed.
 *
 * Requirements: 15.2, 15.4, 15.7, 15.8, 15.9, 15.11.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'

import { useApiClient } from '../../shell/appServices'

import type { Review, SubmitReviewBody } from './reviewRules'
import {
  candidateReviewsQueryKey,
  candidateReviewsScopeKey,
  listCandidateReviews,
  listOwnReviews,
  ownReviewsQueryKey,
  ownReviewsScopeKey,
  submitReview,
} from './reviewsApi'
import {
  ownTimelineQueryParams,
  timelineQueryParams,
  type TimelineCursor,
  type TimelineFilters,
} from './timelineFilters'

/**
 * One page of the Admin Review_Timeline (AC7, AC8, AC11).
 *
 * Disabled for a blank Candidate identifier: an address that carries none is a
 * defective link, and the screen says so rather than issuing a request the
 * Backend_Api would refuse.
 */
export function useCandidateReviewsQuery(
  candidateId: string | null | undefined,
  filters: TimelineFilters,
  cursor: TimelineCursor | null = null,
): UseQueryResult<readonly Review[]> {
  const api = useApiClient()
  const id = (candidateId ?? '').trim()
  const query = timelineQueryParams(filters, cursor)
  return useQuery({
    queryKey: candidateReviewsQueryKey(id, query),
    queryFn: ({ signal }) => listCandidateReviews(api, id, query, signal),
    enabled: id !== '',
  })
}

/** One page of the authenticated Senior's own Reviews for a Candidate (AC9, AC11). */
export function useOwnReviewsQuery(
  candidateId: string | null | undefined,
  cursor: TimelineCursor | null = null,
): UseQueryResult<readonly Review[]> {
  const api = useApiClient()
  const id = (candidateId ?? '').trim()
  const query = ownTimelineQueryParams(cursor)
  return useQuery({
    queryKey: ownReviewsQueryKey(id, query),
    queryFn: ({ signal }) => listOwnReviews(api, id, query, signal),
    enabled: id !== '',
  })
}

/** The variables of a submission: the reviewed Candidate and the body (AC2, AC4). */
export interface SubmitReviewVariables {
  readonly candidateId: string
  readonly body: SubmitReviewBody
}

/**
 * `POST /candidates/{candidate_id}/reviews` as a mutation (AC2, AC4).
 *
 * Both timeline subtrees of the reviewed Candidate are invalidated on success, so
 * whichever of the two screens is mounted re-reads. Invalidating the subtree
 * rather than one page is deliberate: a new Review shifts every page of every
 * filter set, and a cursor walk left behind cached pages that no longer describe
 * the timeline.
 */
export function useSubmitReview(): UseMutationResult<Review, unknown, SubmitReviewVariables> {
  const api = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ candidateId, body }: SubmitReviewVariables) =>
      submitReview(api, candidateId, body),
    onSuccess: (_review, { candidateId }) => {
      void queryClient.invalidateQueries({ queryKey: candidateReviewsScopeKey(candidateId) })
      void queryClient.invalidateQueries({ queryKey: ownReviewsScopeKey(candidateId) })
    },
  })
}
