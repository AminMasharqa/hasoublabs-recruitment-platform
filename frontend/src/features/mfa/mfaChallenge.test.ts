/**
 * The multi-factor code step's pure logic (Requirement 5 AC1, AC2, AC3).
 *
 * AC3 is asserted as the property that matters: an invalid-code envelope must stay
 * *distinguishable* from the uniform login rejection, because the step can only be
 * retained if the outcome can be told apart — while every other 401 and 403 must
 * still collapse into the rejection that discloses nothing (Requirement 4 AC12).
 */

import { describe, expect, it } from 'vitest'

import { decodeApiError } from '../../api/errors'
import { LOGIN_REJECTED, MFA_REQUIRED_ERROR_KEY } from '../auth/loginOutcome'

import {
  classifyMfaSubmission,
  isSubmittableMfaCode,
  MFA_CODE_INPUTS,
  MFA_CODE_LENGTH,
  MFA_CODE_PATH,
  MFA_INVALID_CODE_ERROR_KEY,
  MFA_LOGIN_CONTRACT_PATH,
  mfaLoginRequestBody,
  retainsCodeStep,
  sanitizeMfaCodeInput,
  validateMfaCodeValues,
} from './mfaChallenge'

/** A decoded Error_Envelope, as the Api_Client would hand it to the step. */
function envelope(status: number, error: string, details: unknown = null) {
  return decodeApiError({
    status,
    body: { error, message: 'whatever the server said', details },
    headers: new Headers({ 'X-Request-ID': 'req-1' }),
  })
}

describe('the resubmitted login body (AC1)', () => {
  it('goes to the login endpoint, not to a second one', () => {
    expect(MFA_LOGIN_CONTRACT_PATH).toBe('/api/v1/auth/login')
  })

  it('carries the email address, the password, the role and the code', () => {
    expect(
      mfaLoginRequestBody(
        { email: 'person@example.com', password: 'correct horse', role: 'ADMIN' },
        '123456',
      ),
    ).toEqual({
      email: 'person@example.com',
      password: 'correct horse',
      role: 'ADMIN',
      mfa_code: '123456',
    })
  })

  it('trims the address, never the password, and normalizes the code', () => {
    const body = mfaLoginRequestBody(
      { email: '  person@example.com \n', password: '  spaces count  ', role: 'ADMIN' },
      ' 12 34-56 ',
    )
    expect(body.email).toBe('person@example.com')
    expect(body.password).toBe('  spaces count  ')
    expect(body.mfa_code).toBe('123456')
  })
})

describe('constraining the input to six digits (AC2)', () => {
  it('keeps exactly six ASCII digits and drops everything else', () => {
    expect(sanitizeMfaCodeInput('123456')).toBe('123456')
    expect(sanitizeMfaCodeInput('123 456')).toBe('123456')
    expect(sanitizeMfaCodeInput('12a3b4c5d6')).toBe('123456')
    expect(sanitizeMfaCodeInput('1234567890')).toBe('123456')
    expect(sanitizeMfaCodeInput('')).toBe('')
    expect(sanitizeMfaCodeInput(undefined)).toBe('')
  })

  it('folds Arabic-Indic digits, which an Arabic keyboard layout produces', () => {
    expect(sanitizeMfaCodeInput('١٢٣٤٥٦')).toBe('123456')
    expect(sanitizeMfaCodeInput('۱۲۳۴۵۶')).toBe('123456')
  })

  it('treats only a complete code as submittable', () => {
    expect(MFA_CODE_LENGTH).toBe(6)
    expect(isSubmittableMfaCode('123456')).toBe(true)
    expect(isSubmittableMfaCode('12345')).toBe(false)
    expect(isSubmittableMfaCode('')).toBe(false)
  })

  it('reports an incomplete code against the submitted member name', () => {
    const issues = validateMfaCodeValues({ mfa_code: '12345' })
    expect(issues).toHaveLength(1)
    expect(issues[0]?.path).toBe(MFA_CODE_PATH)
    expect(validateMfaCodeValues({ mfa_code: '123456' })).toEqual([])
  })

  it('registers one input, addressed by the request member name', () => {
    expect(MFA_CODE_INPUTS.map((input) => input.path)).toEqual([MFA_CODE_PATH])
  })
})

describe('classifying the resubmission (AC3)', () => {
  it('reports an invalid code as a refused code, despite its 401', () => {
    const decoded = envelope(401, MFA_INVALID_CODE_ERROR_KEY)
    expect(decoded.httpStatus).toBe(401)
    expect(classifyMfaSubmission(decoded)).toEqual({
      kind: 'code-refused',
      errorKey: MFA_INVALID_CODE_ERROR_KEY,
    })
  })

  it('reports a repeated mfa_required as a refused code too', () => {
    expect(classifyMfaSubmission(envelope(401, MFA_REQUIRED_ERROR_KEY))).toEqual({
      kind: 'code-refused',
      errorKey: MFA_REQUIRED_ERROR_KEY,
    })
  })

  it.each([401, 403])(
    'still collapses a %i that is not about the code into the uniform rejection (Req 4 AC12)',
    (status) => {
      for (const key of ['authentication_required', 'account_not_approved', 'not_authorized']) {
        expect(classifyMfaSubmission(envelope(status, key))).toBe(LOGIN_REJECTED)
      }
    },
  )

  it('passes a 422 through so its Field_Violations can be placed', () => {
    const decoded = decodeApiError({
      status: 422,
      body: { error: 'validation_error', details: [{ path: 'mfa_code', code: 'invalid_code' }] },
      headers: new Headers(),
    })
    expect(classifyMfaSubmission(decoded)).toEqual({ kind: 'failed', failure: decoded })
  })

  it.each([429, 500, 503])('passes a %i through', (status) => {
    expect(classifyMfaSubmission(envelope(status, 'internal_server_error')).kind).toBe('failed')
  })

  it('keeps the user on the step for a refused code and for a transient failure', () => {
    expect(retainsCodeStep({ kind: 'code-refused', errorKey: MFA_INVALID_CODE_ERROR_KEY })).toBe(
      true,
    )
    expect(retainsCodeStep({ kind: 'failed', failure: new TypeError('network gone') })).toBe(true)
    expect(retainsCodeStep(LOGIN_REJECTED as { kind: 'rejected' })).toBe(false)
    expect(retainsCodeStep(null)).toBe(false)
  })
})
