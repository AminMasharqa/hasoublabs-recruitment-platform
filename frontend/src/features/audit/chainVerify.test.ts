/**
 * Unit tests for the chain-verification verdict (Requirement 17 AC6, AC7).
 *
 * The tampering alert is the most consequential thing the Audit_Log_Viewer renders,
 * so these pin down the one direction that must never be wrong: a response that has
 * not said the chain is intact is treated as a chain that did not verify.
 */

import { describe, expect, it } from 'vitest'

import { chainOkValue, chainRange, chainVerdict } from './chainVerify'

describe('the verdict of a verification (AC6, AC7)', () => {
  it('reports an intact chain for `ok` true', () => {
    expect(chainVerdict({ ok: true, first_bad_id: null, checked_from_id: 1, max_id: 900 })).toEqual({
      tampered: false,
    })
  })

  it('reports tampering for `ok` false, carrying `first_bad_id` (AC7)', () => {
    expect(chainVerdict({ ok: false, first_bad_id: 417, checked_from_id: 1, max_id: 900 })).toEqual({
      tampered: true,
      firstBadId: 417,
    })
  })

  it('reports tampering with no identifier when the response names none', () => {
    expect(chainVerdict({ ok: false, first_bad_id: null })).toEqual({
      tampered: true,
      firstBadId: null,
    })
  })

  it('treats anything that is not the boolean true as a chain that did not verify', () => {
    // Failing closed: the one mistake this surface must not make is calling an
    // unverified chain intact.
    for (const ok of [undefined, null, 0, '', 'true', 1] as never[]) {
      expect(chainVerdict({ ok })?.tampered, JSON.stringify(ok)).toBe(true)
    }
  })

  it('is no verdict at all for an absent response', () => {
    expect(chainVerdict(null)).toBeNull()
    expect(chainVerdict(undefined)).toBeNull()
  })
})

describe('the members rendered beside the verdict (AC6)', () => {
  it('reads `checked_from_id` and `max_id`', () => {
    expect(chainRange({ ok: true, checked_from_id: 1, max_id: 900 })).toEqual({
      checkedFromId: 1,
      maxId: 900,
    })
  })

  it('reports an absent or non-finite identifier as none', () => {
    expect(chainRange({ ok: true, max_id: null })).toEqual({ checkedFromId: null, maxId: null })
    expect(chainRange({ ok: true, checked_from_id: Number.NaN }).checkedFromId).toBeNull()
    expect(chainRange(null)).toEqual({ checkedFromId: null, maxId: null })
  })

  it('renders `ok` as the contract spells it rather than as a translation', () => {
    expect(chainOkValue({ ok: true })).toBe('true')
    expect(chainOkValue({ ok: false })).toBe('false')
    expect(chainOkValue(null)).toBe('false')
  })
})
