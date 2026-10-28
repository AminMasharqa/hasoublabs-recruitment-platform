/**
 * The Navigation_Menu destination catalogue (Requirement 8 AC5–AC8).
 *
 * `deriveNavigationMenu` filters this list through the same
 * {@link import('./access').decideRouteAccess} the Route_Guard applies, so what
 * the menu presents is by construction a subset of what the guard admits
 * (AC5) — there is no second rule set that could disagree with the routes.
 *
 * Which destinations exist per Active_Context (AC6, AC7, AC8) is therefore a
 * property of *this catalogue* rather than of the filter: each entry declares the
 * role, Active_Context and Account_Status it needs, and the filter does the
 * scoping. The three per-context expectations are asserted directly in
 * {@link CONTEXT_DESTINATION_IDS}, so a destination that drifts out of its
 * context fails a test rather than shipping.
 *
 * Every label is a catalogue key, never a literal (Requirement 19 AC2), and every
 * path comes from `paths.ts`.
 *
 * Requirements: 8.5, 8.6, 8.7, 8.8.
 */

import type { NavigationDestination } from './access'
import { ROUTE_PATHS } from './paths'
import {
  ADMIN_ACCESS,
  ANY_CONTEXT_ACCESS,
  CANDIDATE_ACCESS,
  JOB_BROWSING_ACCESS,
  SENIOR_ACCESS,
} from './routeAccess'

/**
 * One Navigation_Menu entry.
 *
 * Extends the base {@link NavigationDestination} with the prefix-matching rule
 * the menu uses to mark the current entry: `exact` entries are current only on
 * their own path, the rest are also current on their descendants, so
 * `/senior/jobs/{id}` keeps "My job descriptions" marked as the current
 * destination.
 */
export interface AppDestination extends NavigationDestination {
  /** Mark as current only for an exact path match. Defaults to prefix matching. */
  readonly exact?: boolean
}

/**
 * Whether a location belongs to a destination, i.e. whether the menu marks that
 * entry as the current one.
 *
 * A prefix match by path *segment*, so `/senior/jobs/{id}` keeps the
 * `/senior/jobs` entry current while `/senior/jobsearch` — a different
 * destination that merely shares a string prefix — does not. An `exact`
 * destination matches only itself.
 */
export function isCurrentDestination(
  pathname: string,
  destination: Pick<AppDestination, 'path' | 'exact'>,
): boolean {
  if (pathname === destination.path) {
    return true
  }
  if (destination.exact === true) {
    return false
  }
  const prefix = destination.path.endsWith('/') ? destination.path : `${destination.path}/`
  return pathname.startsWith(prefix)
}

/**
 * Every destination the Navigation_Menu may present, in the order it presents
 * them.
 *
 * Declaration order is the rendering order (`deriveNavigationMenu` preserves it),
 * and the list is grouped by Active_Context: no session sees more than one group
 * plus the shared entries, because the groups' `requiredContext` conjuncts are
 * mutually exclusive.
 */
export const NAVIGATION_DESTINATIONS: readonly AppDestination[] = Object.freeze([
  // ── Candidate context (AC6) ────────────────────────────────────────────────
  {
    id: 'candidate-profile',
    path: ROUTE_PATHS.candidateProfile,
    labelKey: 'shell:nav.profile',
    access: CANDIDATE_ACCESS,
  },
  {
    id: 'candidate-cvs',
    path: ROUTE_PATHS.candidateCvs,
    labelKey: 'shell:nav.cvs',
    access: CANDIDATE_ACCESS,
  },
  {
    id: 'candidate-applications',
    path: ROUTE_PATHS.candidateApplications,
    labelKey: 'shell:nav.applications',
    access: CANDIDATE_ACCESS,
  },

  // ── Senior context (AC7) ──────────────────────────────────────────────────
  {
    id: 'senior-profile',
    path: ROUTE_PATHS.seniorProfile,
    labelKey: 'shell:nav.profile',
    access: SENIOR_ACCESS,
  },
  {
    id: 'senior-jobs',
    path: ROUTE_PATHS.seniorJobs,
    labelKey: 'shell:nav.myJobs',
    access: SENIOR_ACCESS,
  },
  {
    id: 'senior-applicants',
    path: ROUTE_PATHS.seniorApplicants,
    labelKey: 'shell:nav.applicants',
    access: SENIOR_ACCESS,
  },
  {
    id: 'senior-reviews',
    path: ROUTE_PATHS.seniorReviews,
    labelKey: 'shell:nav.reviews',
    access: SENIOR_ACCESS,
  },

  // ── Job_Description browsing, both non-Admin contexts (AC6, AC7) ──────────
  {
    id: 'jobs',
    path: ROUTE_PATHS.jobs,
    labelKey: 'shell:nav.jobs',
    access: JOB_BROWSING_ACCESS,
  },

  // ── Admin role (AC8) ──────────────────────────────────────────────────────
  {
    id: 'admin-accounts',
    path: ROUTE_PATHS.adminAccounts,
    labelKey: 'shell:nav.accounts',
    access: ADMIN_ACCESS,
  },
  {
    id: 'admin-candidates',
    path: ROUTE_PATHS.adminCandidates,
    labelKey: 'shell:nav.candidates',
    access: ADMIN_ACCESS,
  },
  {
    id: 'admin-jobs',
    path: ROUTE_PATHS.adminJobs,
    labelKey: 'shell:nav.jobs',
    access: ADMIN_ACCESS,
  },
  {
    id: 'admin-applications',
    path: ROUTE_PATHS.adminApplications,
    labelKey: 'shell:nav.applications',
    access: ADMIN_ACCESS,
  },
  {
    id: 'admin-reviews',
    path: ROUTE_PATHS.adminReviews,
    labelKey: 'shell:nav.reviews',
    access: ADMIN_ACCESS,
  },
  {
    id: 'admin-audit',
    path: ROUTE_PATHS.adminAudit,
    labelKey: 'shell:nav.audit',
    access: ADMIN_ACCESS,
  },
  {
    id: 'admin-reports',
    path: ROUTE_PATHS.adminReports,
    labelKey: 'shell:nav.reports',
    access: ADMIN_ACCESS,
  },
  {
    id: 'admin-exports',
    path: ROUTE_PATHS.adminExports,
    labelKey: 'shell:nav.exports',
    access: ADMIN_ACCESS,
  },

  // ── Shared by every approved session ──────────────────────────────────────
  {
    id: 'account',
    path: ROUTE_PATHS.account,
    labelKey: 'shell:nav.account',
    access: ANY_CONTEXT_ACCESS,
  },
  {
    id: 'diagnostics',
    path: ROUTE_PATHS.diagnostics,
    labelKey: 'shell:nav.diagnostics',
    access: ANY_CONTEXT_ACCESS,
  },
])

/**
 * The destinations each Active_Context must present, as Requirement 8 AC6–AC8
 * enumerate them, plus the two shared entries.
 *
 * Stated here rather than only in a test so the requirement's enumeration lives
 * next to the catalogue it constrains; `NavigationMenu` does not read it.
 */
export const CONTEXT_DESTINATION_IDS = Object.freeze({
  /** AC6: Candidate profile, CV_Variants, Job_Description browsing, own Applications. */
  CANDIDATE: Object.freeze([
    'candidate-profile',
    'candidate-cvs',
    'candidate-applications',
    'jobs',
    'account',
    'diagnostics',
  ]),
  /** AC7: Senior profile, own Job_Descriptions, browsing, applicants, own Reviews. */
  SENIOR: Object.freeze([
    'senior-profile',
    'senior-jobs',
    'senior-applicants',
    'senior-reviews',
    'jobs',
    'account',
    'diagnostics',
  ]),
  /** AC8: accounts, Candidate directory, Job_Descriptions, Applications, Reviews, Audit_Log, reports, exports. */
  ADMIN: Object.freeze([
    'admin-accounts',
    'admin-candidates',
    'admin-jobs',
    'admin-applications',
    'admin-reviews',
    'admin-audit',
    'admin-reports',
    'admin-exports',
    'account',
    'diagnostics',
  ]),
})
