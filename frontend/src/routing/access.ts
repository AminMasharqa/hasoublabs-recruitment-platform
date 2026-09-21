/**
 * Route_Guard and Navigation_Menu decision logic — pure, no React, no router, no HTTP.
 *
 * Requirement 8 (role-based route guarding) and Requirement 7 (Account_Status
 * gating) between them describe one total function from "who is asking" to "what
 * happens to this navigation attempt". That function lives here so it can be
 * reasoned about and property-tested on its own; `RouteGuard.tsx`,
 * `NavigationMenu.tsx` and `routes.tsx` only translate its outcome into a
 * redirect, a denied screen or a rendered link.
 *
 * - Req 8 AC1/AC3: admission is the conjunction `roles ∩ requiredRoles ≠ ∅`,
 *   `requiredContext` absent or equal to the `act` claim, and retained
 *   Account_Status ∈ `requiredStatuses` ({@link satisfiesRouteAccess}).
 * - Req 8 AC2: no Access_Token held → `redirect-to-login`; the caller retains the
 *   requested location.
 * - Req 8 AC4: refusal for an authenticated session → `deny`, which renders the
 *   uniform authorization-denied screen. The refused route never issues its
 *   request, which holds structurally: the decision is taken before the route
 *   element (and therefore its queries) mounts.
 * - Req 7 AC2: while the retained status is anything other than `Approved`, only
 *   Onboarding_Screens are admitted and every other attempt is redirected to the
 *   Status_Notice ({@link decideOnboardingGate}).
 * - Req 7 AC7: once the retained status is `Approved` the gate stops applying and
 *   admission is exactly the Requirement 8 conjunction.
 * - Req 8 AC5: the Navigation_Menu is the subset of destinations that would be
 *   admitted for the same subject ({@link deriveNavigationMenu}).
 *
 * Req 8 AC6–AC8 (which destinations exist per Active_Context) are a property of
 * the destination catalogue, not of this logic: each destination declares its own
 * {@link RouteAccess} and the filter above does the scoping. The catalogue itself
 * is declared with the routes.
 *
 * `Role` and `AccountStatus` come from `src/api/enums.ts`, i.e. from the generated
 * contract — a renamed or dropped member fails the typecheck here rather than
 * silently widening who gets in.
 */

import type { AccountStatus, Role } from '../api/enums'
import { enumValues, ROLE_VALUES } from '../forms/validators'

// ── Vocabulary ────────────────────────────────────────────────────────────────

/**
 * The `act` claim: the role the session is *currently acting as*.
 *
 * The Backend_Api issues `act` as a `Role` value (`ADMIN`, `CANDIDATE` or
 * `SENIOR`) and guards routes on it, so the two share one type rather than a
 * parallel hand-written union.
 */
export type ActiveContext = Role

/** Every Account_Status the contract declares, for routes open to all of them. */
export const ACCOUNT_STATUS_VALUES = enumValues<AccountStatus>({
  PendingVerification: true,
  PendingApproval: true,
  ApprovedPendingMeeting: true,
  Approved: true,
  Rejected: true,
  Suspended: true,
  Deactivated: true,
})

/**
 * The one status that opens full navigation (Req 7 AC2, AC7).
 *
 * `ApprovedPendingMeeting` is deliberately *not* it: the requirement gates on the
 * exact value `Approved`.
 */
export const APPROVED_STATUS: AccountStatus = 'Approved'

/** Access metadata declared on a guarded route (Req 8 AC1). */
export interface RouteAccess {
  /**
   * Roles permitted to reach the route. Admission needs a non-empty intersection
   * with the subject's `roles` claim, so an empty set admits nobody.
   */
  readonly requiredRoles: readonly Role[]
  /**
   * Active_Context the route demands. Absent means the route does not care which
   * context the session is acting in.
   */
  readonly requiredContext?: ActiveContext
  /** Account_Statuses permitted to reach the route. An empty set admits nobody. */
  readonly requiredStatuses: readonly AccountStatus[]
  /**
   * Whether this is an Onboarding_Screen — the Status_Notice, the
   * Verification_Code entry screen and their siblings — which stay reachable
   * while the account is not yet `Approved` (Req 7 AC2).
   */
  readonly onboarding?: boolean
}

/**
 * Access metadata for an Onboarding_Screen.
 *
 * Open to every role and every status so that the Requirement 8 conjunction
 * agrees with the Requirement 7 AC2 gate instead of contradicting it: an
 * Onboarding_Screen is reachable both before approval (through the gate) and
 * after it (through the conjunction).
 */
export const ONBOARDING_SCREEN_ACCESS: RouteAccess = {
  requiredRoles: ROLE_VALUES.values,
  requiredStatuses: ACCOUNT_STATUS_VALUES.values,
  onboarding: true,
}

/**
 * Who is asking: the Access_Token claims the Session_Manager decoded plus the
 * Account_Status retained from `GET /me/status` (Req 7 AC1, Req 8 AC3).
 *
 * `status` is `null` until that call resolves, and is replaced by
 * `details.status` whenever an `account_not_approved` envelope arrives
 * (Req 7 AC6). Both are the caller's concern; this module only reads the value.
 */
export interface AccessSubject {
  /** The `roles` claim: every role the account holds. */
  readonly roles: readonly Role[]
  /** The `act` claim. */
  readonly act: ActiveContext
  /** The retained Account_Status, or `null` while it is not yet known. */
  readonly status: AccountStatus | null
}

/** What the Route_Guard does with a navigation attempt. */
export type RouteAccessOutcome =
  /** Render the route (Req 8 AC3, Req 7 AC2 for Onboarding_Screens). */
  | 'admit'
  /** No Access_Token: send to login, retaining the requested location (Req 8 AC2). */
  | 'redirect-to-login'
  /** Not yet approved and not an Onboarding_Screen (Req 7 AC2). */
  | 'redirect-to-status-notice'
  /** Authenticated but refused: uniform authorization-denied screen (Req 8 AC4). */
  | 'deny'
  /**
   * Authenticated, but `GET /me/status` has not resolved yet, so no gate decision
   * can be taken. The guard shows a loading state (Req 21 AC6) rather than
   * guessing — guessing either leaks a screen the status forbids or bounces an
   * approved user to the Status_Notice.
   */
  | 'await-status'

/** Outcome of the Requirement 7 AC2 onboarding gate. */
export type OnboardingGateOutcome =
  /** An Onboarding_Screen while the account is not `Approved`. */
  | 'admit'
  /** Anything else while the account is not `Approved`. */
  | 'redirect-to-status-notice'
  /** The account is `Approved`: the gate does not apply, Requirement 8 decides. */
  | 'not-gated'

/** Anything carrying route access metadata: a route, a menu destination, a tab. */
export interface RouteAccessCarrier {
  readonly access: RouteAccess
}

// ── The three conjuncts (Req 8 AC3) ───────────────────────────────────────────

/** `roles ∩ requiredRoles ≠ ∅`. */
export function intersectsRequiredRoles(
  roles: readonly Role[] | null | undefined,
  requiredRoles: readonly Role[] | null | undefined,
): boolean {
  if (roles == null || requiredRoles == null || roles.length === 0 || requiredRoles.length === 0) {
    return false
  }
  return requiredRoles.some((required) => roles.includes(required))
}

/** `requiredContext` absent, or equal to the `act` claim. */
export function satisfiesRequiredContext(
  act: ActiveContext | null | undefined,
  requiredContext: ActiveContext | null | undefined,
): boolean {
  if (requiredContext == null) {
    return true
  }
  return act === requiredContext
}

/** Retained Account_Status ∈ `requiredStatuses`; an unknown status satisfies nothing. */
export function satisfiesRequiredStatus(
  status: AccountStatus | null | undefined,
  requiredStatuses: readonly AccountStatus[] | null | undefined,
): boolean {
  if (status == null || requiredStatuses == null) {
    return false
  }
  return requiredStatuses.includes(status)
}

/**
 * The Requirement 8 AC3 admission predicate: the conjunction of the three
 * conjuncts above, and nothing else.
 *
 * This is the whole of Requirement 8's decision. The Requirement 7 onboarding
 * gate sits in front of it ({@link decideRouteAccess}) and is not folded in here,
 * so each requirement stays independently checkable.
 */
export function satisfiesRouteAccess(
  subject: AccessSubject | null | undefined,
  access: RouteAccess,
): boolean {
  if (subject == null) {
    return false
  }
  return (
    intersectsRequiredRoles(subject.roles, access.requiredRoles) &&
    satisfiesRequiredContext(subject.act, access.requiredContext) &&
    satisfiesRequiredStatus(subject.status, access.requiredStatuses)
  )
}

// ── The onboarding gate (Req 7 AC2, AC7) ──────────────────────────────────────

/** Whether the route is one of the Onboarding_Screens. */
export function isOnboardingScreen(access: RouteAccess): boolean {
  return access.onboarding === true
}

/** Whether the retained status opens full navigation (Req 7 AC7). */
export function isApproved(status: AccountStatus | null | undefined): boolean {
  return status === APPROVED_STATUS
}

/**
 * Applies the Requirement 7 AC2 gate.
 *
 * While the retained status is anything other than `Approved`, the target being
 * an Onboarding_Screen is the *only* thing that matters: such a route is
 * admitted, every other route is redirected to the Status_Notice. Role and
 * context are not consulted, because a user who cannot yet reach any feature has
 * nothing to be scoped against — and because the Status_Notice has to stay
 * reachable no matter which status the account is in (Req 7 AC3–AC5).
 *
 * Once the status is `Approved` the gate reports `not-gated` and Requirement 8
 * alone decides (Req 7 AC7).
 */
export function decideOnboardingGate(
  status: AccountStatus | null | undefined,
  access: RouteAccess,
): OnboardingGateOutcome {
  if (isApproved(status)) {
    return 'not-gated'
  }
  return isOnboardingScreen(access) ? 'admit' : 'redirect-to-status-notice'
}

// ── The guard decision ────────────────────────────────────────────────────────

/**
 * The single decision the Route_Guard takes for one navigation attempt.
 *
 * Order matters and follows the requirements: authentication first (Req 8 AC2),
 * then the Account_Status gate (Req 7 AC2), then role/context/status admission
 * (Req 8 AC3), with refusal surfacing as the uniform denied screen (Req 8 AC4).
 *
 * @param subject the authenticated subject, or `null` when no Access_Token is held
 */
export function decideRouteAccess(
  subject: AccessSubject | null | undefined,
  access: RouteAccess,
): RouteAccessOutcome {
  if (subject == null) {
    return 'redirect-to-login'
  }
  if (subject.status == null) {
    return 'await-status'
  }
  const gate = decideOnboardingGate(subject.status, access)
  if (gate !== 'not-gated') {
    return gate
  }
  return satisfiesRouteAccess(subject, access) ? 'admit' : 'deny'
}

/** Whether the guard would render the route for this subject. */
export function isRouteAdmitted(
  subject: AccessSubject | null | undefined,
  access: RouteAccess,
): boolean {
  return decideRouteAccess(subject, access) === 'admit'
}

// ── Navigation_Menu (Req 8 AC5) ───────────────────────────────────────────────

/**
 * One Navigation_Menu entry.
 *
 * `labelKey` is an i18n catalogue key, never a user-visible literal
 * (Req 19 AC2). Consumers may extend this shape — {@link deriveNavigationMenu}
 * preserves whatever extra members a destination carries.
 */
export interface NavigationDestination extends RouteAccessCarrier {
  /** Stable identifier, used as the React key and in tests. */
  readonly id: string
  /** Router path the entry navigates to. */
  readonly path: string
  /** i18n key of the entry's label. */
  readonly labelKey: string
}

/** Whether this destination is presented for the given subject. */
export function isDestinationVisible(
  subject: AccessSubject | null | undefined,
  destination: RouteAccessCarrier,
): boolean {
  return isRouteAdmitted(subject, destination.access)
}

/**
 * Derives the Navigation_Menu: the destinations the Route_Guard would admit for
 * this exact subject, in declaration order (Req 8 AC5).
 *
 * Implemented as a filter over {@link decideRouteAccess} rather than as a second
 * set of rules, which is what makes the menu a subset of the admitted
 * destinations by construction — a destination can never be presented and then
 * refused on arrival. Per-context scoping (Req 8 AC6–AC8) and the
 * "Status_Notice and logout only" rule for `Suspended`/`Rejected`/`Deactivated`
 * (Req 7 AC5) both follow from the metadata each destination declares: no
 * feature destination is an Onboarding_Screen, so while the account is not
 * `Approved` the derived menu is empty.
 */
export function deriveNavigationMenu<TDestination extends RouteAccessCarrier>(
  subject: AccessSubject | null | undefined,
  destinations: readonly TDestination[] | null | undefined,
): readonly TDestination[] {
  if (destinations == null || destinations.length === 0) {
    return []
  }
  return destinations.filter((destination) => isDestinationVisible(subject, destination))
}
