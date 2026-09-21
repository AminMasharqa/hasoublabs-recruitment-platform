/**
 * Every route the accessibility gate scans, derived from the same source of
 * truth the router itself is built from (Requirement 20 AC13).
 *
 * `src/routing/paths.ts` and `src/routing/routes.tsx` declare the path
 * catalogue and the guarded groups once; this module reads *that* data rather
 * than re-listing paths, so a route added to the application is scanned without
 * this file being told about it by hand, and a route the guard would refuse a
 * given identity is never asked of that identity in the first place — the same
 * `requiredRoles`/`requiredContext` metadata the Route_Guard applies is what
 * selects which identity (if any) can even reach a path.
 *
 * Parameterized paths (`:jdId`, `:accountId`, …) are filled with a placeholder
 * id. The mock backend answers every read with an empty collection or object
 * regardless of the id in the URL, so the placeholder never has to resolve to
 * real data — the screen that renders for an unmatched id is itself one of the
 * accessible states Requirement 21 AC7/AC8 already asks for.
 */

import type { Role } from '../../src/api/enums'
import { GUARDED_ROUTE_GROUPS, PUBLIC_ROUTE_PATH_IDS } from '../../src/routing/routeGroups'
import { ROUTE_PATHS, registrationPath, type RoutePathId } from '../../src/routing/paths'

import { ADMIN_IDENTITY, CANDIDATE_IDENTITY, SENIOR_IDENTITY, type MockIdentity } from './mockBackend'

/** Placeholder id substituted for every `:param` segment. */
const SAMPLE_ID = 'e2e-sample-id'
/** A syntactically plausible Registration_Link token for the public `/register/:token` path. */
const SAMPLE_TOKEN = 'e2e-sample-token'

/** Fills every `:param` segment of a declared path with a scan-safe placeholder. */
function concretePath(pathId: RoutePathId): string {
  if (pathId === 'register') {
    return registrationPath(SAMPLE_TOKEN)
  }
  const template = ROUTE_PATHS[pathId]
  return template.replaceAll(/:[A-Za-z]+/g, SAMPLE_ID)
}

/** One route the gate scans, and the identity (if any) it is scanned as. */
export interface ScannedRoute {
  /** Stable label used in the test title. */
  readonly id: string
  readonly path: string
  /** `null` for a route reachable without signing in. */
  readonly identity: MockIdentity | null
  /**
   * The `GET /me/status` answer the mock backend should give for this scan.
   *
   * Every feature route needs `Approved` to get past the Requirement 7 AC2 gate.
   * The onboarding group is the one exception (Req 7 AC2, AC3): it needs a
   * signed-in session — `/status` is not one of the {@link PUBLIC_ROUTE_PATH_IDS}
   * — but has to be *not yet* `Approved`, or the guard's own gate would redirect
   * an approved session straight past it before it ever renders.
   */
  readonly accountStatus: 'Approved' | 'PendingVerification'
}

/** The three role identities the mock backend can sign in as. */
const IDENTITIES: readonly MockIdentity[] = [CANDIDATE_IDENTITY, SENIOR_IDENTITY, ADMIN_IDENTITY]

/** Whether `identity`'s role set and Active_Context satisfy a group's `RouteAccess`. */
function admits(identity: MockIdentity, requiredRoles: readonly Role[], requiredContext?: Role): boolean {
  const roleMatch = requiredRoles.some((role) => identity.roles.includes(role))
  const contextMatch = requiredContext === undefined || identity.act === requiredContext
  return roleMatch && contextMatch
}

/**
 * Every route the accessibility gate scans, each paired with the one identity
 * (or none) it is reachable under.
 *
 * - The public paths (Req 6 AC1, AC9; Req 4 AC1) are scanned unauthenticated.
 * - The onboarding group is scanned unauthenticated too: Requirement 7 AC2 keeps
 *   it reachable before a session is even approved, and the mock backend's `Approved`
 *   status does not stop the Route_Guard rendering it directly for a signed-out
 *   visitor's own accessibility properties (labels, landmarks, focus order) —
 *   the guard's *redirect* behaviour is exercised by task 11's own tests, not by
 *   this gate.
 * - Every other guarded group is scanned once per identity the group admits, so
 *   `/senior/jobs` is scanned as the Senior identity and never as the Candidate
 *   one, matching Requirement 8 AC6–AC8.
 */
export function scannedRoutes(): readonly ScannedRoute[] {
  const routes: ScannedRoute[] = []

  for (const pathId of PUBLIC_ROUTE_PATH_IDS) {
    routes.push({ id: pathId, path: concretePath(pathId), identity: null, accountStatus: 'Approved' })
  }

  for (const group of GUARDED_ROUTE_GROUPS) {
    if (group.access.onboarding === true) {
      // Signed in (any identity admits — onboarding is open to every role) but not
      // yet Approved, so the Requirement 7 AC2 gate itself is what renders this
      // group rather than redirecting past it.
      for (const pathId of group.pathIds) {
        routes.push({
          id: pathId,
          path: concretePath(pathId),
          identity: CANDIDATE_IDENTITY,
          accountStatus: 'PendingVerification',
        })
      }
      continue
    }
    const admitted = IDENTITIES.filter((identity) =>
      admits(identity, group.access.requiredRoles, group.access.requiredContext),
    )
    for (const identity of admitted) {
      for (const pathId of group.pathIds) {
        routes.push({
          id: `${pathId}-${identity.id}`,
          path: concretePath(pathId),
          identity,
          accountStatus: 'Approved',
        })
      }
    }
  }

  return routes
}
