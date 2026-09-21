/**
 * The {@link RouteAccess} presets every guarded route and every Navigation_Menu
 * destination is declared with.
 *
 * `access.ts` holds the decision logic; this module holds the *vocabulary* the
 * route tree and the destination catalogue share, so a route and the menu entry
 * that points at it cannot declare different requirements — which is what makes
 * Requirement 8 AC5 ("the menu presents only destinations the guard would admit")
 * hold by construction rather than by review.
 *
 * Kept separate from `routes.tsx` because `destinations.ts` needs the same
 * presets and must not import a module that pulls in React elements.
 *
 * Requirements: 8.1, 8.3, 8.6, 8.7, 8.8, 7.2.
 */

import type { AccountStatus, Role } from '../api/enums'

import { APPROVED_STATUS, type ActiveContext, type RouteAccess } from './access'

/**
 * The status set every feature route requires.
 *
 * Exactly `Approved`. Requirement 7 AC2 admits nothing but the
 * Onboarding_Screens while the retained status is anything else, and Requirement
 * 7 AC7 opens full navigation once it is `Approved` — so any wider set on a
 * feature route would be unreachable metadata, and a narrower one is impossible.
 * `ApprovedPendingMeeting` is deliberately excluded: the requirements gate on the
 * exact value `Approved`.
 */
export const APPROVED_ONLY: readonly AccountStatus[] = Object.freeze([APPROVED_STATUS])

/** Access for a route open to any role in any Active_Context, once approved. */
export function approvedAccess(roles: readonly Role[]): RouteAccess {
  return { requiredRoles: roles, requiredStatuses: APPROVED_ONLY }
}

/** Access for a route that additionally demands one Active_Context (Req 8 AC3). */
export function contextAccess(roles: readonly Role[], context: ActiveContext): RouteAccess {
  return { requiredRoles: roles, requiredContext: context, requiredStatuses: APPROVED_ONLY }
}

/**
 * Any approved session, whatever its role or Active_Context.
 *
 * Used by the account screen (Req 5 AC7), the diagnostics surface (Req 23 AC5,
 * AC6) and the landing redirect, none of which is role-scoped.
 */
export const ANY_CONTEXT_ACCESS: RouteAccess = approvedAccess(['ADMIN', 'CANDIDATE', 'SENIOR'])

/**
 * The Candidate context (Req 8 AC6).
 *
 * Both conjuncts matter: the account must hold the Candidate role *and* be acting
 * in it, so a dual-role account switched to `SENIOR` is refused a Candidate
 * screen until it switches back.
 */
export const CANDIDATE_ACCESS: RouteAccess = contextAccess(['CANDIDATE'], 'CANDIDATE')

/** The Senior context (Req 8 AC7). */
export const SENIOR_ACCESS: RouteAccess = contextAccess(['SENIOR'], 'SENIOR')

/**
 * The Admin role (Req 8 AC8).
 *
 * `requiredContext` is declared even though AC8 is phrased on the role alone:
 * Requirement 16 AC13 makes the Admin role exclusive of the others and
 * Requirement 8 AC12 withholds the context switch from an Admin account, so an
 * Admin's `act` claim is always `ADMIN` and the extra conjunct refuses nothing
 * that AC8 admits. It is declared anyway so the client's metadata matches the
 * guard the Backend_Api applies to the same endpoints.
 */
export const ADMIN_ACCESS: RouteAccess = contextAccess(['ADMIN'], 'ADMIN')

/**
 * Job_Description browsing, shared by the Candidate and Senior contexts
 * (Req 12 AC1, Req 8 AC6, AC7).
 *
 * No `requiredContext`, because both contexts browse the same screen. The Admin
 * role is deliberately absent: an Admin lists Job_Descriptions through the
 * all-status Admin destination (Req 13 AC17), so leaving `ADMIN` out of the role
 * set is also what keeps the browsing entry out of the Admin Navigation_Menu.
 */
export const JOB_BROWSING_ACCESS: RouteAccess = approvedAccess(['CANDIDATE', 'SENIOR'])
