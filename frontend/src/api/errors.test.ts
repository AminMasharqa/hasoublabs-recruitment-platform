import { describe, expect, it } from 'vitest'

import {
  UNEXPECTED_RESPONSE_ERROR,
  UNKNOWN_VIOLATION_CODE,
  classifyAuthOutcome,
  decodeApiError,
  decodeErrorEnvelope,
  isErrorStatus,
  isRefreshEligible,
  isValidationErrorKey,
  readHeader,
  toFieldViolations,
} from './errors'

describe('readHeader', () => {
  it('reads case-insensitively from a Headers instance', () => {
    const headers = new Headers({ 'x-request-id': 'req-1' })
    expect(readHeader(headers, 'X-Request-ID')).toBe('req-1')
  })

  it('reads case-insensitively from a plain record and a Map', () => {
    expect(readHeader({ 'X-Request-Id': 'req-2' }, 'x-request-id')).toBe('req-2')
    expect(readHeader(new Map([['X-REQUEST-ID', 'req-3']]), 'X-Request-ID')).toBe('req-3')
  })

  it('returns null when the header or the collection is absent', () => {
    expect(readHeader(undefined, 'X-Request-ID')).toBeNull()
    expect(readHeader({}, 'X-Request-ID')).toBeNull()
  })
})

describe('decodeErrorEnvelope', () => {
  it('preserves the members of a decodable envelope', () => {
    const envelope = decodeErrorEnvelope(
      {
        error: 'conflicting_state',
        message: 'Already registered',
        details: { field: 'email' },
        request_id: 'body-id',
      },
      { 'X-Request-ID': 'header-id' },
    )
    expect(envelope).toEqual({
      error: 'conflicting_state',
      message: 'Already registered',
      details: { field: 'email' },
      request_id: 'body-id',
    })
  })

  it('parses a raw JSON string body', () => {
    const envelope = decodeErrorEnvelope('{"error":"rate_limited","message":"Slow down"}')
    expect(envelope.error).toBe('rate_limited')
    expect(envelope.message).toBe('Slow down')
    expect(envelope.details).toBeNull()
    expect(envelope.request_id).toBeNull()
  })

  it('takes request_id from the X-Request-ID header when the body lacks it', () => {
    const envelope = decodeErrorEnvelope({ error: 'not_authorized' }, { 'X-Request-ID': 'hdr' })
    expect(envelope.request_id).toBe('hdr')
  })

  it('synthesizes unexpected_response for undecodable bodies', () => {
    const headers = { 'X-Request-ID': 'hdr' }
    for (const body of ['<html>502</html>', '', undefined, null, 42, [], { message: 'no key' }]) {
      const envelope = decodeErrorEnvelope(body, headers)
      expect(envelope.error).toBe(UNEXPECTED_RESPONSE_ERROR)
      expect(envelope.message).toBeNull()
      expect(envelope.details).toBeNull()
      expect(envelope.request_id).toBe('hdr')
    }
  })

  it('reports a null request_id when neither body nor header supplies one', () => {
    expect(decodeErrorEnvelope('not json').request_id).toBeNull()
  })
})

describe('status classification', () => {
  it('treats only 400-599 as an error status', () => {
    expect(isErrorStatus(399)).toBe(false)
    expect(isErrorStatus(400)).toBe(true)
    expect(isErrorStatus(599)).toBe(true)
    expect(isErrorStatus(600)).toBe(false)
  })

  it('marks 401 refresh-eligible and never 403', () => {
    expect(isRefreshEligible(401)).toBe(true)
    expect(isRefreshEligible(403)).toBe(false)
    expect(isRefreshEligible(422)).toBe(false)
    expect(classifyAuthOutcome(401)).toBe('authentication_failure')
    expect(classifyAuthOutcome(403)).toBe('authorization_denial')
    expect(classifyAuthOutcome(500)).toBe('other')
  })
})

describe('toFieldViolations', () => {
  it('maps platform validation_failed details to path and code', () => {
    const envelope = decodeErrorEnvelope({
      error: 'validation_failed',
      message: 'Invalid',
      details: [
        { path: 'phone_number', code: 'invalid_e164', message: 'Not an Israeli number' },
        { path: 'education[2].start_date', code: 'end_before_start' },
      ],
    })
    expect(toFieldViolations(422, envelope)).toEqual([
      { path: 'phone_number', code: 'invalid_e164', message: 'Not an Israeli number' },
      { path: 'education[2].start_date', code: 'end_before_start', message: null },
    ])
  })

  it('maps FastAPI validation_error loc arrays to form-addressable paths', () => {
    const envelope = decodeErrorEnvelope({
      error: 'validation_error',
      message: 'Request validation failed',
      details: [
        { loc: ['body', 'education', 2, 'start_year'], msg: 'field required', type: 'missing' },
        { loc: ['body'], msg: 'bad', type: 'model_attributes_type' },
      ],
    })
    expect(toFieldViolations(422, envelope)).toEqual([
      { path: 'education[2].start_year', code: 'missing', message: 'field required' },
      { path: 'details[1]', code: 'model_attributes_type', message: 'bad' },
    ])
  })

  it('produces one entry per details element even for unusable elements', () => {
    const envelope = decodeErrorEnvelope({
      error: 'validation_failed',
      details: [null, 'oops', { code: 'too_short' }],
    })
    const violations = toFieldViolations(422, envelope)
    expect(violations).toHaveLength(3)
    expect(violations[0]).toEqual({
      path: 'details[0]',
      code: UNKNOWN_VIOLATION_CODE,
      message: null,
    })
    expect(violations[1]).toEqual({
      path: 'details[1]',
      code: UNKNOWN_VIOLATION_CODE,
      message: 'oops',
    })
    expect(violations[2]).toEqual({ path: 'details[2]', code: 'too_short', message: null })
  })

  it('falls back to a sibling fields list when details is not an array', () => {
    const body = {
      error: 'validation_failed',
      message: 'Invalid',
      fields: [{ path: 'email', code: 'invalid_email', message: 'Bad address' }],
      details: { unmet: ['profile_complete'] },
    }
    const envelope = decodeErrorEnvelope(body)
    expect(toFieldViolations(422, envelope, body)).toEqual([
      { path: 'email', code: 'invalid_email', message: 'Bad address' },
    ])
  })

  it('is empty for a non-422 status or a non-validation error key', () => {
    const validation = decodeErrorEnvelope({ error: 'validation_failed', details: [{}] })
    expect(toFieldViolations(400, validation)).toEqual([])
    const other = decodeErrorEnvelope({ error: 'precondition_unmet', details: [{}] })
    expect(toFieldViolations(422, other)).toEqual([])
  })

  it('recognizes both validation error keys', () => {
    expect(isValidationErrorKey('validation_error')).toBe(true)
    expect(isValidationErrorKey('validation_failed')).toBe(true)
    expect(isValidationErrorKey('precondition_unmet')).toBe(false)
  })
})

describe('decodeApiError', () => {
  it('combines the envelope with the transport-level facts', () => {
    const error = decodeApiError({
      status: 422,
      body: {
        error: 'validation_error',
        message: 'Request validation failed',
        details: [{ loc: ['body', 'password'], msg: 'too short', type: 'string_too_short' }],
      },
      headers: new Headers({ 'X-Request-ID': 'req-9' }),
    })
    expect(error.httpStatus).toBe(422)
    expect(error.supportReference).toBe('req-9')
    expect(error.request_id).toBe('req-9')
    expect(error.refreshEligible).toBe(false)
    expect(error.authOutcome).toBe('other')
    expect(error.fieldViolations).toEqual([
      { path: 'password', code: 'string_too_short', message: 'too short' },
    ])
  })

  it('classifies a 401 as refresh-eligible and a 403 as a denial', () => {
    const unauthenticated = decodeApiError({
      status: 401,
      body: { error: 'authentication_required', message: 'Sign in' },
    })
    expect(unauthenticated.refreshEligible).toBe(true)
    expect(unauthenticated.authOutcome).toBe('authentication_failure')

    const denied = decodeApiError({ status: 403, body: { error: 'not_authorized' } })
    expect(denied.refreshEligible).toBe(false)
    expect(denied.authOutcome).toBe('authorization_denial')
    expect(denied.fieldViolations).toEqual([])
  })

  it('records the Support_Reference for an undecodable gateway body', () => {
    const error = decodeApiError({
      status: 502,
      body: '<html>Bad Gateway</html>',
      headers: { 'x-request-id': 'req-502' },
    })
    expect(error.error).toBe(UNEXPECTED_RESPONSE_ERROR)
    expect(error.supportReference).toBe('req-502')
    expect(error.request_id).toBe('req-502')
  })
})
