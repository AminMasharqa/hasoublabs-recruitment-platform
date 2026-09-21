import { describe, expect, it } from 'vitest'

import type { AccessSubject, NavigationDestination, RouteAccess } from './access'
import {
  ACCOUNT_STATUS_VALUES,
  APPROVED_STATUS,
  decideOnboardingGate,
  decideRouteAccess,
  deriveNavigationMenu,
  intersectsRequiredRoles,
  isApproved,
  isOnboardingScreen,
  isRouteAdmitted,
  ONBOARDING_SCREEN_ACCESS,
  satisfiesRequiredContext,
  satisfiesRequiredStatus,
  satisfiesRouteAccess,
} from './access'

const APPROVED_ONLY = [APPROVED_STATUS] as const

const candidateProfile: RouteAccess = {
  requiredRoles: ['CANDIDATE'],
  requiredContext: 'CANDIDATE',
  requiredStatuses: APPROVED_ONLY,
}

const seniorJobs: RouteAccess = {
  requiredRoles: ['SENIOR'],
  requiredContext: 'SENIOR',
  requiredStatuses: APPROVED_ONLY,
}

const adminAccounts: RouteAccess = {
  requiredRoles: ['ADMIN'],
  requiredContext: 'ADMIN',
  requiredStatuses: APPROVED_ONLY,
}

/** Any authenticated role, any context: browsing is open to every approved user. */
const jobBrowsing: RouteAccess = {
  requiredRoles: ['ADMIN', 'CANDIDATE', 'SENIOR'],
  requiredStatuses: APPROVED_ONLY,
}

function subject(over: Partial<AccessSubject> = {}): AccessSubject {
  return { roles: ['CANDIDATE'], act: 'CANDIDATE', status: APPROVED_STATUS, ...over }
}

describe('the three conjuncts (Req 8 AC3)', () => {
  it('requires a non-empty role intersection', () => {
    expect(intersectsRequiredRoles(['CANDIDATE', 'SENIOR'], ['SENIOR'])).toBe(true)
    expect(intersectsRequiredRoles(['CANDIDATE'], ['SENIOR', 'ADMIN'])).toBe(false)
    expect(intersectsRequiredRoles([], ['CANDIDATE'])).toBe(false)
    expect(intersectsRequiredRoles(['CANDIDATE'], [])).toBe(false)
  })

  it('treats an absent required context as satisfied', () => {
    expect(satisfiesRequiredContext('SENIOR', undefined)).toBe(true)
    expect(satisfiesRequiredContext('SENIOR', 'SENIOR')).toBe(true)
    expect(satisfiesRequiredContext('SENIOR', 'CANDIDATE')).toBe(false)
  })

  it('requires membership of the declared status set', () => {
    expect(satisfiesRequiredStatus('Approved', APPROVED_ONLY)).toBe(true)
    expect(satisfiesRequiredStatus('PendingApproval', APPROVED_ONLY)).toBe(false)
    expect(satisfiesRequiredStatus(null, ACCOUNT_STATUS_VALUES.values)).toBe(false)
    expect(satisfiesRequiredStatus('Approved', [])).toBe(false)
  })

  it('admits only when all three hold', () => {
    expect(satisfiesRouteAccess(subject(), candidateProfile)).toBe(true)
    // Role held, but acting in the other context.
    expect(
      satisfiesRouteAccess(subject({ roles: ['CANDIDATE', 'SENIOR'], act: 'SENIOR' }), candidateProfile),
    ).toBe(false)
    // Right context, role missing.
    expect(satisfiesRouteAccess(subject({ roles: ['SENIOR'] }), candidateProfile)).toBe(false)
    // Role and context fine, status not yet approved.
    expect(satisfiesRouteAccess(subject({ status: 'ApprovedPendingMeeting' }), candidateProfile)).toBe(
      false,
    )
    expect(satisfiesRouteAccess(null, candidateProfile)).toBe(false)
  })
})

describe('the onboarding gate (Req 7 AC2, AC7)', () => {
  const notApproved = ACCOUNT_STATUS_VALUES.values.filter((status) => status !== APPROVED_STATUS)

  it('admits only Onboarding_Screens while the status is not Approved', () => {
    expect(notApproved.length).toBeGreaterThan(0)
    for (const status of notApproved) {
      expect(isApproved(status)).toBe(false)
      expect(decideOnboardingGate(status, ONBOARDING_SCREEN_ACCESS)).toBe('admit')
      for (const access of [candidateProfile, seniorJobs, adminAccounts, jobBrowsing]) {
        expect(decideOnboardingGate(status, access)).toBe('redirect-to-status-notice')
      }
    }
  })

  it('stops applying once the status is Approved', () => {
    expect(decideOnboardingGate(APPROVED_STATUS, candidateProfile)).toBe('not-gated')
    expect(decideOnboardingGate(APPROVED_STATUS, ONBOARDING_SCREEN_ACCESS)).toBe('not-gated')
  })

  it('marks Onboarding_Screens as open to every role and status', () => {
    expect(isOnboardingScreen(ONBOARDING_SCREEN_ACCESS)).toBe(true)
    expect(isOnboardingScreen(candidateProfile)).toBe(false)
    // So the Req 8 conjunction agrees with the gate rather than contradicting it.
    for (const status of ACCOUNT_STATUS_VALUES.values) {
      expect(satisfiesRouteAccess(subject({ status }), ONBOARDING_SCREEN_ACCESS)).toBe(true)
    }
  })
})

describe('decideRouteAccess', () => {
  it('redirects to login when no Access_Token is held (Req 8 AC2)', () => {
    expect(decideRouteAccess(null, candidateProfile)).toBe('redirect-to-login')
    expect(decideRouteAccess(undefined, ONBOARDING_SCREEN_ACCESS)).toBe('redirect-to-login')
  })

  it('waits for the retained status before deciding', () => {
    expect(decideRouteAccess(subject({ status: null }), candidateProfile)).toBe('await-status')
  })

  it('redirects an unapproved session to the Status_Notice (Req 7 AC2)', () => {
    expect(decideRouteAccess(subject({ status: 'PendingVerification' }), candidateProfile)).toBe(
      'redirect-to-status-notice',
    )
    expect(decideRouteAccess(subject({ status: 'Suspended' }), jobBrowsing)).toBe(
      'redirect-to-status-notice',
    )
    expect(decideRouteAccess(subject({ status: 'PendingVerification' }), ONBOARDING_SCREEN_ACCESS)).toBe(
      'admit',
    )
  })

  it('denies an approved session the route refuses (Req 8 AC4)', () => {
    expect(decideRouteAccess(subject(), adminAccounts)).toBe('deny')
    expect(decideRouteAccess(subject({ roles: ['ADMIN'], act: 'ADMIN' }), candidateProfile)).toBe(
      'deny',
    )
  })

  it('admits an approved session the route permits (Req 7 AC7)', () => {
    expect(decideRouteAccess(subject(), candidateProfile)).toBe('admit')
    expect(decideRouteAccess(subject({ roles: ['SENIOR'], act: 'SENIOR' }), seniorJobs)).toBe('admit')
    expect(decideRouteAccess(subject({ roles: ['ADMIN'], act: 'ADMIN' }), adminAccounts)).toBe('admit')
    expect(isRouteAdmitted(subject(), jobBrowsing)).toBe(true)
  })
})

describe('deriveNavigationMenu (Req 8 AC5)', () => {
  const destinations: readonly NavigationDestination[] = [
    { id: 'candidate-profile', path: '/profile', labelKey: 'nav.profile', access: candidateProfile },
    { id: 'jobs', path: '/jobs', labelKey: 'nav.jobs', access: jobBrowsing },
    { id: 'senior-jobs', path: '/my-jobs', labelKey: 'nav.myJobs', access: seniorJobs },
    { id: 'admin-accounts', path: '/admin/accounts', labelKey: 'nav.accounts', access: adminAccounts },
  ]

  const idsFor = (over: Partial<AccessSubject>) =>
    deriveNavigationMenu(subject(over), destinations).map((destination) => destination.id)

  it('presents only the destinations the guard admits, in declaration order', () => {
    expect(idsFor({ roles: ['CANDIDATE'], act: 'CANDIDATE' })).toEqual(['candidate-profile', 'jobs'])
    expect(idsFor({ roles: ['SENIOR'], act: 'SENIOR' })).toEqual(['jobs', 'senior-jobs'])
    expect(idsFor({ roles: ['ADMIN'], act: 'ADMIN' })).toEqual(['jobs', 'admin-accounts'])
  })

  it('scopes a dual-role account to the Active_Context (Req 8 AC6, AC7)', () => {
    const roles = ['CANDIDATE', 'SENIOR'] as const
    expect(idsFor({ roles, act: 'CANDIDATE' })).toEqual(['candidate-profile', 'jobs'])
    expect(idsFor({ roles, act: 'SENIOR' })).toEqual(['jobs', 'senior-jobs'])
  })

  it('presents nothing before approval or without a session', () => {
    expect(idsFor({ status: 'PendingApproval' })).toEqual([])
    expect(idsFor({ status: 'Deactivated' })).toEqual([])
    expect(idsFor({ status: null })).toEqual([])
    expect(deriveNavigationMenu(null, destinations)).toEqual([])
  })

  it('is a subset of the admitted destinations', () => {
    const menu = deriveNavigationMenu(subject(), destinations)
    expect(menu.every((destination) => isRouteAdmitted(subject(), destination.access))).toBe(true)
    expect(deriveNavigationMenu(subject(), [])).toEqual([])
    expect(deriveNavigationMenu(subject(), null)).toEqual([])
  })
})
