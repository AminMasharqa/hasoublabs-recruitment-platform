/**
 * Which lifecycle controls an account offers, what each of them has to carry, and
 * what the role control may submit (Requirement 16 AC7–AC14, AC16).
 *
 * Pure: no React, no Api_Client, no catalogue lookup. Every decision the Admin
 * screens make about an account is taken here from the account's Account_Status
 * and its role set, so the screens render a control set rather than computing one,
 * and the requirement's status-to-control table is assertable without a renderer.
 *
 * ## Why the control set is data rather than conditionals in the components
 *
 * Requirement 16 AC7–AC12 is a table: six statuses, each offering a named subset
 * of seven transitions. Spelling that table as `status === 'Approved' ? … : …`
 * inside a component makes "does `Suspended` offer deactivate?" a question you
 * answer by reading JSX. {@link lifecycleActionsFor} answers it as a lookup, and
 * {@link LIFECYCLE_ACTIONS_BY_STATUS} is the table itself — keyed on the contract's
 * `AccountStatus` union, so a status the Backend_Api adds fails the typecheck here
 * instead of silently rendering no controls.
 *
 * ## Reason bounds
 *
 * Three transitions carry a reason. Requirement 16 AC8 asks for 10–500 characters
 * on a rejection and AC10 for 1–500 on a suspension or a deactivation; the
 * Backend_Api declares 1–500 for all three, so the rejection bound is the stricter
 * of the two and is applied client-side as the aid Requirement 22 AC12 describes —
 * the Backend_Api remains the authority, and nothing here decides an outcome on
 * its own.
 *
 * ## Admin exclusivity (AC14)
 *
 * `ADMIN` together with any other role is refused before a request is issued.
 * That is a client-side *block*, not a client-side verdict: the Backend_Api
 * enforces the same constraint, and this only spares the Admin a round trip and
 * names the rule in the interface.
 *
 * Requirements: 16.7, 16.8, 16.9, 16.10, 16.11, 16.12, 16.13, 16.14, 16.16, 22.1, 22.12.
 */

import type { AccountStatus, Role } from '../../api/enums'
import type { components } from '../../api/generated/schema'
import { ROLE_VALUES, validateText, type ValidationIssue } from '../../forms/validators'

/** One account, exactly as `GET /admin/accounts` returns it (AC1). */
export type Account = components['schemas']['AccountDTO']

// ── The lifecycle transitions ─────────────────────────────────────────────────

/**
 * The seven lifecycle transitions of Requirement 16 AC7–AC12.
 *
 * Spelled as the path suffix each one is issued against
 * (`POST /admin/accounts/{account_id}:approve`), so an action value and the
 * endpoint it names cannot drift apart.
 */
export type LifecycleAction =
  | 'approve'
  | 'reject'
  | 'record-meeting'
  | 'suspend'
  | 'deactivate'
  | 'reactivate'
  | 'reopen'

/**
 * The transitions each Account_Status offers (AC7–AC12).
 *
 * `Deactivated` offers none: the requirements name no transition out of it, and a
 * deactivated account's email slot has been released, so it is terminal as far as
 * this screen is concerned.
 *
 * Order is rendering order, least destructive first, so the control an Admin
 * reaches by habit is never the irreversible one.
 */
export const LIFECYCLE_ACTIONS_BY_STATUS: Readonly<
  Record<AccountStatus, readonly LifecycleAction[]>
> = Object.freeze({
  // AC8.
  PendingVerification: Object.freeze(['reject'] as LifecycleAction[]),
  // AC7, AC8.
  PendingApproval: Object.freeze(['approve', 'reject'] as LifecycleAction[]),
  // AC9, AC8.
  ApprovedPendingMeeting: Object.freeze(['record-meeting', 'reject'] as LifecycleAction[]),
  // AC10.
  Approved: Object.freeze(['suspend', 'deactivate'] as LifecycleAction[]),
  // AC12.
  Rejected: Object.freeze(['reopen'] as LifecycleAction[]),
  // AC11.
  Suspended: Object.freeze(['reactivate', 'deactivate'] as LifecycleAction[]),
  Deactivated: Object.freeze([] as LifecycleAction[]),
})

/** The transitions a status offers, in rendering order (AC7–AC12). */
export function lifecycleActionsFor(
  status: AccountStatus | string | null | undefined,
): readonly LifecycleAction[] {
  if (typeof status !== 'string') {
    return []
  }
  // A status the contract does not declare offers nothing: an unknown state is
  // not one this screen knows a safe transition out of.
  return LIFECYCLE_ACTIONS_BY_STATUS[status as AccountStatus] ?? []
}

/** Whether `status` offers `action` (AC7–AC12). */
export function offersLifecycleAction(
  status: AccountStatus | string | null | undefined,
  action: LifecycleAction,
): boolean {
  return lifecycleActionsFor(status).includes(action)
}

// ── Reasons (AC8, AC10) ───────────────────────────────────────────────────────

/** The three transitions that carry a reason (AC8, AC10). */
export const REASON_ACTIONS: readonly LifecycleAction[] = Object.freeze([
  'reject',
  'suspend',
  'deactivate',
])

/** Inclusive reason length bounds, counted in Unicode code points. */
export interface ReasonBounds {
  readonly minLength: number
  readonly maxLength: number
}

/** AC8: a rejection reason runs from 10 to 500 characters. */
export const REJECT_REASON_BOUNDS: ReasonBounds = Object.freeze({ minLength: 10, maxLength: 500 })

/** AC10: a suspension or deactivation reason runs from 1 to 500 characters. */
export const SUSPEND_REASON_BOUNDS: ReasonBounds = Object.freeze({ minLength: 1, maxLength: 500 })

/** Whether `action` carries a reason (AC8, AC10). */
export function requiresReason(action: LifecycleAction): boolean {
  return REASON_ACTIONS.includes(action)
}

/** The reason bounds of `action`, or `null` when it carries no reason. */
export function reasonBoundsFor(action: LifecycleAction): ReasonBounds | null {
  if (action === 'reject') {
    return REJECT_REASON_BOUNDS
  }
  if (action === 'suspend' || action === 'deactivate') {
    return SUSPEND_REASON_BOUNDS
  }
  return null
}

/** Path the reason input is addressed by, matching the request body member. */
export const REASON_PATH = 'reason'

/**
 * Applies the reason bounds of `action` (AC8, AC10).
 *
 * Yields `null` for an action that carries no reason, so a caller can run this
 * unconditionally.
 */
export function validateLifecycleReason(
  action: LifecycleAction,
  value: unknown,
): ValidationIssue | null {
  const bounds = reasonBoundsFor(action)
  if (bounds === null) {
    return null
  }
  return validateText(value, { kind: 'text', required: true, ...bounds, path: REASON_PATH })
}

// ── Confirmation (AC16) ───────────────────────────────────────────────────────

/**
 * The transitions a confirmation dialog must precede (AC16).
 *
 * Exactly the three the requirement names. The same three carry a reason, which
 * is why the dialog is also where the reason is entered: one surface, one
 * deliberate act, and no path to an unconfirmed request.
 */
export const CONFIRMED_ACTIONS: readonly LifecycleAction[] = REASON_ACTIONS

/** Whether `action` may only be issued from a confirmation dialog (AC16). */
export function requiresConfirmation(action: LifecycleAction): boolean {
  return CONFIRMED_ACTIONS.includes(action)
}

// ── The role control (AC13, AC14) ─────────────────────────────────────────────

/** Path the role control is addressed by, matching the request body member. */
export const ROLES_PATH = 'roles'

/** Why a target role set cannot be submitted. */
export type RoleSetRefusal =
  /** AC14: `ADMIN` together with another role. */
  | 'admin_exclusive'
  /** The Backend_Api declares at least one role. */
  | 'empty'
  /** Nothing to submit: the target set is the set the account already holds. */
  | 'unchanged'

/**
 * Whether `roles` combines `ADMIN` with any other role (AC14).
 *
 * The predicate the block is stated as, so the rule reads the same way the
 * requirement does.
 */
export function combinesAdminWithOtherRole(roles: readonly string[]): boolean {
  const distinct = new Set(roles)
  return distinct.has('ADMIN') && distinct.size > 1
}

/** The distinct roles of `values`, in the contract's declaration order. */
export function normalizeRoleSet(values: readonly string[] | null | undefined): readonly Role[] {
  const selected = new Set(values ?? [])
  return ROLE_VALUES.values.filter((role) => selected.has(role))
}

/** Whether two role sets name the same roles, whatever order they arrived in. */
export function isSameRoleSet(
  left: readonly string[] | null | undefined,
  right: readonly string[] | null | undefined,
): boolean {
  const a = normalizeRoleSet(left)
  const b = normalizeRoleSet(right)
  return a.length === b.length && a.every((role, index) => role === b[index])
}

/**
 * Why the role control refuses to submit `target` for `account`, or `null` when
 * it may be submitted (AC13, AC14).
 *
 * `unchanged` is not a rule the Backend_Api has; it exists so the control does
 * not issue a request that asks for the state it is already in.
 */
export function roleSetRefusal(
  account: Pick<Account, 'roles'>,
  target: readonly string[],
): RoleSetRefusal | null {
  const roles = normalizeRoleSet(target)
  if (combinesAdminWithOtherRole(roles)) {
    return 'admin_exclusive'
  }
  if (roles.length === 0) {
    return 'empty'
  }
  if (isSameRoleSet(account.roles, roles)) {
    return 'unchanged'
  }
  return null
}

/** Whether the role control may submit `target` for `account` (AC13, AC14). */
export function canSubmitRoleSet(
  account: Pick<Account, 'roles'>,
  target: readonly string[],
): boolean {
  return roleSetRefusal(account, target) === null
}

/** The complete target role set `PUT .../roles` is called with (AC13). */
export function roleUpdateBody(target: readonly string[]): { readonly roles: readonly Role[] } {
  return { roles: normalizeRoleSet(target) }
}

// ── List helpers ──────────────────────────────────────────────────────────────

/** Replaces one account in a cached page by identifier, leaving the order intact. */
export function replaceAccount(
  accounts: readonly Account[] | undefined,
  updated: Account,
): readonly Account[] | undefined {
  if (accounts === undefined) {
    return accounts
  }
  return accounts.map((account) => (account.id === updated.id ? updated : account))
}
