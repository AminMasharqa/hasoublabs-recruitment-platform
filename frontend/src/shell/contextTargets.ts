/**
 * Who may switch Active_Context, and to what — pure logic, no React and no HTTP
 * (Requirement 8 AC10, AC12).
 *
 * Requirement 8 states the presentation rule twice, from both sides:
 *
 * - AC10: a context-switch control is presented **where** the account holds both
 *   the Candidate role and the Senior role,
 * - AC12: a context-switch control is **not** presented for an account whose role
 *   set contains the Admin role.
 *
 * Both are one predicate over the `roles` claim, and it lives here rather than
 * inside `ContextSwitch.tsx` so that it is decidable — and testable — without
 * mounting anything. {@link contextSwitchTargets} returns `null` for every
 * account that may not switch, which is what the control renders as "no control
 * at all".
 *
 * ## Why an Admin-role account is excluded rather than offered fewer targets
 *
 * A role set of `{ADMIN, CANDIDATE, SENIOR}` satisfies AC10's condition and
 * AC12's prohibition at the same time. AC12 wins: it is unconditional ("SHALL
 * NOT ... for an account whose role set contains the Admin role"), so the Admin
 * check is applied first and short-circuits, and {@link canSwitchContext} reports
 * `false` no matter what else the set contains.
 *
 * ## Why the return type is a non-empty tuple
 *
 * `POST /auth/context` needs a *target*, so a rendered control with no target is
 * a control that cannot do anything. Returning
 * `readonly [SwitchableContext, ...SwitchableContext[]] | null` makes the caller
 * discharge the empty case with a `null` check before it can reach the component
 * that renders the buttons — the emptiness is handled at the type level rather
 * than by a convention the next reader has to notice.
 *
 * Requirements: 8.10, 8.12.
 */

import type { Role } from '../api/enums'
import { ROLE_CONTEXT_VALUES } from '../forms/validators'
import type { ActiveContext } from '../routing/access'

/**
 * A context `POST /auth/context` accepts as its target.
 *
 * `SwitchContextRequest.context` is documented as "CANDIDATE or SENIOR", which is
 * `Exclude<Role, 'ADMIN'>` — the same set {@link ROLE_CONTEXT_VALUES} is derived
 * from, so a renamed or dropped contract role fails the typecheck here.
 */
export type SwitchableContext = Exclude<Role, 'ADMIN'>

/** The Admin role, whose presence forbids the control outright (AC12). */
export const ADMIN_ROLE: Role = 'ADMIN'

/**
 * A non-empty list of switch targets.
 *
 * Non-emptiness is in the type on purpose; see the module comment.
 */
export type ContextSwitchTargets = readonly [SwitchableContext, ...SwitchableContext[]]

/** Whether `roles` contains every switchable context (the dual-role test of AC10). */
export function isDualRole(roles: readonly Role[]): boolean {
  return ROLE_CONTEXT_VALUES.values.every((context) => roles.includes(context))
}

/**
 * Whether a context-switch control may be presented for this role set at all
 * (AC10, AC12).
 *
 * `true` only for an account that holds both the Candidate and the Senior role
 * and does not hold the Admin role.
 */
export function canSwitchContext(roles: readonly Role[]): boolean {
  if (roles.includes(ADMIN_ROLE)) {
    // AC12 is unconditional, so it is applied before AC10's dual-role test.
    return false
  }
  return isDualRole(roles)
}

/**
 * The contexts this session may switch *to*, or `null` when it may not switch
 * (AC10, AC12).
 *
 * The Active_Context itself is never a target — switching to the context already
 * in the `act` claim would replace the token pair and discard the cache to arrive
 * exactly where the user already is. An `act` that names no switchable context
 * (`ADMIN`, or no session at all) therefore yields every switchable context;
 * that combination is unreachable for an account {@link canSwitchContext} admits,
 * and treating it as "both targets are elsewhere" keeps the function total.
 */
export function contextSwitchTargets(
  roles: readonly Role[],
  act: ActiveContext | null | undefined,
): ContextSwitchTargets | null {
  if (!canSwitchContext(roles)) {
    return null
  }
  const [first, ...rest] = ROLE_CONTEXT_VALUES.values.filter((context) => context !== act)
  return first === undefined ? null : [first, ...rest]
}
