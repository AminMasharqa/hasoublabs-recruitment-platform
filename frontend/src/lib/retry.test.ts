import { describe, expect, expectTypeOf, it } from 'vitest'

import type { ApiError } from '../api/errors'

import {
  MAX_READ_RETRIES,
  RETRYABLE_ERROR_KEYS,
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

/** A decoded failure must be usable as a retryability input without adaptation. */
describe('decoded-error compatibility', () => {
  it('accepts an ApiError as a retryable-outcome source', () => {
    expectTypeOf<ApiError>().toExtend<RetryableOutcome>()
  })
})

describe('isRetryableErrorKey', () => {
  it('accepts exactly the advertised transient keys', () => {
    expect(RETRYABLE_ERROR_KEYS.every(isRetryableErrorKey)).toBe(true)
  })

  it('rejects deterministic refusals and outcomes with prescribed handling', () => {
    for (const key of [
      'validation_failed',
      'not_authorized',
      'illegal_transition',
      'rate_limited',
      'unexpected_response',
      '',
    ]) {
      expect(isRetryableErrorKey(key)).toBe(false)
    }
    expect(isRetryableErrorKey(undefined)).toBe(false)
  })
})

describe('isRetryableOutcome', () => {
  it('treats a 503 upstream_unavailable as retryable', () => {
    expect(
      isRetryableOutcome({
        error: UPSTREAM_UNAVAILABLE_ERROR,
        httpStatus: UPSTREAM_UNAVAILABLE_STATUS,
      }),
    ).toBe(true)
  })

  it('treats a statusless request_timeout as retryable', () => {
    expect(isRetryableOutcome({ error: REQUEST_TIMEOUT_ERROR })).toBe(true)
  })

  it('does not recognize upstream_unavailable on another status', () => {
    expect(isRetryableOutcome({ error: UPSTREAM_UNAVAILABLE_ERROR, httpStatus: 500 })).toBe(false)
  })

  it('rejects refusals, rate limits and unclassifiable failures', () => {
    expect(isRetryableOutcome({ error: 'not_authorized', httpStatus: 403 })).toBe(false)
    expect(isRetryableOutcome({ error: 'rate_limited', httpStatus: 429 })).toBe(false)
    expect(isRetryableOutcome({ error: 'unexpected_response', httpStatus: 503 })).toBe(false)
    expect(isRetryableOutcome(null)).toBe(false)
    expect(isRetryableOutcome(undefined)).toBe(false)
  })
})

describe('shouldRetry', () => {
  it('permits a retryable read while budget remains', () => {
    expect(shouldRetry({ isMutation: false, isRetryable: true, retriesAttempted: 0 })).toBe(true)
    expect(shouldRetry({ isMutation: false, isRetryable: true, retriesAttempted: 1 })).toBe(true)
  })

  it('refuses once the two-retry budget is spent', () => {
    expect(
      shouldRetry({ isMutation: false, isRetryable: true, retriesAttempted: MAX_READ_RETRIES }),
    ).toBe(false)
    expect(shouldRetry({ isMutation: false, isRetryable: true, retriesAttempted: 7 })).toBe(false)
  })

  it('never retries a mutation, whatever the outcome or budget', () => {
    for (const retriesAttempted of [0, 1, 2]) {
      for (const isRetryable of [true, false]) {
        expect(shouldRetry({ isMutation: true, isRetryable, retriesAttempted })).toBe(false)
      }
    }
  })

  it('refuses a non-retryable read', () => {
    expect(shouldRetry({ isMutation: false, isRetryable: false, retriesAttempted: 0 })).toBe(false)
  })
})

describe('shouldRetryOutcome', () => {
  it('permits a timed-out read and refuses the same failure on a mutation', () => {
    const outcome = { error: REQUEST_TIMEOUT_ERROR } satisfies RetryableOutcome
    expect(shouldRetryOutcome({ isMutation: false, retriesAttempted: 0, outcome })).toBe(true)
    expect(shouldRetryOutcome({ isMutation: true, retriesAttempted: 0, outcome })).toBe(false)
  })

  it('refuses a denial and an unclassifiable failure on a read', () => {
    expect(
      shouldRetryOutcome({
        isMutation: false,
        retriesAttempted: 0,
        outcome: { error: 'not_authorized', httpStatus: 403 },
      }),
    ).toBe(false)
    expect(shouldRetryOutcome({ isMutation: false, retriesAttempted: 0, outcome: null })).toBe(false)
  })
})

describe('retryDelayMs', () => {
  it('increases strictly across the retry budget', () => {
    const schedule = retryDelaySchedule()
    expect(schedule).toHaveLength(MAX_READ_RETRIES)
    expect(schedule[0]).toBe(RETRY_BASE_DELAY_MS)
    for (let index = 1; index < schedule.length; index += 1) {
      expect(schedule[index]).toBeGreaterThan(schedule[index - 1] as number)
    }
  })

  it('falls back to the base delay for an unusable count', () => {
    expect(retryDelayMs(Number.NaN)).toBe(RETRY_BASE_DELAY_MS)
    expect(retryDelayMs(-1)).toBe(RETRY_BASE_DELAY_MS)
    expect(retryDelayMs(Number.POSITIVE_INFINITY)).toBe(RETRY_BASE_DELAY_MS)
  })
})
