import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { AccountStatus, Role } from '../api/enums'
import { ROLE_VALUES } from '../forms/validators'
import type { AccessSubject, ActiveContext, RouteAccess } from './access'
import {
  ACCOUNT_STATUS_VALUES,
  APPROVED_STATUS,
  decideRouteAccess,
  satisfiesRouteAccess,
} from './access'

/**
 * Property 7 covers {@link satisfiesRouteAccess} — the Requirement 8 AC3
 * conjunction on its own. The Requirement 7 AC2 onboarding gate that sits in
 * front of it is Property 6's subject and lives in its own file: folding the two
 * into one oracle makes them contradict each other, since the gate admits an
 * Onboarding_Screen that the conjunction may refuse and refuses feature routes
 * the conjunction may admit.
 */

/** Every role, from the contract-derived set. */
const role: fc.Arbitrary<Role> = fc.constantFrom(...ROLE_VALUES.values)

/** Every Account_Status the contract declares. */
const accountStatus: fc.Arbitrary<AccountStatus> = fc.constantFrom(...ACCOUNT_STATUS_VALUES.values)

/** Every Active_Context, i.e. every value the `act` claim can carry. */
const activeContext: fc.Arbitrary<ActiveContext> = role

/**
 * An arbitrary role set, empty included and duplicates allowed.
 *
 * The empty set matters on both sides of the intersection: a claimless principal
 * must reach nothing, and a route declaring no roles must admit nobody.
 * Duplicates matter because the predicate is about membership, not multiplicity.
 */
const roleSet: fc.Arbitrary<readonly Role[]> = fc.array(role, { minLength: 0, maxLength: 5 })

/** An arbitrary required-status set, empty included and duplicates allowed. */
const statusSet: fc.Arbitrary<readonly AccountStatus[]> = fc.array(accountStatus, {
  minLength: 0,
  maxLength: 8,
})

/** A principal: the `roles` and `act` claims plus the retained status, or `null` for "not yet known". */
const principal: fc.Arbitrary<AccessSubject> = fc.record({
  roles: roleSet,
  act: activeContext,
  status: fc.option(accountStatus, { nil: null }),
})

/**
 * Arbitrary route access metadata: any required role set, `requiredContext`
 * present or absent, any required status set, and either onboarding flag — the
 * conjunction must ignore the flag entirely.
 */
const routeAccess: fc.Arbitrary<RouteAccess> = fc
  .record({
    requiredRoles: roleSet,
    requiredContext: fc.option(activeContext, { nil: undefined }),
    requiredStatuses: statusSet,
    onboarding: fc.option(fc.boolean(), { nil: undefined }),
  })
  .map(({ requiredRoles, requiredContext, requiredStatuses, onboarding }) => {
    // `requiredContext` absent has to mean the member is missing, not present
    // and `undefined`, so that the "absent" branch is genuinely exercised.
    const access: RouteAccess = { requiredRoles, requiredStatuses }
    return {
      ...access,
      ...(requiredContext === undefined ? {} : { requiredContext }),
      ...(onboarding === undefined ? {} : { onboarding }),
    }
  })

/**
 * The conjunction restated independently of the implementation: a locally
 * computed set intersection, an equality, and a locally built membership set.
 * Calling the three exported conjuncts here would only restate the code under
 * test back to itself.
 */
function admissionOracle(subject: AccessSubject, access: RouteAccess): boolean {
  const heldRoles = new Set<string>(subject.roles)
  const roleIntersection = access.requiredRoles.filter((required) => heldRoles.has(required))
  const rolesIntersect = roleIntersection.length > 0

  const contextMatches =
    access.requiredContext === undefined || access.requiredContext === subject.act

  const permittedStatuses = new Set<string>(access.requiredStatuses)
  const statusPermitted = subject.status !== null && permittedStatuses.has(subject.status)

  return rolesIntersect && contextMatches && statusPermitted
}

describe('route admission properties', () => {
  // Feature: frontend-web-application, Property 7: Route admission equals the
  // role/context/status conjunction — For any principal (`roles`, `act`,
  // retained status) and any route access metadata, the Route_Guard admits the
  // navigation if and only if `roles` intersects the required role set, the
  // required context is absent or equals `act`, and the retained status is a
  // member of the required status set; when it refuses, the route's request is
  // never issued.
  //
  // **Validates: Requirements 8.3, 8.4**
  it('admits if and only if roles intersect, context matches and status is permitted', () => {
    fc.assert(
      fc.property(principal, routeAccess, (subject, access) => {
        const admitted = satisfiesRouteAccess(subject, access)

        // The biconditional: admission is exactly the three-way conjunction.
        expect(admitted).toBe(admissionOracle(subject, access))

        // Each conjunct is necessary: negating any one of them refuses, whatever
        // the other two say.
        if (access.requiredRoles.every((required) => !subject.roles.includes(required))) {
          expect(admitted).toBe(false)
        }
        if (access.requiredContext !== undefined && access.requiredContext !== subject.act) {
          expect(admitted).toBe(false)
        }
        if (subject.status === null || !access.requiredStatuses.includes(subject.status)) {
          expect(admitted).toBe(false)
        }

        // Nothing outside the three conjuncts participates: flipping the
        // onboarding flag cannot change the Requirement 8 verdict.
        expect(satisfiesRouteAccess(subject, { ...access, onboarding: !access.onboarding })).toBe(
          admitted,
        )

        // Req 8 AC4: for a principal past the Requirement 7 gate, a refusal is
        // the uniform authorization-denied outcome and never a render, so the
        // refused route's element — and therefore its request — never mounts.
        if (subject.status === APPROVED_STATUS) {
          expect(decideRouteAccess(subject, access)).toBe(admitted ? 'admit' : 'deny')
        }
      }),
      { numRuns: 500 },
    )
  })
})
