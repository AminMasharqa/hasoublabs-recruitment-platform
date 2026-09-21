/**
 * Registration_Link validation outcomes (Requirement 6 AC1, AC2, AC3).
 *
 * Two decisions are pinned here, both of them about what the screen is allowed to
 * render: which roles produce a form at all, and which failures are the
 * Backend_Api refusing the link (AC3) rather than the request never arriving.
 */

import { describe, expect, it } from 'vitest'

import { decodeApiError } from '../../api/errors'

import {
  isLinkRejection,
  registrationLinkQueryKey,
  REGISTRATION_LINK_PATH,
  selfRegistrationRole,
  type RegistrationLink,
} from './registrationLink'

function link(role: RegistrationLink['role']): RegistrationLink {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    role,
    expires_at: '2030-01-01T00:00:00.000Z',
  }
}

/** A decoded Error_Envelope, as the Api_Client hands it to the screen. */
function failure(status: number) {
  return decodeApiError({
    status,
    body: { error: 'not_found', message: 'no such link', details: null },
    headers: new Headers({ 'X-Request-ID': 'req-1' }),
  })
}

describe('the validated endpoint (AC1)', () => {
  it('validates the token against GET /api/v1/registration-links/{token}', () => {
    expect(REGISTRATION_LINK_PATH).toBe('/api/v1/registration-links/{token}')
  })

  it('caches each token separately', () => {
    expect(registrationLinkQueryKey('a')).not.toEqual(registrationLinkQueryKey('b'))
  })
})

describe('the role the form is fixed to (AC2)', () => {
  it('accepts the two self-registerable roles', () => {
    expect(selfRegistrationRole(link('CANDIDATE'))).toBe('CANDIDATE')
    expect(selfRegistrationRole(link('SENIOR'))).toBe('SENIOR')
  })

  it('reports no role for an ADMIN link, which has no self-registration endpoint', () => {
    expect(selfRegistrationRole(link('ADMIN'))).toBeNull()
  })

  it('reports no role when there is no link yet', () => {
    expect(selfRegistrationRole(null)).toBeNull()
    expect(selfRegistrationRole(undefined)).toBeNull()
  })
})

describe('classifying a failed validation (AC3)', () => {
  it('treats every 400 to 599 as the link being refused', () => {
    for (const status of [400, 401, 403, 404, 410, 422, 429, 500, 503, 599]) {
      expect(isLinkRejection(failure(status))).toBe(true)
    }
  })

  it('does not accuse the link when no response arrived', () => {
    // `httpStatus === 0` is the Api_Client's timeout / transport failure: it says
    // nothing about the link, so the screen keeps a retryable read surface.
    expect(isLinkRejection(failure(0))).toBe(false)
    expect(isLinkRejection(new Error('network down'))).toBe(false)
    expect(isLinkRejection(null)).toBe(false)
  })
})
