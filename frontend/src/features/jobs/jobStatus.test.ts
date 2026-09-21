/**
 * Unit tests for the apply-control verdict (Requirement 12 AC7).
 *
 * One function decides for both the list entry and the detail view, so these are
 * the tests that make "the closed indicator and the disabled apply control agree
 * on both surfaces" checkable without rendering either.
 */

import { describe, expect, it } from 'vitest'

import type { JdStatus } from '../../api/enums'

import { applyAvailability, isClosed } from './jobStatus'

describe('the apply-control verdict (AC7)', () => {
  it('enables the control for an Open Job_Description and nothing else', () => {
    expect(applyAvailability('Open')).toEqual({ enabled: true, reason: null })
    expect(applyAvailability('Closed')).toEqual({ enabled: false, reason: 'closed' })
    expect(applyAvailability('Draft')).toEqual({ enabled: false, reason: 'draft' })
  })

  it('refuses a status the contract does not declare rather than admitting it', () => {
    // A value a future contract could add: not applicable until it is understood.
    const unknown = 'Archived' as JdStatus

    expect(applyAvailability(unknown).enabled).toBe(false)
    expect(applyAvailability(null).enabled).toBe(false)
    expect(applyAvailability(undefined).enabled).toBe(false)
  })

  it('marks only Closed as closed', () => {
    expect(isClosed('Closed')).toBe(true)
    expect(isClosed('Open')).toBe(false)
    expect(isClosed('Draft')).toBe(false)
    expect(isClosed(null)).toBe(false)
  })
})
