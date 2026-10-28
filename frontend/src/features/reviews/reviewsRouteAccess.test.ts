/**
 * Requirement 15 AC7, AC9 and AC10 — who reaches a Review_Timeline.
 *
 * None of the four review screens holds a role or context check of its own, by
 * design: each is registered on a path inside a guarded route group, so the
 * Route_Guard decides admission above it and a refused navigation never mounts the
 * element (Req 8 AC4). This test asserts that structure, which is what the three
 * clauses rest on:
 *
 * 1. the two Admin timeline paths carry the Admin access metadata (AC7);
 * 2. the two Senior paths carry the Senior-context metadata, so a Senior reads
 *    only through the own-only endpoint (AC9);
 * 3. no route in the tree renders a Review_Timeline under the Candidate context,
 *    and no Navigation_Menu destination points at one (AC10).
 *
 * The redirect itself — a guarded navigation with no session lands on the login
 * screen — is asserted for every guarded path in `routing/routes.test.tsx`.
 */

import { describe, expect, it } from 'vitest'

import { CONTEXT_DESTINATION_IDS, NAVIGATION_DESTINATIONS } from '../../routing/destinations'
import { ADMIN_ACCESS, SENIOR_ACCESS } from '../../routing/routeAccess'
import { PUBLIC_ROUTE_PATH_IDS, routeAccessFor } from '../../routing/routes'
import { SCREEN_ELEMENTS } from '../../shell/screenElements'

import { AdminCandidateReviewsScreen } from './AdminCandidateReviewsScreen'
import { AdminReviewsScreen } from './AdminReviewsScreen'
import { SeniorReviewNewScreen } from './SeniorReviewNewScreen'
import { SeniorReviewsScreen } from './SeniorReviewsScreen'

const ADMIN_PATH_IDS = ['adminReviews', 'adminCandidateReviews'] as const
const SENIOR_PATH_IDS = ['seniorReviews', 'seniorReviewNew'] as const

describe('the Admin Review_Timeline routes (Req 15 AC7)', () => {
  for (const pathId of ADMIN_PATH_IDS) {
    it(`guards ${pathId} with the Admin role`, () => {
      expect(PUBLIC_ROUTE_PATH_IDS).not.toContain(pathId)
      expect(routeAccessFor(pathId)).toBe(ADMIN_ACCESS)
      expect(ADMIN_ACCESS.requiredRoles).toEqual(['ADMIN'])
      expect(ADMIN_ACCESS.requiredStatuses).toEqual(['Approved'])
    })
  }

  it('registers the two Admin screens on those guarded paths', () => {
    expect(SCREEN_ELEMENTS.adminReviews?.type).toBe(AdminReviewsScreen)
    expect(SCREEN_ELEMENTS.adminCandidateReviews?.type).toBe(AdminCandidateReviewsScreen)
  })
})

describe('the Senior Review routes (Req 15 AC9)', () => {
  for (const pathId of SENIOR_PATH_IDS) {
    it(`guards ${pathId} with the Senior Active_Context`, () => {
      expect(PUBLIC_ROUTE_PATH_IDS).not.toContain(pathId)
      expect(routeAccessFor(pathId)).toBe(SENIOR_ACCESS)
      expect(SENIOR_ACCESS.requiredContext).toBe('SENIOR')
      expect(SENIOR_ACCESS.requiredStatuses).toEqual(['Approved'])
    })
  }

  it('registers the two Senior screens on those guarded paths', () => {
    expect(SCREEN_ELEMENTS.seniorReviews?.type).toBe(SeniorReviewsScreen)
    expect(SCREEN_ELEMENTS.seniorReviewNew?.type).toBe(SeniorReviewNewScreen)
  })
})

describe('no Review_Timeline in the Candidate context (Req 15 AC10)', () => {
  it('registers no review screen on a path the Candidate context admits', () => {
    const reviewScreens = [
      AdminReviewsScreen,
      AdminCandidateReviewsScreen,
      SeniorReviewsScreen,
      SeniorReviewNewScreen,
    ]
    const candidateRegistered = Object.entries(SCREEN_ELEMENTS).filter(([pathId, element]) => {
      if (!reviewScreens.includes(element.type as typeof AdminReviewsScreen)) {
        return false
      }
      const access = routeAccessFor(pathId as keyof typeof SCREEN_ELEMENTS)
      return access === null || access.requiredContext === 'CANDIDATE'
    })

    expect(candidateRegistered).toEqual([])
  })

  it('presents no review destination in the Candidate Navigation_Menu', () => {
    expect(CONTEXT_DESTINATION_IDS.CANDIDATE).not.toContain('senior-reviews')
    expect(CONTEXT_DESTINATION_IDS.CANDIDATE).not.toContain('admin-reviews')

    const reviewDestinations = NAVIGATION_DESTINATIONS.filter(
      (destination) => destination.labelKey === 'shell:nav.reviews',
    )
    expect(reviewDestinations.length).toBeGreaterThan(0)
    for (const destination of reviewDestinations) {
      expect(destination.access.requiredContext).not.toBe('CANDIDATE')
      expect(destination.access.requiredRoles).not.toContain('CANDIDATE')
    }
  })
})
