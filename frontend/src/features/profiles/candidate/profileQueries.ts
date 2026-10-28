/**
 * The TanStack Query bindings of the Candidate profile slice: two reads and one
 * mutation over the calls declared in `queries.ts`.
 *
 * Kept apart from `queries.ts` so the paths and the decoding stay assertable
 * without React, and apart from the screens so a screen holds form state and
 * nothing else.
 *
 * ## Why the save writes the cache before it invalidates
 *
 * Requirement 9 AC9 and AC10 are statements about *the returned profile*: the
 * completeness panel names the fields the 200 response does not satisfy, and the
 * confirmation is rendered when its `state` is `Complete`. Writing the response
 * into the cache on success means the panel re-renders from the server's own
 * answer in the same commit — no window in which the screen reports the previous
 * state while a refetch is on the wire. The invalidation that follows reconciles
 * the entry with a fresh read, so the written value cannot go stale.
 *
 * A *failed* save writes nothing (Requirement 9 AC12): the cached profile remains
 * the last persisted server state, which is exactly what has to stay on screen
 * beside the rejected entry.
 *
 * Requirements: 9.1, 9.8, 9.9, 9.10, 9.12, 9.14.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'

import { useApiClient } from '../../../shell/appServices'

import type { CandidateProfile, CandidateProfileUpdate } from './model'
import {
  adminCandidateProfileQueryKey,
  fetchCandidateProfileAsAdmin,
  fetchMyProfile,
  MY_PROFILE_QUERY_KEY,
  saveMyProfile,
} from './queries'

export interface MyProfileQueryOptions {
  /**
   * Whether the read may be issued at all. Defaults to `true`.
   *
   * The apply gate (`applyGate.tsx`) mounts above every context, and
   * `GET /me/profile` is a Candidate-context read — so it passes `false` while the
   * Active_Context is not `CANDIDATE` rather than issuing a request the
   * Backend_Api would refuse.
   */
  readonly enabled?: boolean
}

/** `GET /api/v1/me/profile` as a query (AC1). */
export function useMyProfileQuery(
  options: MyProfileQueryOptions = {},
): UseQueryResult<CandidateProfile> {
  const api = useApiClient()
  return useQuery({
    queryKey: MY_PROFILE_QUERY_KEY,
    queryFn: ({ signal }) => fetchMyProfile(api, signal),
    enabled: options.enabled ?? true,
  })
}

/**
 * `PUT /api/v1/me/profile` as a mutation (AC8).
 *
 * The rejection is passed through untouched — the `ApiFailure` the Api_Client
 * decoded, with its `fieldViolations` already extracted — so the form can place
 * them (AC11).
 */
export function useSaveMyProfile(): UseMutationResult<
  CandidateProfile,
  unknown,
  CandidateProfileUpdate
> {
  const api = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CandidateProfileUpdate) => saveMyProfile(api, body),
    onSuccess: (saved) => {
      // AC9, AC10: the panel renders from the returned profile immediately.
      queryClient.setQueryData<CandidateProfile>(MY_PROFILE_QUERY_KEY, saved)
      void queryClient.invalidateQueries({ queryKey: MY_PROFILE_QUERY_KEY })
    },
  })
}

/**
 * `GET /api/v1/admin/candidates/{account_id}/profile` as a query (AC14).
 *
 * Disabled without an account id, so an address missing the parameter renders the
 * "no candidate named" notice rather than issuing a request against `undefined`.
 */
export function useAdminCandidateProfileQuery(
  accountId: string | null | undefined,
): UseQueryResult<CandidateProfile> {
  const api = useApiClient()
  const id = accountId ?? ''
  return useQuery({
    queryKey: adminCandidateProfileQueryKey(id),
    queryFn: ({ signal }) => fetchCandidateProfileAsAdmin(api, id, signal),
    enabled: id !== '',
  })
}
