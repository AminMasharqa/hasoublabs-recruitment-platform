/**
 * Requirement 12 AC11 — no Job_Description on an unauthenticated route.
 *
 * The screens hold no authentication check of their own, by design: both are
 * registered on paths that sit inside a guarded route group, so the Route_Guard
 * decides admission above them and a refused navigation never mounts the element
 * (Req 8 AC4). This test asserts that structure, which is what AC11 rests on:
 *
 * 1. both job paths carry the browsing access metadata — an approved Candidate or
 *    Senior session — and neither is one of the public paths;
 * 2. the two screens are registered on exactly those guarded path identifiers.
 *
 * The redirect itself — a guarded navigation with no session lands on the login
 * screen — is asserted for every guarded path in `routing/routes.test.tsx`.
 */

import { describe, expect, it } from 'vitest'

import { PUBLIC_ROUTE_PATH_IDS, routeAccessFor } from '../../routing/routes'
import { JOB_BROWSING_ACCESS } from '../../routing/routeAccess'
import { SCREEN_ELEMENTS } from '../../shell/screenElements'

import { JobDetailScreen } from './JobDetailScreen'
import { JobsBrowseScreen } from './JobsBrowseScreen'

const JOB_PATH_IDS = ['jobs', 'jobDetail'] as const

describe('the job browsing routes (Req 12 AC11)', () => {
  for (const pathId of JOB_PATH_IDS) {
    it(`guards ${pathId} with an approved Candidate or Senior session`, () => {
      expect(PUBLIC_ROUTE_PATH_IDS).not.toContain(pathId)
      expect(routeAccessFor(pathId)).toBe(JOB_BROWSING_ACCESS)
      expect(JOB_BROWSING_ACCESS.requiredRoles).toEqual(['CANDIDATE', 'SENIOR'])
      expect(JOB_BROWSING_ACCESS.requiredStatuses).toEqual(['Approved'])
    })
  }

  it('registers the two screens on those guarded paths and nowhere else', () => {
    expect(SCREEN_ELEMENTS.jobs?.type).toBe(JobsBrowseScreen)
    expect(SCREEN_ELEMENTS.jobDetail?.type).toBe(JobDetailScreen)

    const publiclyRegistered = PUBLIC_ROUTE_PATH_IDS.filter((pathId) =>
      [JobsBrowseScreen, JobDetailScreen].includes(
        SCREEN_ELEMENTS[pathId]?.type as typeof JobsBrowseScreen,
      ),
    )
    expect(publiclyRegistered).toEqual([])
  })
})
