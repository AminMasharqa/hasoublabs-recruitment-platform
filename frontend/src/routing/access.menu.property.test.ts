import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { AccountStatus, Role } from '../api/enums'
import { ROLE_VALUES } from '../forms/validators'
import type {
  AccessSubject,
  ActiveContext,
  NavigationDestination,
  RouteAccess,
  RouteAccessCarrier,
} from './access'
import {
  ACCOUNT_STATUS_VALUES,
  APPROVED_STATUS,
  decideRouteAccess,
  deriveNavigationMenu,
  isDestinationVisible,
  isRouteAdmitted,
  ONBOARDING_SCREEN_ACCESS,
} from './access'

/**
 * Property 8 is a relation between two exported functions rather than a claim
 * about one of them: whatever {@link deriveNavigationMenu} presents,
 * {@link isRouteAdmitted} must also admit. The oracle is therefore the guard
 * itself — that is the whole point of the requirement (Req 8 AC5), since a menu
 * derived from a second, parallel set of rules is exactly the failure mode being
 * ruled out (a destination presented and then refused on arrival).
 *
 * Properties 6 and 7 pin down *what* the guard admits; this file only checks that
 * the menu tracks it, so the arbitraries below deliberately range over subjects
 * and catalogues that the guard refuses as often as it admits.
 */

/** Every role, from the contract-derived set. */
const role: fc.Arbitrary<Role> = fc.constantFrom(...ROLE_VALUES.values)

/** Every Account_Status the contract declares. */
const accountStatus: fc.Arbitrary<AccountStatus> = fc.constantFrom(...ACCOUNT_STATUS_VALUES.values)

/** Every Active_Context, i.e. every value the `act` claim can carry. */
const activeContext: fc.Arbitrary<ActiveContext> = role

/** An arbitrary role set, empty included and duplicates allowed. */
const roleSet: fc.Arbitrary<readonly Role[]> = fc.array(role, { minLength: 0, maxLength: 4 })

/** An arbitrary required-status set, empty included and duplicates allowed. */
const statusSet: fc.Arbitrary<readonly AccountStatus[]> = fc.array(accountStatus, {
  minLength: 0,
  maxLength: 8,
})

/**
 * A principal, or `null` for "no Access_Token held". `status: null` models the
 * window before `GET /me/status` resolves, where no destination may be presented
 * yet.
 */
const subject: fc.Arbitrary<AccessSubject | null> = fc.option(
  fc.record({
    roles: roleSet,
    act: activeContext,
    status: fc.option(accountStatus, { nil: null }),
  }),
  { nil: null },
)

/** Arbitrary access metadata, with `requiredContext`/`onboarding` present or absent. */
const routeAccess: fc.Arbitrary<RouteAccess> = fc
  .record({
    requiredRoles: roleSet,
    requiredContext: fc.option(activeContext, { nil: undefined }),
    requiredStatuses: statusSet,
    onboarding: fc.option(fc.boolean(), { nil: undefined }),
  })
  .map(({ requiredRoles, requiredContext, requiredStatuses, onboarding }) => ({
    requiredRoles,
    requiredStatuses,
    // Absent has to mean "member missing", not "member present and undefined".
    ...(requiredContext === undefined ? {} : { requiredContext }),
    ...(onboarding === undefined ? {} : { onboarding }),
  }))

/**
 * A destination carrying a member the menu type knows nothing about.
 * `deriveNavigationMenu` is generic over the carrier, so consumers can hang
 * icons, badges or nested children off a destination and expect them back.
 */
interface TestDestination extends NavigationDestination {
  readonly badge: number
}

/**
 * A destination catalogue in declaration order. Ids are made unique by position
 * so that "declaration order preserved" and "no duplicates introduced" are
 * observable, and so a failing counter-example names the offending entry.
 */
const destinationCatalogue: fc.Arbitrary<readonly TestDestination[]> = fc
  .array(fc.record({ access: routeAccess, badge: fc.integer() }), { minLength: 0, maxLength: 12 })
  .map((entries) =>
    entries.map(({ access, badge }, index) => ({
      id: `destination-${index}`,
      path: `/destination-${index}`,
      labelKey: `shell.nav.destination-${index}`,
      access,
      badge,
    })),
  )

/** Positions of `menu`'s entries within `catalogue`, by identity. */
function positionsIn<T>(catalogue: readonly T[], menu: readonly T[]): readonly number[] {
  return menu.map((entry) => catalogue.indexOf(entry))
}

describe('Navigation_Menu derivation properties', () => {
  // Feature: frontend-web-application, Property 8: The Navigation_Menu is a
  // subset of admitted destinations — For any principal, every destination the
  // Navigation_Menu presents is one the Route_Guard would admit for that same
  // principal.
  //
  // **Validates: Requirements 8.5**
  it('presents exactly the destinations the Route_Guard would admit, in declaration order', () => {
    fc.assert(
      fc.property(subject, destinationCatalogue, (principal, catalogue) => {
        const menu = deriveNavigationMenu(principal, catalogue)

        // The property proper: every presented destination is admitted, i.e. the
        // menu is a subset of what the guard lets through.
        for (const destination of menu) {
          expect(catalogue).toContain(destination)
          expect(isRouteAdmitted(principal, destination.access)).toBe(true)
          expect(decideRouteAccess(principal, destination.access)).toBe('admit')
        }

        // And nothing admitted is withheld, so the subset is the whole of it.
        const admitted = catalogue.filter((destination) =>
          isRouteAdmitted(principal, destination.access),
        )
        expect(menu).toHaveLength(admitted.length)
        menu.forEach((destination, index) => {
          // `toBe`, not `toEqual`: the entries are the catalogue objects
          // themselves, so extra members survive and React keys stay stable.
          expect(destination).toBe(admitted[index])
          expect(destination.badge).toBe(admitted[index]?.badge)
        })
        for (const destination of catalogue) {
          if (!menu.includes(destination)) {
            expect(isRouteAdmitted(principal, destination.access)).toBe(false)
          }
        }

        // `isDestinationVisible` is the per-entry form of the same decision, so
        // a component asking about one destination agrees with the derived menu.
        for (const destination of catalogue) {
          expect(isDestinationVisible(principal, destination)).toBe(menu.includes(destination))
        }

        // Declaration order is preserved and no entry is duplicated: positions
        // within the catalogue increase strictly.
        const positions = positionsIn(catalogue, menu)
        for (let index = 1; index < positions.length; index += 1) {
          expect(positions[index]).toBeGreaterThan(positions[index - 1] as number)
        }

        // An empty or absent catalogue yields an empty menu rather than throwing,
        // and an anonymous visitor is presented nothing at all (Req 8 AC2).
        expect(deriveNavigationMenu(principal, [])).toStrictEqual([])
        expect(deriveNavigationMenu(principal, null)).toStrictEqual([])
        expect(deriveNavigationMenu(principal, undefined)).toStrictEqual([])
        expect(deriveNavigationMenu(null, catalogue)).toStrictEqual([])
        expect(deriveNavigationMenu(undefined, catalogue)).toStrictEqual([])

        if (principal !== null && principal.status !== APPROVED_STATUS) {
          // Req 7 AC2/AC5 seen from the menu: before approval only
          // Onboarding_Screens may appear, so a catalogue of feature
          // destinations derives an empty menu.
          for (const destination of menu) {
            expect(destination.access.onboarding).toBe(true)
          }
          const featureDestinations = catalogue.filter(
            (destination) => destination.access.onboarding !== true,
          )
          expect(deriveNavigationMenu(principal, featureDestinations)).toStrictEqual([])
        }

        if (principal !== null && principal.status !== null && principal.roles.length > 0) {
          // The converse guard against an over-eager filter: a catalogue of
          // Onboarding_Screens is presented in full to any role-holding account
          // with a known status, whether or not that account is approved.
          const onboardingCatalogue: readonly RouteAccessCarrier[] = catalogue.map(
            (destination) => ({ ...destination, access: ONBOARDING_SCREEN_ACCESS }),
          )
          expect(deriveNavigationMenu(principal, onboardingCatalogue)).toStrictEqual(
            onboardingCatalogue,
          )
        }
      }),
      { numRuns: 300 },
    )
  })
})
