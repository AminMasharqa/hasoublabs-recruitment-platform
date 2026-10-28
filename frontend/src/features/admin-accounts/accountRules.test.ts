/**
 * Unit tests for the account lifecycle and role rules (task 22.1).
 *
 * Requirement 16:
 * - AC7–AC12 which controls each Account_Status offers, stated as the table the
 *   requirement states it as.
 * - AC8, AC10 the reason bounds of each transition that carries one.
 * - AC13, AC14 what the role control may submit, and the Admin-exclusivity block.
 * - AC16 which transitions may only be issued from a confirmation dialog.
 */

import { describe, expect, it } from 'vitest'

import {
  canSubmitRoleSet,
  combinesAdminWithOtherRole,
  isSameRoleSet,
  lifecycleActionsFor,
  normalizeRoleSet,
  offersLifecycleAction,
  reasonBoundsFor,
  REJECT_REASON_BOUNDS,
  replaceAccount,
  requiresConfirmation,
  requiresReason,
  roleSetRefusal,
  roleUpdateBody,
  SUSPEND_REASON_BOUNDS,
  validateLifecycleReason,
  type Account,
  type LifecycleAction,
} from './accountRules'

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: 'a1',
    email: 'person@example.com',
    roles: ['CANDIDATE'],
    status: 'Approved',
    language_preference: 'ar',
    mfa_enrolled: false,
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

// ── AC7–AC12: the status-to-control table ─────────────────────────────────────

describe('lifecycleActionsFor (Req 16 AC7–AC12)', () => {
  it('offers exactly the transitions each status names', () => {
    expect(lifecycleActionsFor('PendingVerification')).toEqual(['reject'])
    expect(lifecycleActionsFor('PendingApproval')).toEqual(['approve', 'reject'])
    expect(lifecycleActionsFor('ApprovedPendingMeeting')).toEqual(['record-meeting', 'reject'])
    expect(lifecycleActionsFor('Approved')).toEqual(['suspend', 'deactivate'])
    expect(lifecycleActionsFor('Suspended')).toEqual(['reactivate', 'deactivate'])
    expect(lifecycleActionsFor('Rejected')).toEqual(['reopen'])
  })

  it('offers nothing for a Deactivated account', () => {
    expect(lifecycleActionsFor('Deactivated')).toEqual([])
  })

  it('offers nothing for a status the contract does not declare', () => {
    expect(lifecycleActionsFor('Archived')).toEqual([])
    expect(lifecycleActionsFor(null)).toEqual([])
    expect(lifecycleActionsFor(undefined)).toEqual([])
  })

  it('offers approve only from PendingApproval', () => {
    expect(offersLifecycleAction('PendingApproval', 'approve')).toBe(true)
    expect(offersLifecycleAction('ApprovedPendingMeeting', 'approve')).toBe(false)
    expect(offersLifecycleAction('Approved', 'approve')).toBe(false)
  })

  it('offers reject from each of the three statuses AC8 names, and nowhere else', () => {
    for (const status of ['PendingVerification', 'PendingApproval', 'ApprovedPendingMeeting']) {
      expect(offersLifecycleAction(status, 'reject')).toBe(true)
    }
    for (const status of ['Approved', 'Rejected', 'Suspended', 'Deactivated']) {
      expect(offersLifecycleAction(status, 'reject')).toBe(false)
    }
  })

  it('offers deactivate from Approved and Suspended only (AC10, AC11)', () => {
    expect(offersLifecycleAction('Approved', 'deactivate')).toBe(true)
    expect(offersLifecycleAction('Suspended', 'deactivate')).toBe(true)
    expect(offersLifecycleAction('PendingApproval', 'deactivate')).toBe(false)
  })
})

// ── AC16: confirmation ────────────────────────────────────────────────────────

describe('requiresConfirmation (Req 16 AC16)', () => {
  it('demands a confirmation for exactly reject, suspend and deactivate', () => {
    const confirmed: LifecycleAction[] = ['reject', 'suspend', 'deactivate']
    const direct: LifecycleAction[] = ['approve', 'record-meeting', 'reactivate', 'reopen']
    for (const action of confirmed) {
      expect(requiresConfirmation(action), action).toBe(true)
    }
    for (const action of direct) {
      expect(requiresConfirmation(action), action).toBe(false)
    }
  })
})

// ── AC8, AC10: reasons ────────────────────────────────────────────────────────

describe('reason bounds (Req 16 AC8, AC10)', () => {
  it('asks for 10 to 500 characters on a rejection', () => {
    expect(reasonBoundsFor('reject')).toEqual({ minLength: 10, maxLength: 500 })
  })

  it('asks for 1 to 500 characters on a suspension and a deactivation', () => {
    expect(reasonBoundsFor('suspend')).toEqual({ minLength: 1, maxLength: 500 })
    expect(reasonBoundsFor('deactivate')).toEqual({ minLength: 1, maxLength: 500 })
  })

  it('asks for no reason on the four bodyless transitions', () => {
    for (const action of ['approve', 'record-meeting', 'reactivate', 'reopen'] as LifecycleAction[]) {
      expect(reasonBoundsFor(action), action).toBeNull()
      expect(requiresReason(action), action).toBe(false)
    }
  })
})

describe('validateLifecycleReason (Req 16 AC8, AC10)', () => {
  it('refuses a rejection reason shorter than the bound and accepts one at it', () => {
    const short = 'x'.repeat(REJECT_REASON_BOUNDS.minLength - 1)
    expect(validateLifecycleReason('reject', short)).toMatchObject({
      path: 'reason',
      code: 'too_short',
    })
    expect(validateLifecycleReason('reject', 'x'.repeat(REJECT_REASON_BOUNDS.minLength))).toBeNull()
  })

  it('accepts a single character as a suspension reason', () => {
    expect(validateLifecycleReason('suspend', 'x')).toBeNull()
    expect(validateLifecycleReason('deactivate', 'x')).toBeNull()
  })

  it('refuses a reason beyond the shared upper bound', () => {
    const long = 'x'.repeat(SUSPEND_REASON_BOUNDS.maxLength + 1)
    expect(validateLifecycleReason('suspend', long)).toMatchObject({ code: 'too_long' })
    expect(validateLifecycleReason('reject', long)).toMatchObject({ code: 'too_long' })
  })

  it('refuses a blank reason', () => {
    expect(validateLifecycleReason('suspend', '   ')).toMatchObject({ code: 'required' })
    expect(validateLifecycleReason('reject', '')).toMatchObject({ code: 'required' })
  })

  it('counts code points, so an emoji reason is not measured in UTF-16 units', () => {
    // Ten astral characters are ten code points and twenty code units; the
    // rejection bound is ten, so this is exactly long enough.
    expect(validateLifecycleReason('reject', '😀'.repeat(10))).toBeNull()
    expect(validateLifecycleReason('reject', '😀'.repeat(9))).toMatchObject({ code: 'too_short' })
  })

  it('yields nothing for a transition that carries no reason', () => {
    expect(validateLifecycleReason('reopen', '')).toBeNull()
    expect(validateLifecycleReason('approve', undefined)).toBeNull()
  })
})

// ── AC13, AC14: the role control ──────────────────────────────────────────────

describe('combinesAdminWithOtherRole (Req 16 AC14)', () => {
  it('holds exactly when ADMIN appears alongside another role', () => {
    expect(combinesAdminWithOtherRole(['ADMIN', 'CANDIDATE'])).toBe(true)
    expect(combinesAdminWithOtherRole(['SENIOR', 'ADMIN'])).toBe(true)
    expect(combinesAdminWithOtherRole(['ADMIN', 'CANDIDATE', 'SENIOR'])).toBe(true)
    expect(combinesAdminWithOtherRole(['ADMIN'])).toBe(false)
    expect(combinesAdminWithOtherRole(['ADMIN', 'ADMIN'])).toBe(false)
    expect(combinesAdminWithOtherRole(['CANDIDATE', 'SENIOR'])).toBe(false)
    expect(combinesAdminWithOtherRole([])).toBe(false)
  })
})

describe('normalizeRoleSet', () => {
  it('drops duplicates, unknown values and preserves the contract order', () => {
    expect(normalizeRoleSet(['SENIOR', 'CANDIDATE', 'SENIOR', 'MODERATOR'])).toEqual([
      'CANDIDATE',
      'SENIOR',
    ])
    expect(normalizeRoleSet(null)).toEqual([])
  })

  it('compares role sets by membership rather than by order', () => {
    expect(isSameRoleSet(['SENIOR', 'CANDIDATE'], ['CANDIDATE', 'SENIOR'])).toBe(true)
    expect(isSameRoleSet(['CANDIDATE'], ['CANDIDATE', 'SENIOR'])).toBe(false)
  })
})

describe('roleSetRefusal (Req 16 AC13, AC14)', () => {
  it('refuses ADMIN combined with another role', () => {
    expect(roleSetRefusal(account({ roles: ['CANDIDATE'] }), ['ADMIN', 'CANDIDATE'])).toBe(
      'admin_exclusive',
    )
    expect(canSubmitRoleSet(account({ roles: ['CANDIDATE'] }), ['ADMIN', 'CANDIDATE'])).toBe(false)
  })

  it('refuses an empty target set', () => {
    expect(roleSetRefusal(account(), [])).toBe('empty')
  })

  it('refuses a target set the account already holds', () => {
    expect(roleSetRefusal(account({ roles: ['CANDIDATE', 'SENIOR'] }), ['SENIOR', 'CANDIDATE'])).toBe(
      'unchanged',
    )
  })

  it('admits a changed, exclusive-safe target set', () => {
    expect(roleSetRefusal(account({ roles: ['CANDIDATE'] }), ['CANDIDATE', 'SENIOR'])).toBeNull()
    expect(roleSetRefusal(account({ roles: ['CANDIDATE'] }), ['ADMIN'])).toBeNull()
  })

  it('submits the complete target set in contract order', () => {
    expect(roleUpdateBody(['SENIOR', 'CANDIDATE', 'SENIOR'])).toEqual({
      roles: ['CANDIDATE', 'SENIOR'],
    })
  })
})

// ── The cache write behind AC15 ───────────────────────────────────────────────

describe('replaceAccount (Req 16 AC15)', () => {
  it('replaces the matching account and leaves the order and the rest intact', () => {
    const page = [account({ id: 'a1' }), account({ id: 'a2', status: 'PendingApproval' })]
    const updated = account({ id: 'a2', status: 'Approved' })

    expect(replaceAccount(page, updated)).toEqual([page[0], updated])
  })

  it('leaves a page that does not hold the account untouched', () => {
    const page = [account({ id: 'a1' })]
    expect(replaceAccount(page, account({ id: 'other' }))).toEqual(page)
    expect(replaceAccount(undefined, account())).toBeUndefined()
  })
})
