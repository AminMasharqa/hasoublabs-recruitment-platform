/**
 * The route access catalogue: every guarded group and the public path list
 * (Requirement 7, Requirement 8 AC1).
 *
 * Split out of `routes.tsx` on purpose. That module also declares the actual
 * `RouteObject` tree, which imports `RouteGuard.tsx` and `placeholders.tsx` —
 * both of which eventually pull in Mantine components and a stylesheet
 * (`DirectionProvider.tsx`'s `./direction.css`). Data-only consumers of the
 * catalogue must not be forced to load a CSS module through that chain: the
 * accessibility gate's route catalogue (`e2e/a11y/routeCatalogue.ts`, Requirement
 * 20 AC13) runs under Playwright's Node-based test loader, which has no CSS
 * transform and fails outright on a bare stylesheet import. Every export here is
 * plain data and reaches nothing that renders, the same reasoning
 * `routeAccess.ts`'s own module comment gives for keeping the presets out of a
 * module that pulls in React elements.
 *
 * `routes.tsx` re-exports everything below unchanged, so no existing caller of
 * `GUARDED_ROUTE_GROUPS`, `PUBLIC_ROUTE_PATH_IDS` or `routeAccessFor` has to
 * change its import.
 */

import { ONBOARDING_SCREEN_ACCESS, type RouteAccess } from './access'
import type { RoutePathId } from './paths'
import {
  ADMIN_ACCESS,
  ANY_CONTEXT_ACCESS,
  CANDIDATE_ACCESS,
  JOB_BROWSING_ACCESS,
  SENIOR_ACCESS,
} from './routeAccess'

/** One guarded group: a set of paths sharing one {@link RouteAccess}. */
export interface RouteGroup {
  /** Stable identifier, used as the React key and in tests. */
  readonly id: string
  /** What the Route_Guard requires of every path in the group (Req 8 AC1). */
  readonly access: RouteAccess
  /** Whether the group carries the index route of the application (Req 8 AC11). */
  readonly index?: boolean
  /** The paths in the group, as `ROUTE_PATHS` identifiers (`./paths`). */
  readonly pathIds: readonly RoutePathId[]
}

/**
 * The paths reachable without an Access_Token.
 *
 * Deliberately short: login (Req 4 AC1), the registration link screen (Req 6
 * AC1) and the Verification_Code entry screen (Req 6 AC9). The last one is public
 * because a registrant enters the code before they have ever signed in; the
 * Status_Notice links to the same screen for a `PendingVerification` session
 * (Req 7 AC4), and it exposes nothing beyond what a holder of the code and the
 * account id already has.
 */
export const PUBLIC_ROUTE_PATH_IDS: readonly RoutePathId[] = Object.freeze([
  'login',
  'register',
  'verification',
])

/**
 * Every guarded group, in matching order.
 *
 * Order is immaterial to access — React Router ranks matches by specificity, and
 * the guard decides from metadata, not from position — but is kept in the reading
 * order of the requirements: onboarding, session-wide, browsing, then the three
 * contexts.
 */
export const GUARDED_ROUTE_GROUPS: readonly RouteGroup[] = Object.freeze([
  {
    // Req 7 AC2: reachable while the account is not yet Approved.
    id: 'onboarding',
    access: ONBOARDING_SCREEN_ACCESS,
    pathIds: ['statusNotice'],
  },
  {
    // Any approved session, whatever its role or Active_Context.
    id: 'session',
    access: ANY_CONTEXT_ACCESS,
    index: true,
    pathIds: ['account', 'diagnostics'],
  },
  {
    // Req 12: Job_Description browsing, shared by the Candidate and Senior contexts.
    id: 'job-browsing',
    access: JOB_BROWSING_ACCESS,
    pathIds: ['jobs', 'jobDetail'],
  },
  {
    // Req 8 AC6.
    id: 'candidate',
    access: CANDIDATE_ACCESS,
    pathIds: [
      'candidateProfile',
      'candidateCvs',
      'candidateCvVariant',
      'candidateApplications',
      'candidateApplicationDetail',
    ],
  },
  {
    // Req 8 AC7.
    id: 'senior',
    access: SENIOR_ACCESS,
    pathIds: [
      'seniorProfile',
      'seniorJobs',
      'seniorJobNew',
      'seniorJobDetail',
      'seniorApplicants',
      'seniorJobApplicants',
      'seniorReviews',
      'seniorReviewNew',
    ],
  },
  {
    // Req 8 AC8.
    id: 'admin',
    access: ADMIN_ACCESS,
    pathIds: [
      'adminAccounts',
      'adminCandidates',
      'adminCandidateProfile',
      'adminCandidateReviews',
      'adminSeniorProfile',
      'adminJobs',
      'adminJobNew',
      'adminJobDetail',
      'adminApplications',
      'adminReviews',
      'adminAudit',
      'adminReports',
      'adminExports',
    ],
  },
])

/**
 * The access metadata declared on a path, or `null` when the path is public
 * (Req 8 AC1).
 *
 * Lets a feature check the same requirement the guard will apply — before
 * offering a control that navigates there, for instance — without duplicating it.
 */
export function routeAccessFor(pathId: RoutePathId): RouteAccess | null {
  const group = GUARDED_ROUTE_GROUPS.find((candidate) => candidate.pathIds.includes(pathId))
  return group === undefined ? null : group.access
}
