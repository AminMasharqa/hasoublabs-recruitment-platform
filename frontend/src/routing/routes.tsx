/**
 * The declarative route tree: nested layouts, route access metadata and the
 * `createBrowserRouter` instance (Requirement 1 AC5, Requirement 8).
 *
 * ## Shape
 *
 * ```
 * /                                  root layout (the application shell)
 * ├── login, register/:token, verify  unauthenticated, no guard
 * ├── RouteGuard(Onboarding)          layout route → /status
 * ├── RouteGuard(any approved)        layout route → index redirect, /account, /diagnostics
 * ├── RouteGuard(job browsing)        layout route → /jobs, /jobs/:jdId
 * ├── RouteGuard(Candidate context)   layout route → /candidate/...
 * ├── RouteGuard(Senior context)      layout route → /senior/...
 * ├── RouteGuard(Admin role)          layout route → /admin/...
 * └── *                               not found
 * ```
 *
 * Each guarded group is a **pathless layout route** whose element is one
 * {@link RouteGuard} carrying that group's {@link RouteAccess}. The decision is
 * therefore taken once per group, above every screen in it, and a screen cannot
 * be reached without it — which is what makes Requirement 8 AC4 structural: a
 * refused group renders the denied surface *instead of* its `Outlet`, so the
 * target's element never mounts and its request is never issued.
 *
 * For the same reason this tree declares **no `loader` and no `action`**. A router
 * loader runs *before* the matched element renders and is not subject to the
 * guard, so moving a screen's fetch into one would issue the refused route's
 * request and break AC4. Screens fetch from inside their own element, under the
 * guard.
 *
 * ## Route access metadata as data
 *
 * The groups are declared in {@link GUARDED_ROUTE_GROUPS} as plain data, so the
 * access metadata of every path is readable — and assertable — without rendering
 * anything, and so `destinations.ts` and this tree draw their requirements from
 * the same presets in `routeAccess.ts`. That shared origin is what makes the
 * Navigation_Menu a subset of the admitted routes (Req 8 AC5) rather than a
 * parallel list that has to be kept in step by hand.
 *
 * ## Placeholders
 *
 * Most feature slices do not exist yet (tasks 14–24). Every route below whose
 * screen is unbuilt renders {@link PlaceholderScreen}; the paths, the nesting and
 * the access metadata are final. A feature task replaces its element either by
 * editing the {@link screenElements} table here or by passing `elements` to
 * {@link appRoutes}, and changes nothing about the guarding.
 *
 * Placeholder routes, with the task that fills each in:
 * - `/login` (14.1), `/register/:token` (15.1), `/verify` (15.2)
 * - `/status` (15.3)
 * - `/account` (14.2), `/diagnostics` (12.3)
 * - `/candidate/applications`, `/candidate/applications/:applicationId` (20.1)
 * - `/senior/profile` (16.2), `/senior/jobs`, `/senior/jobs/new`, `/senior/jobs/:jdId` (19.1)
 * - `/senior/applicants`, `/senior/jobs/:jdId/applicants` (20.1)
 * - `/senior/reviews`, `/senior/reviews/new` (21.1)
 * - `/admin/accounts`, `/admin/candidates` (22.1)
 * - `/admin/candidates/:accountId/reviews`, `/admin/reviews` (21.1)
 * - `/admin/seniors/:accountId` (16.2), `/admin/jobs`, `/admin/jobs/new`, `/admin/jobs/:jdId` (19.1)
 * - `/admin/applications` (20.1), `/admin/audit` (23.1), `/admin/reports`, `/admin/exports` (24.1)
 *
 * Requirements: 1.5, 7.2, 8.1, 8.2, 8.3, 8.4, 8.6, 8.7, 8.8.
 */

import type { ReactElement } from 'react'
import { createBrowserRouter, type RouteObject } from 'react-router-dom'

import type { ApiClient } from '../api/client'

import { NotFoundScreen, PlaceholderScreen, RoutedOutlet } from './placeholders'
import { LandingRedirect, RouteGuard } from './RouteGuard'
import { ROUTE_PATHS, routeSegment, type RoutePathId } from './paths'

// Route access metadata — the guarded groups, the public path list and
// `routeAccessFor` — lives in `routeGroups.ts`, a module with no JSX and no
// stylesheet import, and is re-exported here for every existing caller. See that
// module's own note for why the split matters: it lets the group data be read by
// something that renders no React tree at all, such as the accessibility gate's
// route catalogue in `e2e/a11y/routeCatalogue.ts` (Requirement 20 AC13).
export {
  GUARDED_ROUTE_GROUPS,
  PUBLIC_ROUTE_PATH_IDS,
  routeAccessFor,
  type RouteGroup,
} from './routeGroups'
import { GUARDED_ROUTE_GROUPS, PUBLIC_ROUTE_PATH_IDS, type RouteGroup } from './routeGroups'

// ── Elements ──────────────────────────────────────────────────────────────────

/**
 * Catalogue key used as the heading of each path's placeholder, so an unbuilt
 * screen still names the destination it stands in for (Req 19 AC2).
 */
const PLACEHOLDER_LABEL_KEYS: Partial<Readonly<Record<RoutePathId, string>>> = Object.freeze({
  login: 'shell:session.signIn',
  register: 'shell:route.registration',
  verification: 'shell:route.verification',
  statusNotice: 'shell:route.statusNotice',
  account: 'shell:nav.account',
  diagnostics: 'shell:nav.diagnostics',
  jobs: 'shell:nav.jobs',
  jobDetail: 'shell:nav.jobs',
  candidateProfile: 'shell:nav.profile',
  candidateCvs: 'shell:nav.cvs',
  candidateCvVariant: 'shell:nav.cvs',
  candidateApplications: 'shell:nav.applications',
  candidateApplicationDetail: 'shell:nav.applications',
  seniorProfile: 'shell:nav.profile',
  seniorJobs: 'shell:nav.myJobs',
  seniorJobNew: 'shell:nav.myJobs',
  seniorJobDetail: 'shell:nav.myJobs',
  seniorApplicants: 'shell:nav.applicants',
  seniorJobApplicants: 'shell:nav.applicants',
  seniorReviews: 'shell:nav.reviews',
  seniorReviewNew: 'shell:nav.reviews',
  adminAccounts: 'shell:nav.accounts',
  adminCandidates: 'shell:nav.candidates',
  adminCandidateProfile: 'shell:nav.candidates',
  adminCandidateReviews: 'shell:nav.reviews',
  adminSeniorProfile: 'shell:nav.candidates',
  adminJobs: 'shell:nav.jobs',
  adminJobNew: 'shell:nav.jobs',
  adminJobDetail: 'shell:nav.jobs',
  adminApplications: 'shell:nav.applications',
  adminReviews: 'shell:nav.reviews',
  adminAudit: 'shell:nav.audit',
  adminReports: 'shell:nav.reports',
  adminExports: 'shell:nav.exports',
})

/** Elements supplied per path, overriding the placeholder. */
export type ScreenElements = Partial<Readonly<Record<RoutePathId, ReactElement>>>

/** The element one path renders: the supplied one, else its placeholder. */
function screenElement(pathId: RoutePathId, elements: ScreenElements): ReactElement {
  return elements[pathId] ?? <PlaceholderScreen labelKey={PLACEHOLDER_LABEL_KEYS[pathId]} />
}

// ── The tree ──────────────────────────────────────────────────────────────────

export interface AppRoutesOptions {
  /**
   * The Api_Client the Route_Guard issues `GET /me/status` with (Req 7 AC1).
   *
   * Passed to every guard: whichever group the user lands on first is the one
   * that has to read the status, and the read is deduplicated per account in
   * `accountStatus.ts`.
   */
  readonly api?: ApiClient | null
  /**
   * The root layout element — the application shell (task 12.1), which composes
   * the providers, the chrome and the recovery boundary around the routed
   * `Outlet`.
   *
   * Defaults to {@link RoutedOutlet}, a minimal stand-in carrying the boundary
   * and nothing else.
   */
  readonly shellElement?: ReactElement
  /** Real screens for paths whose feature slice exists. */
  readonly elements?: ScreenElements
}

/**
 * Builds the route tree.
 *
 * Exported separately from {@link createAppRouter} so a test can mount it in a
 * memory router, and so the shell can compose it into a larger tree if it ever
 * needs to.
 */
export function appRoutes(options: AppRoutesOptions = {}): RouteObject[] {
  const { api = null, shellElement, elements = {} } = options

  const child = (pathId: RoutePathId): RouteObject => ({
    path: routeSegment(ROUTE_PATHS[pathId]),
    element: screenElement(pathId, elements),
  })

  const guardedGroup = (group: RouteGroup): RouteObject => ({
    // A pathless layout route: it contributes no URL segment and exists solely to
    // decide admission for its children (Req 8 AC1).
    element: <RouteGuard access={group.access} api={api} />,
    children: [
      ...(group.index === true ? [{ index: true, element: <LandingRedirect /> }] : []),
      ...group.pathIds.map(child),
    ],
  })

  return [
    {
      path: ROUTE_PATHS.root,
      element: shellElement ?? <RoutedOutlet />,
      children: [
        ...PUBLIC_ROUTE_PATH_IDS.map(child),
        ...GUARDED_ROUTE_GROUPS.map(guardedGroup),
        { path: '*', element: <NotFoundScreen /> },
      ],
    },
  ]
}

export interface CreateAppRouterOptions extends AppRoutesOptions {
  /** Sub-path the application is served from, when it is not the origin root. */
  readonly basename?: string
}

/**
 * Creates the browser data router the shell renders (Requirement 1 AC5).
 *
 * One instance per browsing context, created by the shell after it has built the
 * Api_Client and the Session_Manager — the guard needs the client to read
 * `GET /me/status` (Req 7 AC1).
 */
export function createAppRouter(
  options: CreateAppRouterOptions = {},
): ReturnType<typeof createBrowserRouter> {
  const { basename, ...routeOptions } = options
  return createBrowserRouter(
    appRoutes(routeOptions),
    basename === undefined ? undefined : { basename },
  )
}
