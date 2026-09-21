/**
 * Every route path the Web_Client declares, plus the two location helpers the
 * Route_Guard and the login screen exchange.
 *
 * One module, no React, no router imports: the route tree (`routes.tsx`), the
 * Navigation_Menu catalogue (`destinations.ts`), the guard's redirects
 * (`RouteGuard.tsx`) and every feature slice that navigates all spell a path by
 * reading it from here, so a path exists in exactly one place.
 *
 * ## Why paths are scoped by Active_Context
 *
 * A router maps one path to one element, and the Route_Guard's refusal does not
 * fall through to a later route — so "my profile" cannot be one path that
 * resolves to the Candidate profile in `CANDIDATE` context and to the Senior
 * profile in `SENIOR` context. The two are separate paths under separate
 * prefixes (`/candidate/...`, `/senior/...`, `/admin/...`), and Requirement 8
 * AC6–AC8 are then satisfied by the Navigation_Menu presenting the prefix that
 * matches the Active_Context — see `destinations.ts`.
 *
 * The prefix is a naming convention only. Access is decided exclusively by the
 * {@link import('./access').RouteAccess} metadata declared on the route; a path
 * starting with `/admin` is not privileged by its spelling.
 *
 * Requirements: 8.1, 8.2, 8.6, 8.7, 8.8, 8.11.
 */

import type { ActiveContext } from './access'

// ── The path catalogue ────────────────────────────────────────────────────────

/**
 * Every path in the application, keyed by a stable identifier.
 *
 * Paths are absolute, because that is what `Navigate`, `Link` and the
 * Navigation_Menu need. `routes.tsx` derives the relative segments the nested
 * route tree is declared with through {@link routeSegment}, so the tree and the
 * links cannot drift apart.
 *
 * Parameterized paths carry React Router's `:param` syntax; build a concrete URL
 * with the corresponding helper below rather than by string concatenation.
 */
export const ROUTE_PATHS = {
  /** The context-dependent landing destination (Req 8 AC11). */
  root: '/',

  // Unauthenticated (Req 4 AC1, Req 6).
  login: '/login',
  register: '/register/:token',
  verification: '/verify',

  // Onboarding_Screens (Req 7).
  statusNotice: '/status',

  // Available in every Active_Context once approved.
  account: '/account',
  diagnostics: '/diagnostics',

  // Job_Description browsing, shared by the Candidate and Senior contexts (Req 12).
  jobs: '/jobs',
  jobDetail: '/jobs/:jdId',

  // Candidate context (Req 8 AC6, Req 9, Req 11, Req 14).
  candidateProfile: '/candidate/profile',
  candidateCvs: '/candidate/cvs',
  candidateCvVariant: '/candidate/cvs/:variantId',
  candidateApplications: '/candidate/applications',
  candidateApplicationDetail: '/candidate/applications/:applicationId',

  // Senior context (Req 8 AC7, Req 10, Req 13, Req 14, Req 15).
  seniorProfile: '/senior/profile',
  seniorJobs: '/senior/jobs',
  seniorJobNew: '/senior/jobs/new',
  seniorJobDetail: '/senior/jobs/:jdId',
  seniorApplicants: '/senior/applicants',
  seniorJobApplicants: '/senior/jobs/:jdId/applicants',
  seniorReviews: '/senior/reviews',
  seniorReviewNew: '/senior/reviews/new',

  // Admin role (Req 8 AC8, Req 13, Req 15, Req 16, Req 17, Req 18).
  adminAccounts: '/admin/accounts',
  adminCandidates: '/admin/candidates',
  adminCandidateProfile: '/admin/candidates/:accountId',
  adminCandidateReviews: '/admin/candidates/:accountId/reviews',
  adminSeniorProfile: '/admin/seniors/:accountId',
  adminJobs: '/admin/jobs',
  adminJobNew: '/admin/jobs/new',
  adminJobDetail: '/admin/jobs/:jdId',
  adminApplications: '/admin/applications',
  adminReviews: '/admin/reviews',
  adminAudit: '/admin/audit',
  adminReports: '/admin/reports',
  adminExports: '/admin/exports',
} as const

/** Identifier of a declared path. */
export type RoutePathId = keyof typeof ROUTE_PATHS

/** The login screen, where an unauthenticated navigation attempt lands (Req 8 AC2). */
export const LOGIN_PATH: string = ROUTE_PATHS.login

/** The Status_Notice, where a not-yet-approved attempt lands (Req 7 AC2, AC6). */
export const STATUS_NOTICE_PATH: string = ROUTE_PATHS.statusNotice

/** The Verification_Code entry screen the Status_Notice links to (Req 7 AC4). */
export const VERIFICATION_PATH: string = ROUTE_PATHS.verification

// ── Relative segments for the nested route tree ───────────────────────────────

/**
 * The relative segment `routes.tsx` declares a child route with.
 *
 * React Router resolves a child's path against its parent, so the tree is
 * declared with relative segments while everything that *navigates* uses the
 * absolute path. Deriving one from the other keeps a single source of truth.
 */
export function routeSegment(path: string): string {
  return path.replace(/^\/+/, '')
}

// ── Concrete URLs for parameterized paths ─────────────────────────────────────

/** Encodes one path parameter value into a `:param` template. */
function fillPath(template: string, params: Readonly<Record<string, string>>): string {
  return Object.entries(params).reduce(
    (path, [name, value]) => path.replace(`:${name}`, encodeURIComponent(value)),
    template,
  )
}

/** The registration screen for one registration link token (Req 6 AC1). */
export function registrationPath(token: string): string {
  return fillPath(ROUTE_PATHS.register, { token })
}

/** The Job_Description detail screen (Req 12 AC6). */
export function jobDetailPath(jdId: string): string {
  return fillPath(ROUTE_PATHS.jobDetail, { jdId })
}

/** One CV_Variant of the authenticated Candidate (Req 11). */
export function candidateCvVariantPath(variantId: string): string {
  return fillPath(ROUTE_PATHS.candidateCvVariant, { variantId })
}

/** One Application of the authenticated Candidate (Req 14 AC11). */
export function candidateApplicationPath(applicationId: string): string {
  return fillPath(ROUTE_PATHS.candidateApplicationDetail, { applicationId })
}

/** A Senior's own Job_Description (Req 13). */
export function seniorJobPath(jdId: string): string {
  return fillPath(ROUTE_PATHS.seniorJobDetail, { jdId })
}

/** The applicant list of one of a Senior's Job_Descriptions (Req 14 AC12). */
export function seniorJobApplicantsPath(jdId: string): string {
  return fillPath(ROUTE_PATHS.seniorJobApplicants, { jdId })
}

/** The Admin view of one Candidate's profile (Req 9 AC14). */
export function adminCandidateProfilePath(accountId: string): string {
  return fillPath(ROUTE_PATHS.adminCandidateProfile, { accountId })
}

/** The Admin Review timeline of one Candidate (Req 15 AC8). */
export function adminCandidateReviewsPath(accountId: string): string {
  return fillPath(ROUTE_PATHS.adminCandidateReviews, { accountId })
}

/** The Admin view of one Senior's profile (Req 10 AC12). */
export function adminSeniorProfilePath(accountId: string): string {
  return fillPath(ROUTE_PATHS.adminSeniorProfile, { accountId })
}

/** The Admin view of one Job_Description (Req 13 AC17). */
export function adminJobPath(jdId: string): string {
  return fillPath(ROUTE_PATHS.adminJobDetail, { jdId })
}

// ── Landing destination per Active_Context (Req 8 AC11) ───────────────────────

/**
 * Where a session lands when it is established and after a context switch
 * (Req 8 AC11).
 *
 * One destination per Active_Context, chosen as the screen that context's work
 * starts from: a Candidate browses Job_Descriptions, a Senior manages their own
 * Job_Descriptions, an Admin administers accounts. Each is a destination the
 * Navigation_Menu presents for that context, so the landing is never a screen
 * the guard would refuse.
 */
export const LANDING_PATHS: Readonly<Record<ActiveContext, string>> = Object.freeze({
  CANDIDATE: ROUTE_PATHS.jobs,
  SENIOR: ROUTE_PATHS.seniorJobs,
  ADMIN: ROUTE_PATHS.adminAccounts,
})

/** The landing destination of an Active_Context (Req 8 AC11). */
export function landingPathFor(act: ActiveContext | null | undefined): string {
  if (act == null) {
    return LOGIN_PATH
  }
  return LANDING_PATHS[act] ?? ROUTE_PATHS.account
}

// ── Retaining the requested location across the login redirect (Req 8 AC2) ────

/**
 * The part of a location worth retaining across a login redirect.
 *
 * Path, query and fragment only: a `Location.state` of the refused navigation is
 * deliberately dropped, because it may carry anything the previous screen put
 * there and this value survives an unauthenticated detour through the login
 * screen.
 */
export interface RetainedLocation {
  readonly pathname: string
  readonly search: string
  readonly hash: string
}

/** The `Location.state` the Route_Guard attaches to its login redirect. */
export interface LoginRedirectState {
  /** The location the user asked for and will be returned to after signing in. */
  readonly from: RetainedLocation
}

/** Anything with the location members this module reads. */
type LocationLike = Partial<RetainedLocation>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringMember(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Builds the `Location.state` for the login redirect of Requirement 8 AC2.
 *
 * The guard redirects to the login screen carrying the requested location, and
 * the login screen reads it back with {@link requestedLocationFrom} to navigate
 * there once a session exists. Retaining it in router state rather than in a
 * query parameter keeps it out of the address bar, out of the browser history
 * entry's URL and out of any Backend_Api referrer.
 */
export function loginRedirectState(location: LocationLike): LoginRedirectState {
  return {
    from: {
      pathname: stringMember(location.pathname),
      search: stringMember(location.search),
      hash: stringMember(location.hash),
    },
  }
}

/**
 * The location a login redirect retained, as a URL the router can navigate to,
 * or `null` when the state carries none (Req 8 AC2).
 *
 * Returns `null` for a retained location that is not an in-application absolute
 * path — including a protocol-relative `//host` path — so a crafted state cannot
 * turn the post-login navigation into an open redirect. Also returns `null` for
 * the login screen itself, so signing in never bounces back to it.
 */
export function requestedLocationFrom(state: unknown): string | null {
  if (!isRecord(state) || !isRecord(state.from)) {
    return null
  }
  const { pathname, search, hash } = state.from
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.startsWith('//')) {
    return null
  }
  if (pathname === LOGIN_PATH) {
    return null
  }
  return `${pathname}${stringMember(search)}${stringMember(hash)}`
}

/**
 * Where to navigate after a successful sign-in: the retained location when there
 * is a usable one, else the landing destination of the new Active_Context
 * (Req 8 AC2, AC11).
 */
export function postLoginPath(state: unknown, act: ActiveContext | null | undefined): string {
  return requestedLocationFrom(state) ?? landingPathFor(act)
}
