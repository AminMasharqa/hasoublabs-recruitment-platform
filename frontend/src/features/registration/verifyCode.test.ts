/**
 * The Verification_Code operations, as pure decisions (Requirement 6 AC9, AC11,
 * AC12).
 *
 * Three things are pinned here, all of them things the screen reads rather than
 * decides: the two contract paths, the bodies each one submits, and the single
 * classification that locks code entry.
 */

import { describe, expect, it } from 'vitest'

import { decodeApiError } from '../../api/errors'

import {
  isCodeEntryLocked,
  resendCodeBody,
  validateVerificationValues,
  verifyCodeBody,
  CODE_ENTRY_LOCKED_ERROR_KEY,
  VERIFICATION_INPUTS,
  VERIFY_CODE_PATH,
  VERIFY_RESEND_PATH,
} from './verifyCode'

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111'

/** A decoded Error_Envelope, as the Api_Client hands it to the screen. */
function failure(errorKey: string, status = 409) {
  return decodeApiError({
    status,
    body: { error: errorKey, message: 'no', details: null },
    headers: new Headers({ 'X-Request-ID': 'req-1' }),
  })
}

describe('the submitted endpoints (AC9, AC12)', () => {
  it('submits the code to POST /api/v1/verify/code', () => {
    expect(VERIFY_CODE_PATH).toBe('/api/v1/verify/code')
  })

  it('resends through POST /api/v1/verify/resend', () => {
    expect(VERIFY_RESEND_PATH).toBe('/api/v1/verify/resend')
  })
})

describe('the submitted body (AC9)', () => {
  it('carries the retained account identifier together with the code', () => {
    expect(verifyCodeBody(ACCOUNT_ID, '123456')).toEqual({
      account_id: ACCOUNT_ID,
      code: '123456',
    })
  })

  it('trims the surrounding whitespace a pasted code carries', () => {
    expect(verifyCodeBody(ACCOUNT_ID, '  123456\n').code).toBe('123456')
  })

  it('resends with the retained identifier alone', () => {
    expect(resendCodeBody(ACCOUNT_ID)).toEqual({ account_id: ACCOUNT_ID })
  })
})

describe('the collected code (AC9)', () => {
  it('accepts exactly six ASCII digits', () => {
    expect(validateVerificationValues('123456')).toEqual([])
    expect(validateVerificationValues('  123456  ')).toEqual([])
  })

  it('reports anything that is not six ASCII digits, addressed at the code input', () => {
    for (const entered of ['', '12345', '1234567', '12345a', '١٢٣٤٥٦']) {
      const issues = validateVerificationValues(entered)
      expect(issues).toHaveLength(1)
      expect(issues[0]?.path).toBe('code')
    }
  })

  it('renders exactly one input, so a violation of account_id reaches none of them', () => {
    expect(VERIFICATION_INPUTS.map((input) => input.path)).toEqual(['code'])
  })
})

describe('locking code entry (AC11)', () => {
  it('recognizes the code_entry_locked envelope member', () => {
    expect(isCodeEntryLocked(failure(CODE_ENTRY_LOCKED_ERROR_KEY))).toBe(true)
  })

  it('reads the member rather than the status, so any 4xx carrying it locks', () => {
    for (const status of [400, 403, 409, 423, 429]) {
      expect(isCodeEntryLocked(failure(CODE_ENTRY_LOCKED_ERROR_KEY, status))).toBe(true)
    }
  })

  it('leaves every other refusal unlocked', () => {
    expect(isCodeEntryLocked(failure('invalid_verification_code'))).toBe(false)
    expect(isCodeEntryLocked(failure('verification_code_expired'))).toBe(false)
    expect(isCodeEntryLocked(failure('rate_limited', 429))).toBe(false)
    expect(isCodeEntryLocked(new Error('network down'))).toBe(false)
    expect(isCodeEntryLocked(null)).toBe(false)
  })
})
