/**
 * Who may switch Active_Context (Requirement 8 AC10, AC12).
 *
 * The predicate is the whole of AC12's enforcement — the control, the
 * `POST /auth/context` request and the token adoption are all downstream of it —
 * so it is asserted over every role set that can occur, including the two that
 * make AC10 and AC12 both apply at once.
 */

import { describe, expect, it } from 'vitest'

import type { Role } from '../api/enums'
import { ROLE_VALUES } from '../forms/validators'

import { canSwitchContext, contextSwitchTargets, isDualRole } from './contextTargets'

/** Every subset of the three roles, so no combination is left unasserted. */
function roleSubsets(): readonly Role[][] {
  const roles = ROLE_VALUES.values
  const subsets: Role[][] = []
  for (let mask = 0; mask < 1 << roles.length; mask += 1) {
    subsets.push(roles.filter((_, index) => (mask & (1 << index)) !== 0))
  }
  return subsets
}

describe('canSwitchContext (Requirement 8 AC10, AC12)', () => {
  it('admits exactly the dual-role non-Admin role set', () => {
    for (const roles of roleSubsets()) {
      const dualRole = roles.includes('CANDIDATE') && roles.includes('SENIOR')
      const admin = roles.includes('ADMIN')
      expect(canSwitchContext(roles), roles.join('+') || '(no roles)').toBe(dualRole && !admin)
    }
  })

  it('refuses every role set containing the Admin role, dual-role included', () => {
    for (const roles of roleSubsets().filter((subset) => subset.includes('ADMIN'))) {
      expect(canSwitchContext(roles), roles.join('+')).toBe(false)
    }
  })

  it('refuses a single-role account', () => {
    expect(canSwitchContext(['CANDIDATE'])).toBe(false)
    expect(canSwitchContext(['SENIOR'])).toBe(false)
  })

  it('refuses an absent session', () => {
    expect(canSwitchContext([])).toBe(false)
  })
})

describe('isDualRole', () => {
  it('reports the Candidate-and-Senior test alone, ignoring the Admin role', () => {
    expect(isDualRole(['CANDIDATE', 'SENIOR'])).toBe(true)
    expect(isDualRole(['ADMIN', 'CANDIDATE', 'SENIOR'])).toBe(true)
    expect(isDualRole(['CANDIDATE'])).toBe(false)
  })
})

describe('contextSwitchTargets (Requirement 8 AC10, AC12)', () => {
  it('offers the other context, never the Active_Context itself', () => {
    expect(contextSwitchTargets(['CANDIDATE', 'SENIOR'], 'CANDIDATE')).toEqual(['SENIOR'])
    expect(contextSwitchTargets(['CANDIDATE', 'SENIOR'], 'SENIOR')).toEqual(['CANDIDATE'])
  })

  it('yields no targets for an account that may not switch', () => {
    expect(contextSwitchTargets(['CANDIDATE'], 'CANDIDATE')).toBeNull()
    expect(contextSwitchTargets(['ADMIN', 'CANDIDATE', 'SENIOR'], 'CANDIDATE')).toBeNull()
    expect(contextSwitchTargets([], null)).toBeNull()
  })

  it('offers both switchable contexts when the act claim names neither', () => {
    expect(contextSwitchTargets(['CANDIDATE', 'SENIOR'], null)).toEqual(['CANDIDATE', 'SENIOR'])
  })
})
