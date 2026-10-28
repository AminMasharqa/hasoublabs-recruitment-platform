/**
 * The TanStack Query bindings of the Senior profile slice: two reads and one
 * mutation over the calls declared in `queries.ts`.
 *
 * Kept apart from `queries.ts` so the paths and the decoding stay assertable
 * without React, and apart from the screens so a screen holds form state and
 * nothing else.
 *
 * ## Why the save writes the cache before it invalidates
 *
 * The contact preferences the screen renders — which channels are offered, whether
 * the scope control is presented, whether the account email is shown as the contact
 * address (Requirement 10 AC4, AC5, AC10, AC11) — are all read from the *persisted*
 * profile. Writing the 200 response into the cache on success means those surfaces
 * re-render from the server's own answer in the same commit, with no window in
 * which the screen reports the previous preference while a refetch is on the wire.
 * The invalidation that follows reconciles the entry with a fresh read.
 *
 * A *failed* save writes nothing: the cached profile stays the last persisted
 * server state, which is what has to remain on screen beside the rejected entry.
 *
 * Requirements: 10.1, 10.9, 10.12.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'

import { useApiClient } from '../../../shell/appServices'

import type { SeniorProfile, SeniorProfileUpdate } from './model'
import {
  adminSeniorProfileQueryKey,
  fetchMySeniorProfile,
  fetchSeniorProfileAsAdmin,
  MY_SENIOR_PROFILE_QUERY_KEY,
  saveMySeniorProfile,
} from './queries'

export interface MySeniorProfileQueryOptions {
  /**
   * Whether the read may be issued at all. Defaults to `true`.
   *
   * `GET /me/senior-profile` is a Senior-context read, so anything mounting this
   * hook outside that context passes `false` rather than issuing a request the
   * Backend_Api would refuse.
   */
  readonly enabled?: boolean
}

/** `GET /api/v1/me/senior-profile` as a query (AC1). */
export function useMySeniorProfileQuery(
  options: MySeniorProfileQueryOptions = {},
): UseQueryResult<SeniorProfile> {
  const api = useApiClient()
  return useQuery({
    queryKey: MY_SENIOR_PROFILE_QUERY_KEY,
    queryFn: ({ signal }) => fetchMySeniorProfile(api, signal),
    enabled: options.enabled ?? true,
  })
}

/**
 * `PUT /api/v1/me/senior-profile` as a mutation (AC9).
 *
 * The rejection is passed through untouched — the `ApiFailure` the Api_Client
 * decoded, with its `fieldViolations` already extracted — so the form can place
 * them onto the inputs they address.
 */
export function useSaveMySeniorProfile(): UseMutationResult<
  SeniorProfile,
  unknown,
  SeniorProfileUpdate
> {
  const api = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: SeniorProfileUpdate) => saveMySeniorProfile(api, body),
    onSuccess: (saved) => {
      queryClient.setQueryData<SeniorProfile>(MY_SENIOR_PROFILE_QUERY_KEY, saved)
      void queryClient.invalidateQueries({ queryKey: MY_SENIOR_PROFILE_QUERY_KEY })
    },
  })
}

/**
 * `GET /api/v1/admin/seniors/{account_id}/profile` as a query (AC12).
 *
 * Disabled without an account id, so an address missing the parameter renders the
 * "no senior named" notice rather than issuing a request against `undefined`.
 */
export function useAdminSeniorProfileQuery(
  accountId: string | null | undefined,
): UseQueryResult<SeniorProfile> {
  const api = useApiClient()
  const id = accountId ?? ''
  return useQuery({
    queryKey: adminSeniorProfileQueryKey(id),
    queryFn: ({ signal }) => fetchSeniorProfileAsAdmin(api, id, signal),
    enabled: id !== '',
  })
}
