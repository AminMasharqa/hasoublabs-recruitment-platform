import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  classifyAuthOutcome,
  decodeApiError,
  isErrorStatus,
  isRefreshEligible,
  type AuthOutcome,
} from './errors'

/**
 * The full status-code range: every code an HTTP response can carry, not only
 * the 400–599 error band, so the biconditional "refresh-eligible iff 401" is
 * exercised on both sides — 401 must be eligible, and every other code, in the
 * error band or not, must not be.
 */
const anyHttpStatus: fc.Arbitrary<number> = fc.oneof(
  { arbitrary: fc.integer({ min: 100, max: 599 }), weight: 8 },
  // The two codes the classification turns on, plus their immediate
  // neighbours, so the boundary is hit regardless of how the range shrinks.
  { arbitrary: fc.constantFrom(400, 401, 402, 403, 404, 422, 500), weight: 3 },
  // Codes outside the registered range: a status is still just a number, and a
  // non-error status must never be marked refresh-eligible either.
  { arbitrary: fc.integer({ min: 0, max: 999 }), weight: 1 },
)

/** An arbitrary response body, decodable or not: classification must ignore it. */
const anyBody: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(undefined),
  fc.string(),
  fc.record({
    error: fc.constantFrom('not_authorized', 'invalid_token', 'validation_failed'),
    message: fc.string(),
  }),
  // A body that *claims* an authentication failure while the status says
  // otherwise: the claim must not influence the outcome.
  fc.constant({
    error: 'invalid_token',
    refreshEligible: true,
    authOutcome: 'authentication_failure',
  }),
  fc.anything(),
)

/** An arbitrary header collection; only `X-Request-ID` is meaningful elsewhere. */
const anyHeaders: fc.Arbitrary<Record<string, string>> = fc.dictionary(
  fc.constantFrom('X-Request-ID', 'Retry-After', 'Content-Type', 'WWW-Authenticate'),
  fc.string(),
  { maxKeys: 4 },
)

/** The outcome each status code must be classified as, stated independently. */
function expectedOutcome(status: number): AuthOutcome {
  if (status === 401) {
    return 'authentication_failure'
  }
  if (status === 403) {
    return 'authorization_denial'
  }
  return 'other'
}

describe('refresh classification properties', () => {
  // Feature: frontend-web-application, Property 2: 401/403 refresh classification —
  // For any HTTP status code, the Api_Client marks the outcome as
  // refresh-eligible if and only if the code is 401, and it never marks 403 (or
  // any code other than 401) as refresh-eligible.
  //
  // **Validates: Requirements 3.7, 3.8**
  it('marks an outcome refresh-eligible if and only if the status code is 401', () => {
    fc.assert(
      fc.property(anyHttpStatus, anyBody, anyHeaders, (status, body, headers) => {
        const is401 = status === 401

        // The biconditional, on the predicate itself.
        expect(isRefreshEligible(status)).toBe(is401)
        // 403 — and every other non-401 code — is never refresh-eligible.
        expect(isRefreshEligible(status) && status === 403).toBe(false)

        // The authentication/authorization classification agrees with it: only
        // an authentication failure is ever refreshed, and a 403 is always a
        // denial rather than an authentication failure.
        const outcome = classifyAuthOutcome(status)
        expect(outcome).toBe(expectedOutcome(status))
        expect(isRefreshEligible(status)).toBe(outcome === 'authentication_failure')

        // The decoded error carries the same classification for any body and
        // any headers, so it is a function of the status code alone.
        const decoded = decodeApiError({ status, body, headers })
        expect(decoded.refreshEligible).toBe(is401)
        expect(decoded.authOutcome).toBe(outcome)
        // Refresh eligibility is orthogonal to whether the status is an error
        // status at all: a non-error code is never eligible.
        expect(decoded.refreshEligible && !isErrorStatus(status)).toBe(false)
      }),
      { numRuns: 500 },
    )
  })
})
