/**
 * The TanStack Query bindings of the Admin account-management slice: two reads and
 * three mutations (Requirement 16 AC1–AC3, AC5, AC6, AC13, AC15, AC17).
 *
 * ## Invalidation (AC15)
 *
 * Every mutation invalidates {@link ACCOUNTS_LIST_QUERY_KEY} on success, so the
 * list a screen renders is the Backend_Api's answer rather than a locally patched
 * guess. The whole `list` prefix is invalidated, not the page currently on screen:
 * a transition moves an account between status-filtered pages, so the page it left
 * is as stale as the page it joined.
 *
 * The lifecycle and role mutations additionally write the returned account into
 * the cached pages before the refetch lands, so AC15's "render the returned
 * Account_Status" is satisfied by the 200 itself and the new status appears without
 * a second round trip in which the old one would still be on screen.
 *
 * ## Why the Registration_Link mutation is cached for no time at all (AC6)
 *
 * A 201 carries the `token` in plaintext once, and AC6 forbids retaining it in any
 * cached server-state entry after the creating screen is left. Two things enforce
 * that here: `gcTime: 0` removes the mutation from the MutationCache the moment
 * the screen unmounts and stops observing it, and the panel additionally resets the
 * mutation on unmount. The token is therefore never written to the *query* cache at
 * all — there is no `useQuery` for it, because a Registration_Link is created, not
 * read.
 *
 * Requirements: 16.1, 16.2, 16.3, 16.5, 16.6, 16.13, 16.15, 16.17.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'

import { useApiClient } from '../../shell/appServices'

import {
  accountsQueryParams,
  type AccountFilters,
  type AccountsQueryParams,
} from './accountFilters'
import { replaceAccount, type Account } from './accountRules'
import {
  ACCOUNTS_LIST_QUERY_KEY,
  accountsQueryKey,
  createRegistrationLink,
  issueLifecycleAction,
  listAccounts,
  listPendingSkills,
  pendingSkillsQueryKey,
  updateAccountRoles,
  type LifecycleRequest,
  type RegistrationLink,
  type RegistrationLinkRole,
} from './accountsApi'
import type { PendingSkill } from './pendingSkills'

/** The cached account pages, as the mutations read and write them. */
type CachedAccounts = readonly Account[] | undefined

/** One page of `GET /admin/accounts` (AC1, AC2, AC3). */
export function useAccountsQuery(
  filters: AccountFilters,
  cursor: string | null = null,
): UseQueryResult<readonly Account[]> {
  const api = useApiClient()
  const query: AccountsQueryParams = accountsQueryParams(filters, cursor)
  return useQuery({
    queryKey: accountsQueryKey(query),
    queryFn: ({ signal }) => listAccounts(api, query, signal),
  })
}

/** The pending-skill review list (AC17). */
export function usePendingSkillsQuery(): UseQueryResult<readonly PendingSkill[]> {
  const api = useApiClient()
  return useQuery({
    queryKey: pendingSkillsQueryKey(),
    queryFn: ({ signal }) => listPendingSkills(api, signal),
  })
}

/**
 * The account-list invalidation and cache write every mutation performs on a 200
 * (AC15).
 */
function useApplyUpdatedAccount(): (updated: Account) => void {
  const queryClient = useQueryClient()
  return (updated: Account) => {
    // Every cached page that holds this account now renders the returned status.
    queryClient.setQueriesData<CachedAccounts>(
      { queryKey: ACCOUNTS_LIST_QUERY_KEY },
      (current) => replaceAccount(current, updated),
    )
    void queryClient.invalidateQueries({ queryKey: ACCOUNTS_LIST_QUERY_KEY })
  }
}

/**
 * One lifecycle transition as a mutation (AC7–AC12, AC15).
 *
 * One hook for all seven rather than seven hooks: they differ only in the endpoint
 * `issueLifecycleAction` dispatches to, and they share the invalidation, so a
 * single mutation keeps the "invalidate and render the returned status" behaviour
 * in one place. The caller passes the action, which is what the control it sits
 * behind already knows.
 */
export function useAccountLifecycleMutation(): UseMutationResult<
  Account,
  unknown,
  LifecycleRequest
> {
  const api = useApiClient()
  const applyUpdated = useApplyUpdatedAccount()
  return useMutation({
    mutationFn: (request: LifecycleRequest) => issueLifecycleAction(api, request),
    onSuccess: applyUpdated,
  })
}

/** The variables of a role replacement: the account and the complete target set. */
export interface UpdateRolesVariables {
  readonly accountId: string
  readonly roles: readonly string[]
}

/** `PUT /admin/accounts/{account_id}/roles` as a mutation (AC13, AC15). */
export function useUpdateAccountRoles(): UseMutationResult<
  Account,
  unknown,
  UpdateRolesVariables
> {
  const api = useApiClient()
  const applyUpdated = useApplyUpdatedAccount()
  return useMutation({
    mutationFn: ({ accountId, roles }: UpdateRolesVariables) =>
      updateAccountRoles(api, accountId, roles),
    onSuccess: applyUpdated,
  })
}

/**
 * `POST /admin/registration-links` as a mutation (AC4, AC5, AC6).
 *
 * `gcTime: 0` is the AC6 guarantee: the mutation — and with it the `token` the 201
 * carried — is dropped from the MutationCache as soon as the creating screen stops
 * observing it. Nothing invalidates the account list here, because issuing a link
 * creates no account.
 */
export function useCreateRegistrationLink(): UseMutationResult<
  RegistrationLink,
  unknown,
  RegistrationLinkRole
> {
  const api = useApiClient()
  return useMutation({
    mutationFn: (role: RegistrationLinkRole) => createRegistrationLink(api, role),
    gcTime: 0,
  })
}
