/**
 * The account-list filters and the keyset cursor, as URL query parameters
 * (Requirement 16 AC1, AC2, AC3, AC17).
 *
 * Pure: no React, no Api_Client. The accounts screen reads what is applied out of
 * the address bar, turns it into the query of `GET /api/v1/admin/accounts`, and
 * writes a changed filter set back — the same round trip the job browse slice
 * uses, for the same reasons: a filtered page is linkable and reload-proof, the
 * browser's back button walks the pages, and the empty state can offer
 * "clear filters" without the screen knowing which parameter counts as a filter.
 *
 * ## The parameter names are the endpoint's parameter names
 *
 * `status`, `role` and `after_id` are spelled exactly as `GET /admin/accounts`
 * spells them, so the address bar and the request carry one vocabulary. Unlike the
 * job browse cursor, `after_id` needs no decoding: AC3 says the next request
 * carries the last returned account identifier, and that is precisely what the
 * endpoint's `after_id` accepts.
 *
 * ## Why the pending-skill review is a `view` parameter
 *
 * Requirement 16 AC17 asks for a pending-skill review *destination*. The route
 * tree and the Navigation_Menu catalogue are fixed by Requirement 8 — the Admin
 * menu is exactly the eight destinations AC8 enumerates — so the review is a
 * second view of the accounts destination, addressed as `?view=pending-skills`.
 * It is a destination in every sense that matters here: it has its own address, it
 * is linkable, it is reachable by keyboard from the accounts screen, and the
 * browser's back button returns from it.
 *
 * Requirements: 16.1, 16.2, 16.3, 16.17.
 */

import type { AccountStatus, Role } from '../../api/enums'
import { ROLE_VALUES, enumValues, type EnumValues } from '../../forms/validators'
import {
  byId,
  deriveLastIdCursor,
  DEFAULT_PAGE_SIZE,
  type NextPage,
} from '../../lib/cursor'

import type { Account } from './accountRules'

// ── Parameter names ───────────────────────────────────────────────────────────

/** URL and query parameter names, spelled as `GET /admin/accounts` spells them. */
export const ACCOUNTS_PARAM = {
  status: 'status',
  role: 'role',
  /** The last account identifier of the previous page (AC3). Not a filter. */
  afterId: 'after_id',
  /** Which view of the destination is rendered (AC17). Not a filter. */
  view: 'view',
} as const

/** Every parameter that is a filter, i.e. neither the cursor nor the view. */
export const ACCOUNT_FILTER_PARAM_NAMES: readonly string[] = Object.freeze([
  ACCOUNTS_PARAM.status,
  ACCOUNTS_PARAM.role,
])

// ── Enumerated filter values ──────────────────────────────────────────────────

/**
 * The Account_Status values the status filter offers (AC2).
 *
 * Keyed on the contract's `AccountStatus` union through `enumValues`, so a status
 * the Backend_Api adds or renames fails the typecheck rather than quietly
 * disappearing from the filter. Order is the lifecycle order, which is the order
 * an Admin works through them.
 */
export const ACCOUNT_STATUS_VALUES: EnumValues<AccountStatus> = enumValues<AccountStatus>({
  PendingVerification: true,
  PendingApproval: true,
  ApprovedPendingMeeting: true,
  Approved: true,
  Rejected: true,
  Suspended: true,
  Deactivated: true,
})

// ── The filter set ────────────────────────────────────────────────────────────

/** The two filters Requirement 16 AC2 asks for. */
export interface AccountFilters {
  readonly status: AccountStatus | null
  readonly role: Role | null
}

/** No filter applied: the unfiltered first page. */
export const EMPTY_ACCOUNT_FILTERS: AccountFilters = Object.freeze({ status: null, role: null })

/** Which view of the accounts destination is being rendered (AC17). */
export type AdminAccountsView = 'accounts' | 'pending-skills'

/** The view rendered when the address names none. */
export const DEFAULT_ACCOUNTS_VIEW: AdminAccountsView = 'accounts'

/** The pending-skill review view (AC17). */
export const PENDING_SKILLS_VIEW: AdminAccountsView = 'pending-skills'

/** Anything that reads like a `URLSearchParams`. */
export interface ReadableSearchParams {
  get(name: string): string | null
}

function trimmed(value: string | null): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Reads a filter value constrained to a contract enum.
 *
 * An unrecognized value — a hand-edited address, a stale link from before a
 * contract change — resolves to "no filter", so a crafted address yields an
 * unfiltered list instead of a 422.
 */
function enumFilter<T extends string>(raw: string | null, members: EnumValues<T>): T | null {
  const value = trimmed(raw)
  return value !== '' && members.includes(value) ? value : null
}

/** Reads the applied filters out of a location's query string (AC1, AC2). */
export function readAccountFilters(params: ReadableSearchParams): AccountFilters {
  return {
    status: enumFilter<AccountStatus>(params.get(ACCOUNTS_PARAM.status), ACCOUNT_STATUS_VALUES),
    role: enumFilter<Role>(params.get(ACCOUNTS_PARAM.role), ROLE_VALUES),
  }
}

/** The keyset cursor the current location carries, if any (AC3). */
export function readAccountCursor(params: ReadableSearchParams): string | null {
  const cursor = trimmed(params.get(ACCOUNTS_PARAM.afterId))
  return cursor === '' ? null : cursor
}

/** The view the current location addresses (AC17). */
export function readAccountsView(params: ReadableSearchParams): AdminAccountsView {
  return trimmed(params.get(ACCOUNTS_PARAM.view)) === PENDING_SKILLS_VIEW
    ? PENDING_SKILLS_VIEW
    : DEFAULT_ACCOUNTS_VIEW
}

/**
 * Serializes a filter set back into query parameters (AC2).
 *
 * The cursor is deliberately not written: a cursor names a position in one
 * filtered result set and means nothing in another, so applying a filter starts a
 * new keyset walk from the first page.
 */
export function writeAccountFilters(filters: AccountFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.status !== null) {
    params.set(ACCOUNTS_PARAM.status, filters.status)
  }
  if (filters.role !== null) {
    params.set(ACCOUNTS_PARAM.role, filters.role)
  }
  return params
}

/** The address of the pending-skill review view (AC17). */
export function pendingSkillsSearch(): URLSearchParams {
  const params = new URLSearchParams()
  params.set(ACCOUNTS_PARAM.view, PENDING_SKILLS_VIEW)
  return params
}

/**
 * Whether any filter is applied (Requirement 21 AC7).
 *
 * Drives the empty state's clear-filter control: "no accounts at all" and "no
 * account matches these filters" are different outcomes, and only the second one
 * has a filter to clear.
 */
export function hasActiveAccountFilters(filters: AccountFilters): boolean {
  return filters.status !== null || filters.role !== null
}

// ── The request query ─────────────────────────────────────────────────────────

/** The query of one `GET /api/v1/admin/accounts` request. */
export interface AccountsQueryParams {
  readonly limit: number
  readonly status?: AccountStatus
  readonly role?: Role
  readonly after_id?: string
}

/**
 * Builds the query of `GET /api/v1/admin/accounts` (AC2, AC3).
 *
 * Every applied filter becomes a query parameter (AC2), the page size is the
 * shared 20-row bound of `lib/cursor.ts` (AC3), and a cursor contributes
 * `after_id` (AC3). Unapplied filters are omitted rather than sent empty, so two
 * equal filter sets produce one cache key instead of two.
 */
export function accountsQueryParams(
  filters: AccountFilters,
  cursor: string | null = null,
): AccountsQueryParams {
  const afterId = typeof cursor === 'string' ? cursor.trim() : ''
  return {
    limit: DEFAULT_PAGE_SIZE,
    ...(filters.status === null ? {} : { status: filters.status }),
    ...(filters.role === null ? {} : { role: filters.role }),
    ...(afterId === '' ? {} : { after_id: afterId }),
  }
}

/**
 * The next page of an account list (AC3).
 *
 * `GET /admin/accounts` answers a bare array with no continuation metadata, so a
 * further page is inferred from a full page being returned and the cursor is the
 * last returned identifier — exactly what `deriveLastIdCursor` computes.
 */
export function nextAccountsPage(
  accounts: readonly Account[] | null | undefined,
): NextPage<string> {
  return deriveLastIdCursor(accounts, { cursorOf: byId })
}
