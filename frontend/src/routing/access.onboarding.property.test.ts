import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { AccountStatus, Role } from '../api/enums'
import { ROLE_VALUES } from '../forms/validators'
import type { AccessSubject, ActiveContext, RouteAccess } from './access'
import {
  ACCOUNT_STATUS_VALUES,
  APPROVED_STATUS,
  decideOnboardingGate,
  decideRouteAccess,
  isOnboardingScreen,
  ONBOARDING_SCREEN_ACCESS,
} from './access'

/**
 * Property 6 covers {@link decideOnboardingGate} — the Requirement 7 AC2 gate on
 * its own. The Requirement 8 AC3 conjunction that sits behind it is Property 7's
 * subject and lives in `access.admission.property.test.ts`: the gate deliberately
 * ignores roles and Active_Context, so driving both through one oracle would make
 * each contradict the other.
 */

/** Every role, from the contract-derived set. */
const role: fc.Arbitrary<Role> = fc.constantFrom(...ROLE_VALUES.values)

/** Every Account_Status the contract declares. */
const accountStatus: fc.Arbitrary<AccountStatus> = fc.constantFrom(...ACCOUNT_STATUS_VALUES.values)

/** Every Active_Context, i.e. every value the `act` claim can carry. */
const activeContext: fc.Arbitrary<ActiveContext> = role

/**
 * The retained status, `null` included: the gate is asked about it before
 * `GET /me/status` resolves too, and "not yet known" is not `Approved`.
 */
const retainedStatus: fc.Arbitrary<AccountStatus | null> = fc.option(accountStatus, { nil: null })

/** An arbitrary role set, empty included — the gate must not consult it either way. */
const roleSet: fc.Arbitrary<readonly Role[]> = fc.array(role, { minLength: 0, maxLength: 5 })

/** An arbitrary required-status set, empty included. */
const statusSet: fc.Arbitrary<readonly AccountStatus[]> = fc.array(accountStatus, {
  minLength: 0,
  maxLength: 8,
})

/**
 * Arbitrary route metadata, onboarding and not.
 *
 * `requiredContext` and `onboarding` are absent as often as they are present, so
 * that "no flag declared" is exercised as a case distinct from `onboarding: false`
 * — both have to mean "not an Onboarding_Screen".
 */
const routeAccess: fc.Arbitrary<RouteAccess> = fc
  .record({
    requiredRoles: roleSet,
    requiredContext: fc.option(activeContext, { nil: undefined }),
    requiredStatuses: statusSet,
    onboarding: fc.option(fc.boolean(), { nil: undefined }),
  })
  .map(({ requiredRoles, requiredContext, requiredStatuses, onboarding }) => {
    const access: RouteAccess = { requiredRoles, requiredStatuses }
    return {
      ...access,
      ...(requiredContext === undefined ? {} : { requiredContext }),
      ...(onboarding === undefined ? {} : { onboarding }),
    }
  })

/**
 * Route metadata biased towards the two shapes the gate distinguishes: a declared
 * Onboarding_Screen and everything else. Including {@link ONBOARDING_SCREEN_ACCESS}
 * verbatim keeps the shape the application actually ships inside the generated
 * space, rather than only synthetic look-alikes.
 */
const gatedRouteAccess: fc.Arbitrary<RouteAccess> = fc.oneof(
  routeAccess,
  fc.constant(ONBOARDING_SCREEN_ACCESS),
  routeAccess.map((access) => ({ ...access, onboarding: true })),
)

describe('onboarding gate properties', () => {
  // Feature: frontend-web-application, Property 6: Onboarding gating admits only
  // Onboarding_Screens — For any retained Account_Status other than `Approved`
  // and any target route, the Route_Guard admits the navigation if and only if
  // the target route is an Onboarding_Screen, and otherwise redirects to the
  // Status_Notice screen.
  //
  // **Validates: Requirements 7.2**
  it('admits a route before approval if and only if it is an Onboarding_Screen', () => {
    fc.assert(
      fc.property(
        retainedStatus,
        gatedRouteAccess,
        roleSet,
        activeContext,
        (status, access, roles, act) => {
          const outcome = decideOnboardingGate(status, access)

          // The oracle, stated without reusing the module's own predicates: an
          // Onboarding_Screen is a route whose `onboarding` member is literally
          // `true`, and approval is the exact value `Approved`.
          const isOnboarding = access.onboarding === true
          const approved = status === 'Approved'

          if (approved) {
            // Req 7 AC7: the gate stops applying and Requirement 8 alone decides.
            expect(outcome).toBe('not-gated')
          } else {
            // Req 7 AC2: the biconditional. Admission before approval is exactly
            // "the target is an Onboarding_Screen"; every other attempt is
            // redirected to the Status_Notice, with no third outcome.
            expect(outcome).toBe(isOnboarding ? 'admit' : 'redirect-to-status-notice')
            expect(outcome === 'admit').toBe(isOnboarding)
          }

          // The gate's only two inputs are the status and the onboarding flag:
          // flipping the flag flips the verdict while the account is not
          // approved, and changes nothing once it is.
          const flipped = decideOnboardingGate(status, { ...access, onboarding: !isOnboarding })
          expect(flipped).toBe(
            approved ? 'not-gated' : isOnboarding ? 'redirect-to-status-notice' : 'admit',
          )

          // Neither the required role set, nor the required status set, nor the
          // required context participates: the gate is taken ahead of the
          // Requirement 8 conjunction, so emptying them cannot change it.
          expect(
            decideOnboardingGate(status, {
              ...access,
              requiredRoles: [],
              requiredStatuses: [],
              requiredContext: 'ADMIN',
            }),
          ).toBe(approved ? 'not-gated' : isOnboarding ? 'admit' : 'redirect-to-status-notice')

          // `isOnboardingScreen` is the gate's notion of the target, so an absent
          // flag and an explicit `false` are the same non-onboarding route.
          expect(isOnboardingScreen(access)).toBe(isOnboarding)

          // The gate as the Route_Guard applies it: an authenticated subject
          // whose retained status is known but not `Approved` never reaches a
          // non-onboarding route, whatever its roles and Active_Context say, and
          // an approved one is never bounced to the Status_Notice.
          if (status !== null) {
            const subject: AccessSubject = { roles, act, status }
            const guarded = decideRouteAccess(subject, access)
            if (status === APPROVED_STATUS) {
              expect(guarded).not.toBe('redirect-to-status-notice')
            } else {
              expect(guarded).toBe(isOnboarding ? 'admit' : 'redirect-to-status-notice')
            }
          }
        },
      ),
      { numRuns: 500 },
    )
  })
})
