import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  MAX_READ_RETRIES,
  RETRYABLE_ERROR_KEYS,
  RETRY_BACKOFF_FACTOR,
  RETRY_BASE_DELAY_MS,
  REQUEST_TIMEOUT_ERROR,
  UPSTREAM_UNAVAILABLE_ERROR,
  UPSTREAM_UNAVAILABLE_STATUS,
  isRetryableErrorKey,
  isRetryableOutcome,
  retryDelayMs,
  retryDelaySchedule,
  shouldRetry,
  shouldRetryOutcome,
  type RetryableOutcome,
} from './retry'

/**
 * ## How the property is read
 *
 * Design Property 19 states: *for any* request outcome described by
 * (is-mutation, is-retryable, attempts-so-far), the Api_Client permits a retry
 * **if and only if** the request is a read, the outcome is retryable, and fewer
 * than two retries have been attempted; a mutation is never retried.
 *
 * Three things follow, and all three are asserted below from a single generated
 * scenario:
 *
 * 1. **The biconditional.** Every one of the four (is-mutation, is-retryable)
 *    combinations is exercised against every generated attempt count, so the
 *    cross product is enumerated exhaustively per run rather than left to the
 *    generator to stumble into. The expected answer comes from
 *    {@link requirementPermitsRetry}, which restates the requirement in its own
 *    terms — `retriesAttempted < 2` written as the literal the requirement says,
 *    not as `MAX_READ_RETRIES` — so a change to the budget constant cannot move
 *    the oracle and the assertion along with it. The constants are anchored to
 *    their advertised values separately, below.
 *
 * 2. **A mutation is never retried.** AC10 is unconditional, so the
 *    `isMutation: true` half of the grid is additionally asserted to be `false`
 *    outright — no error key, status code or attempt count may buy a mutation a
 *    retry. That is checked through {@link shouldRetryOutcome} as well, driven by
 *    generated decoded failures, because that is the entry point the Api_Client
 *    actually calls.
 *
 * 3. **Attempt counts outside the budget.** The generator ranges well past the
 *    budget and into negative counts. A negative count is not reachable from the
 *    Api_Client — it counts up from zero — but the predicate is total, and the
 *    requirement's "fewer than two" resolves it without a special case, so the
 *    oracle asserts the same answer there rather than the test excluding it.
 *
 * The retry *delay* is part of the same AC9 sentence ("at most twice … with an
 * increasing delay"), so the schedule's strict monotonicity is asserted here
 * too: over the budget the Api_Client actually spends, and over an arbitrary
 * generated step within the range where the exponential stays finite.
 */

/** Error_Envelope `error` keys that report a transient, retryable outcome. */
const retryableErrorKey: fc.Arbitrary<string> = fc.constantFrom(
  'upstream_unavailable',
  'request_timeout',
)

/**
 * Keys a second identical request would earn again, or that have their own
 * prescribed handling (refresh, denial surface, `Retry-After`).
 */
const deterministicErrorKey: fc.Arbitrary<string> = fc.constantFrom(
  'validation_failed',
  'not_authorized',
  'not_authenticated',
  'illegal_transition',
  'integrity_violation',
  'precondition_unmet',
  'conflicting_state',
  'rate_limited',
  'not_found',
  'unexpected_response',
)

/**
 * Near-misses: the retryable keys with their casing or spelling perturbed. The
 * classification is an exact match on the advertised key, so none of these may
 * be read as retryable.
 */
const nearMissErrorKey: fc.Arbitrary<string> = fc.constantFrom(
  'Upstream_Unavailable',
  'UPSTREAM_UNAVAILABLE',
  'upstream-unavailable',
  ' upstream_unavailable',
  'upstream_unavailable ',
  'Request_Timeout',
  'request-timeout',
  'timeout',
  '',
)

/** Any `error` key at all, weighted toward the ones the contract names. */
const errorKey: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: retryableErrorKey },
  { weight: 3, arbitrary: deterministicErrorKey },
  { weight: 2, arbitrary: nearMissErrorKey },
  { weight: 1, arbitrary: fc.string() },
)

/**
 * Any status a failure might carry, plus `undefined` for a client-synthesized
 * failure that never saw a response. 503 is weighted up because it is the one
 * status `upstream_unavailable` is advertised on, so it is the boundary the
 * classification turns on.
 */
const httpStatus: fc.Arbitrary<number | undefined> = fc.oneof(
  { weight: 3, arbitrary: fc.constant(undefined) },
  { weight: 3, arbitrary: fc.constant(503) },
  { weight: 3, arbitrary: fc.constantFrom(400, 401, 403, 404, 409, 422, 429, 500, 502, 504) },
  { weight: 1, arbitrary: fc.integer({ min: 100, max: 599 }) },
  { weight: 1, arbitrary: fc.integer({ min: -1_000, max: 1_000 }) },
)

/**
 * A decoded failure handed to the retry decision, including the unclassifiable
 * case: a failure the decoder could not turn into an envelope at all.
 */
const outcome: fc.Arbitrary<RetryableOutcome | null | undefined> = fc.oneof(
  { weight: 8, arbitrary: fc.record({ error: errorKey, httpStatus }) },
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.constant(undefined) },
)

/**
 * Retries already spent: the budget boundary, its immediate neighbourhood,
 * counts well past it, and negative counts the predicate still has to answer.
 */
const retriesAttempted: fc.Arbitrary<number> = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(0, 1, 2, 3) },
  { weight: 3, arbitrary: fc.integer({ min: -4, max: 8 }) },
  { weight: 2, arbitrary: fc.integer({ min: -1_000, max: 1_000 }) },
  { weight: 1, arbitrary: fc.integer({ min: -1_000_000, max: 1_000_000 }) },
  {
    weight: 1,
    arbitrary: fc.constantFrom(Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER),
  },
)

/**
 * A step of the backoff curve to check the increase at. Bounded at 64 because
 * `250 × 2^65` is still a finite double while `250 × 2^1100` is not: past the
 * float range every step is `Infinity` and "strictly longer than the last" stops
 * being expressible. The Api_Client only ever asks for steps 0 and 1.
 */
const backoffStep: fc.Arbitrary<number> = fc.integer({ min: 0, max: 64 })

/** The four (is-mutation, is-retryable) combinations, enumerated. */
const RETRY_GRID: readonly { readonly isMutation: boolean; readonly isRetryable: boolean }[] = [
  { isMutation: false, isRetryable: false },
  { isMutation: false, isRetryable: true },
  { isMutation: true, isRetryable: false },
  { isMutation: true, isRetryable: true },
]

/**
 * Property 19 restated as an independent predicate: a read, a retryable outcome
 * and fewer than two retries spent. Written from the requirement's own wording,
 * with the budget as the literal `2` the requirement names, so it does not
 * inherit an error from the module under test.
 */
function requirementPermitsRetry(input: {
  readonly isMutation: boolean
  readonly isRetryable: boolean
  readonly retriesAttempted: number
}): boolean {
  const isRead = !input.isMutation
  const budgetRemains = input.retriesAttempted < 2
  return isRead && input.isRetryable && budgetRemains
}

/**
 * Which decoded failures Requirement 3 AC11/AC12 describe as transient, stated
 * from the requirements rather than from the module's exported constants: the
 * 503 upstream failure, and the client-synthesized timeout that carries no
 * status because no response arrived.
 */
function requirementClassifiesRetryable(
  failure: RetryableOutcome | null | undefined,
): boolean {
  if (failure == null) {
    return false
  }
  if (failure.error === 'request_timeout') {
    return true
  }
  if (failure.error === 'upstream_unavailable') {
    return failure.httpStatus === undefined || failure.httpStatus === 503
  }
  return false
}

describe('retry policy properties', () => {
  // Feature: frontend-web-application, Property 19: Retry policy applies only to
  // idempotent reads — For any request outcome described by (is-mutation,
  // is-retryable, attempts-so-far), the Api_Client permits a retry if and only if
  // the request is a read, the outcome is retryable, and fewer than two retries
  // have been attempted; a mutation is never retried.
  //
  // **Validates: Requirements 21.9, 21.10**
  it('permits a retry iff the request is a read with a retryable outcome and budget left', () => {
    // The oracle spells the contract out as literals; anchor the module's
    // constants to those same advertised values so the two cannot drift apart
    // silently.
    expect(MAX_READ_RETRIES).toBe(2)
    expect(UPSTREAM_UNAVAILABLE_ERROR).toBe('upstream_unavailable')
    expect(UPSTREAM_UNAVAILABLE_STATUS).toBe(503)
    expect(REQUEST_TIMEOUT_ERROR).toBe('request_timeout')
    expect(RETRYABLE_ERROR_KEYS).toStrictEqual(['upstream_unavailable', 'request_timeout'])

    fc.assert(
      fc.property(
        retriesAttempted,
        outcome,
        backoffStep,
        (spent, failure, step) => {
          // ── The biconditional, over the full (is-mutation × is-retryable) grid ──
          for (const { isMutation, isRetryable } of RETRY_GRID) {
            const permitted = shouldRetry({ isMutation, isRetryable, retriesAttempted: spent })

            expect(permitted).toBe(
              requirementPermitsRetry({ isMutation, isRetryable, retriesAttempted: spent }),
            )

            // Each conjunct is necessary: a retry implies all three hold.
            if (permitted) {
              expect(isMutation).toBe(false)
              expect(isRetryable).toBe(true)
              expect(spent).toBeLessThan(MAX_READ_RETRIES)
            }

            // AC10 is unconditional: no attempt count and no outcome buys a
            // mutation a retry.
            if (isMutation) {
              expect(permitted).toBe(false)
            }
          }

          // ── Classification of the decoded failure (Req 3 AC11, AC12) ──────────
          const classifiedRetryable = isRetryableOutcome(failure)
          expect(classifiedRetryable).toBe(requirementClassifiesRetryable(failure))
          if (failure != null) {
            // Only the two advertised keys can be retryable, and the key test
            // agrees with the set it is derived from.
            expect(isRetryableErrorKey(failure.error)).toBe(
              (RETRYABLE_ERROR_KEYS as readonly string[]).includes(failure.error),
            )
            if (classifiedRetryable) {
              expect(isRetryableErrorKey(failure.error)).toBe(true)
            }
          }

          // ── The decision the Api_Client actually makes, per request kind ──────
          for (const isMutation of [false, true]) {
            const decided = shouldRetryOutcome({
              isMutation,
              retriesAttempted: spent,
              outcome: failure,
            })

            // Driving the decision from a decoded failure is exactly the
            // predicate applied to that failure's classification.
            expect(decided).toBe(
              shouldRetry({ isMutation, isRetryable: classifiedRetryable, retriesAttempted: spent }),
            )
            expect(decided).toBe(
              requirementPermitsRetry({
                isMutation,
                isRetryable: requirementClassifiesRetryable(failure),
                retriesAttempted: spent,
              }),
            )

            // A mutation is never retried, whatever the outcome or the budget.
            if (isMutation) {
              expect(decided).toBe(false)
            }
          }

          // ── AC9's increasing delay ────────────────────────────────────────────
          const schedule = retryDelaySchedule()
          expect(schedule).toHaveLength(MAX_READ_RETRIES)
          expect(schedule[0]).toBe(RETRY_BASE_DELAY_MS)
          for (let index = 1; index < schedule.length; index += 1) {
            expect(schedule[index] as number).toBeGreaterThan(schedule[index - 1] as number)
          }

          // Each successive wait is strictly longer than the last, everywhere the
          // curve is representable.
          const thisDelay = retryDelayMs(step)
          const nextDelay = retryDelayMs(step + 1)
          expect(thisDelay).toBeGreaterThanOrEqual(RETRY_BASE_DELAY_MS)
          expect(Number.isFinite(nextDelay)).toBe(true)
          expect(nextDelay).toBeGreaterThan(thisDelay)
          expect(nextDelay).toBe(thisDelay * RETRY_BACKOFF_FACTOR)

          // A count with no usable curve position falls back to the base wait
          // rather than producing a nonsense timer.
          if (!Number.isFinite(spent) || spent <= 0) {
            expect(retryDelayMs(spent)).toBe(RETRY_BASE_DELAY_MS)
          }
        },
      ),
      { numRuns: 500 },
    )
  })
})
