/**
 * The login outcome classification (Requirement 4 AC1, AC12).
 *
 * AC12 is asserted the way it is written — as a statement about *every* 401 and
 * *every* 403, whatever envelope they carry — rather than about the two keys the
 * Backend_Api happens to send today. The rejection value is also asserted to carry
 * nothing but its discriminant, because that emptiness is what makes the
 * non-disclosure structural rather than conventional.
 */

import { describe, expect, it } from 'vitest'

import { decodeApiError } from '../../api/errors'

import {
  classifyLoginFailure,
  LOGIN_CONTRACT_PATH,
  LOGIN_MFA_REQUIRED,
  LOGIN_REJECTED,
  loginRequestBody,
  MFA_REQUIRED_ERROR_KEY,
  NON_DISCLOSING_LOGIN_STATUSES,
} from './loginOutcome'

/** A decoded Error_Envelope, as the Api_Client would hand it to the screen. */
function envelope(status: number, error: string, details: unknown = null) {
  return decodeApiError({
    status,
    body: { error, message: 'whatever the server said', details },
    headers: new Headers({ 'X-Request-ID': 'req-1' }),
  })
}

describe('the endpoint and the request body (AC1)', () => {
  it('submits to POST /api/v1/auth/login', () => {
    expect(LOGIN_CONTRACT_PATH).toBe('/api/v1/auth/login')
  })

  it('carries the email address, the password and the selected role', () => {
    expect(
      loginRequestBody({ email: 'person@example.com', password: 'correct horse', role: 'SENIOR' }),
    ).toEqual({ email: 'person@example.com', password: 'correct horse', role: 'SENIOR' })
  })

  it('trims the email address but never the password', () => {
    const body = loginRequestBody({
      email: '  person@example.com \n',
      password: '  spaces are part of it  ',
      role: 'ADMIN',
    })
    expect(body.email).toBe('person@example.com')
    expect(body.password).toBe('  spaces are part of it  ')
  })
})

describe('classifying a refused login (AC12)', () => {
  it('reports one indistinguishable rejection for a 401 and for a 403', () => {
    const wrongCredentials = classifyLoginFailure(envelope(401, 'authentication_required'))
    const notApproved = classifyLoginFailure(
      envelope(403, 'account_not_approved', { status: 'PendingApproval', next_step: 'wait' }),
    )

    expect(wrongCredentials).toEqual(notApproved)
    expect(wrongCredentials.kind).toBe('rejected')
  })

  it('collapses every 401 and 403 envelope to the same value, whatever it carries', () => {
    const keys = [
      'authentication_required',
      'account_not_approved',
      'not_authorized',
      'invalid_credentials',
      'something_the_client_has_never_seen',
    ]
    for (const status of NON_DISCLOSING_LOGIN_STATUSES) {
      for (const key of keys) {
        expect(classifyLoginFailure(envelope(status, key, { account_id: 'a-1' }))).toBe(
          LOGIN_REJECTED,
        )
      }
    }
  })

  it('carries nothing but its discriminant, so nothing can ride along to the surface', () => {
    expect(Object.keys(LOGIN_REJECTED)).toEqual(['kind'])
    expect(Object.isFrozen(LOGIN_REJECTED)).toBe(true)
  })
})

describe('classifying the multi-factor step (Req 5 AC1)', () => {
  it('distinguishes mfa_required from the uniform rejection, despite its 401', () => {
    const decoded = envelope(401, MFA_REQUIRED_ERROR_KEY)
    expect(decoded.httpStatus).toBe(401)
    expect(classifyLoginFailure(decoded)).toBe(LOGIN_MFA_REQUIRED)
  })
})

describe('classifying everything else', () => {
  it('passes a 422 through so its Field_Violations can be placed', () => {
    const decoded = decodeApiError({
      status: 422,
      body: { error: 'validation_error', details: [{ path: 'email', code: 'invalid_email' }] },
      headers: new Headers(),
    })
    const outcome = classifyLoginFailure(decoded)
    expect(outcome.kind).toBe('failed')
    expect(outcome).toEqual({ kind: 'failed', failure: decoded })
  })

  it.each([429, 500, 503])('passes a %i through', (status) => {
    expect(classifyLoginFailure(envelope(status, 'internal_server_error')).kind).toBe('failed')
  })

  it('passes a value that is not an Error_Envelope through', () => {
    const thrown = new TypeError('network gone')
    expect(classifyLoginFailure(thrown)).toEqual({ kind: 'failed', failure: thrown })
  })
})
