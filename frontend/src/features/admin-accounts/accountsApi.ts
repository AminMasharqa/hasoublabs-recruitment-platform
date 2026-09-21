/**
 * The Admin account-management requests, issued through the Api_Client.
 *
 * | request | requirement |
 * | --- | --- |
 * | `GET /admin/accounts` | AC1, AC2, AC3 |
 * | `POST /admin/registration-links` | AC4, AC5 |
 * | `POST /admin/accounts/{account_id}:approve` | AC7 |
 * | `POST /admin/accounts/{account_id}:reject` | AC8 |
 * | `POST /admin/accounts/{account_id}:record-meeting` | AC9 |
 * | `POST /admin/accounts/{account_id}:suspend` | AC10 |
 * | `POST /admin/accounts/{account_id}:deactivate` | AC10, AC11 |
 * | `POST /admin/accounts/{account_id}:reactivate` | AC11 |
 * | `POST /admin/accounts/{account_id}:reopen` | AC12 |
 * | `PUT /admin/accounts/{account_id}/roles` | AC13 |
 * | `GET /admin/skills/pending` | AC17 |
 *
 * Each is a one-line call into {@link ApiClient.request}, so credential
 * attachment, `Accept-Language`, the 30-second budget, the retry policy, the 401
 * refresh-and-replay path, error decoding and the Support_Reference are the
 * Api_Client's (Requirement 3 AC1) and are not restated per screen. The path
 * templates are keys of the generated declarations, so a contract change that
 * renamed one of them fails `npm run typecheck` rather than a request at runtime.
 *
 * Separate from `accountQueries.ts` because these are plain promises with no React
 * in them: a test can drive the whole slice's data access with a stub Api_Client
 * and no renderer.
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.7, 16.8, 16.9, 16.10, 16.11, 16.12, 16.13, 16.17.
 */

import type { ApiClient } from '../../api/client'
import type { Role } from '../../api/enums'
import type { components } from '../../api/generated/schema'

import type { AccountsQueryParams } from './accountFilters'
import { roleUpdateBody, type Account, type LifecycleAction } from './accountRules'
import { decodePendingSkills, type PendingSkill } from './pendingSkills'

/** A Registration_Link, whose `token` is populated only at creation (AC5). */
export type RegistrationLink = components['schemas']['RegistrationLinkDTO']

/** The role a Registration_Link may be issued for (AC4). */
export type RegistrationLinkRole = Exclude<Role, 'ADMIN'>

// ── Paths ─────────────────────────────────────────────────────────────────────

/** `GET` path of the account list (AC1). */
export const ADMIN_ACCOUNTS_PATH = '/api/v1/admin/accounts'

/** `POST` path that issues a Registration_Link (AC4). */
export const REGISTRATION_LINKS_PATH = '/api/v1/admin/registration-links'

/** `PUT` path of one account's complete role set (AC13). */
export const ACCOUNT_ROLES_PATH = '/api/v1/admin/accounts/{account_id}/roles'

/** `GET` path of the pending-skill review list (AC17). */
export const PENDING_SKILLS_PATH = '/api/v1/admin/skills/pending'

/**
 * The `POST` path of each lifecycle transition (AC7–AC12).
 *
 * Keyed on {@link LifecycleAction}, so adding a transition without a path — or a
 * path the contract does not declare — is a typecheck failure.
 */
export const LIFECYCLE_PATHS = Object.freeze({
  approve: '/api/v1/admin/accounts/{account_id}:approve',
  reject: '/api/v1/admin/accounts/{account_id}:reject',
  'record-meeting': '/api/v1/admin/accounts/{account_id}:record-meeting',
  suspend: '/api/v1/admin/accounts/{account_id}:suspend',
  deactivate: '/api/v1/admin/accounts/{account_id}:deactivate',
  reactivate: '/api/v1/admin/accounts/{account_id}:reactivate',
  reopen: '/api/v1/admin/accounts/{account_id}:reopen',
} as const satisfies Readonly<Record<LifecycleAction, string>>)

// ── Cache keys ────────────────────────────────────────────────────────────────

/**
 * Root of every cache entry this slice owns.
 *
 * One scope, so a single invalidation after a lifecycle call discards every cached
 * account page rather than only the one currently on screen (AC15) — a transition
 * changes which page an account belongs to when a status filter is applied.
 */
export const ADMIN_ACCOUNTS_QUERY_SCOPE = 'admin-accounts' as const

/** Cache key of one account page: the query is the identity of the page (AC2, AC3). */
export function accountsQueryKey(query: AccountsQueryParams): readonly unknown[] {
  return [ADMIN_ACCOUNTS_QUERY_SCOPE, 'list', query]
}

/** Cache key prefix of every account page, for one-call invalidation (AC15). */
export const ACCOUNTS_LIST_QUERY_KEY: readonly unknown[] = [ADMIN_ACCOUNTS_QUERY_SCOPE, 'list']

/** Cache key of the pending-skill review list (AC17). */
export function pendingSkillsQueryKey(): readonly unknown[] {
  return [ADMIN_ACCOUNTS_QUERY_SCOPE, 'pending-skills']
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/** `GET /admin/accounts` — one page of accounts (AC1, AC2, AC3). */
export async function listAccounts(
  api: ApiClient,
  query: AccountsQueryParams,
  signal?: AbortSignal,
): Promise<readonly Account[]> {
  const { data } = await api.request('get', ADMIN_ACCOUNTS_PATH, {
    params: { query },
    ...(signal === undefined ? {} : { signal }),
  })
  return data
}

/** `GET /admin/skills/pending` — the terms awaiting taxonomy review (AC17). */
export async function listPendingSkills(
  api: ApiClient,
  signal?: AbortSignal,
): Promise<readonly PendingSkill[]> {
  const { data } = await api.request('get', PENDING_SKILLS_PATH, {
    ...(signal === undefined ? {} : { signal }),
  })
  return decodePendingSkills(data)
}

// ── Registration links ────────────────────────────────────────────────────────

/**
 * `POST /admin/registration-links` — issues a link for a Candidate or a Senior
 * (AC4, AC5).
 *
 * The 201 carries the `token` in plaintext exactly once. Nothing here stores it:
 * the value is returned to the caller and the caller renders it, so the only place
 * it lives is the screen that asked for it (AC6).
 */
export async function createRegistrationLink(
  api: ApiClient,
  role: RegistrationLinkRole,
): Promise<RegistrationLink> {
  const { data } = await api.request('post', REGISTRATION_LINKS_PATH, { body: { role } })
  return data
}

// ── Lifecycle transitions (AC7–AC12) ──────────────────────────────────────────

/** `POST .../{account_id}:approve` — approves with the fast-track indicator (AC7). */
export async function approveAccount(
  api: ApiClient,
  accountId: string,
  fastTrack: boolean,
): Promise<Account> {
  const { data } = await api.request('post', LIFECYCLE_PATHS.approve, {
    params: { path: { account_id: accountId } },
    body: { fast_track: fastTrack },
  })
  return data
}

/** `POST .../{account_id}:reject` — rejects with a 10–500 character reason (AC8). */
export async function rejectAccount(
  api: ApiClient,
  accountId: string,
  reason: string,
): Promise<Account> {
  const { data } = await api.request('post', LIFECYCLE_PATHS.reject, {
    params: { path: { account_id: accountId } },
    body: { reason },
  })
  return data
}

/** `POST .../{account_id}:record-meeting` — records the onboarding meeting (AC9). */
export async function recordAccountMeeting(
  api: ApiClient,
  accountId: string,
): Promise<Account> {
  const { data } = await api.request('post', LIFECYCLE_PATHS['record-meeting'], {
    params: { path: { account_id: accountId } },
  })
  return data
}

/** `POST .../{account_id}:suspend` — suspends with a 1–500 character reason (AC10). */
export async function suspendAccount(
  api: ApiClient,
  accountId: string,
  reason: string,
): Promise<Account> {
  const { data } = await api.request('post', LIFECYCLE_PATHS.suspend, {
    params: { path: { account_id: accountId } },
    body: { reason },
  })
  return data
}

/** `POST .../{account_id}:deactivate` — deactivates with a reason (AC10, AC11). */
export async function deactivateAccount(
  api: ApiClient,
  accountId: string,
  reason: string,
): Promise<Account> {
  const { data } = await api.request('post', LIFECYCLE_PATHS.deactivate, {
    params: { path: { account_id: accountId } },
    body: { reason },
  })
  return data
}

/** `POST .../{account_id}:reactivate` — returns a Suspended account to Approved (AC11). */
export async function reactivateAccount(api: ApiClient, accountId: string): Promise<Account> {
  const { data } = await api.request('post', LIFECYCLE_PATHS.reactivate, {
    params: { path: { account_id: accountId } },
  })
  return data
}

/** `POST .../{account_id}:reopen` — reopens a Rejected account (AC12). */
export async function reopenAccount(api: ApiClient, accountId: string): Promise<Account> {
  const { data } = await api.request('post', LIFECYCLE_PATHS.reopen, {
    params: { path: { account_id: accountId } },
  })
  return data
}

/** What one lifecycle call needs: the account, the transition and what it carries. */
export interface LifecycleRequest {
  readonly accountId: string
  readonly action: LifecycleAction
  /** The reason of a reject, suspend or deactivate (AC8, AC10). */
  readonly reason?: string
  /** The fast-track indicator of an approve (AC7). Defaults to `false`. */
  readonly fastTrack?: boolean
}

/**
 * Issues one lifecycle transition and returns the account as the Backend_Api now
 * describes it (AC7–AC12, AC15).
 *
 * All seven answer 200 with the updated `AccountDTO`, which is what lets AC15's
 * "render the returned Account_Status" be the response itself rather than a guess
 * the client makes about where the transition led.
 *
 * Dispatched over the seven typed calls above rather than over a computed path, so
 * each request's parameters and body are checked against the generated
 * declarations — the three bodyless transitions in particular send no body at all,
 * which is what the contract declares for them.
 */
export function issueLifecycleAction(
  api: ApiClient,
  request: LifecycleRequest,
): Promise<Account> {
  const { accountId, action } = request
  const reason = request.reason ?? ''
  switch (action) {
    case 'approve':
      return approveAccount(api, accountId, request.fastTrack ?? false)
    case 'reject':
      return rejectAccount(api, accountId, reason)
    case 'record-meeting':
      return recordAccountMeeting(api, accountId)
    case 'suspend':
      return suspendAccount(api, accountId, reason)
    case 'deactivate':
      return deactivateAccount(api, accountId, reason)
    case 'reactivate':
      return reactivateAccount(api, accountId)
    case 'reopen':
      return reopenAccount(api, accountId)
  }
}

// ── Roles (AC13) ──────────────────────────────────────────────────────────────

/** `PUT /admin/accounts/{account_id}/roles` — replaces the complete role set (AC13). */
export async function updateAccountRoles(
  api: ApiClient,
  accountId: string,
  roles: readonly string[],
): Promise<Account> {
  const { data } = await api.request('put', ACCOUNT_ROLES_PATH, {
    params: { path: { account_id: accountId } },
    body: { roles: [...roleUpdateBody(roles).roles] },
  })
  return data
}
