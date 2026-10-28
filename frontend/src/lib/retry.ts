/**
 * The Api_Client retry decision (Requirement 21 AC9, AC10).
 *
 * Pure logic: no HTTP, no timers, no module state. `src/api/client.ts` owns the
 * socket and the clock; this module only answers three questions about an
 * outcome it is handed:
 *
 * 1. *Is this outcome retryable at all?* — the Backend_Api reports a transient
 *    failure as a 503 `upstream_unavailable` (Requirement 3 AC11), and the
 *    Api_Client synthesizes `request_timeout` when its own 30-second budget
 *    elapses (Requirement 3 AC12). Those two, and nothing else.
 * 2. *May this particular request be retried now?* — {@link shouldRetry}, the
 *    predicate Requirement 21 AC9/AC10 specifies.
 * 3. *How long should the Api_Client wait first?* — {@link retryDelayMs}, the
 *    "increasing delay" AC9 asks for.
 *
 * ## Why a mutation is never retried
 *
 * Requirement 21 AC10 is unconditional: no request that mutates Backend_Api
 * state is ever retried automatically. A retried mutation cannot be
 * distinguished from a deliberate second submission, so a timed-out
 * `POST /jobs/{jd_id}/apply` that the Backend_Api actually committed would come
 * back as a duplicate Application or a `conflicting_state` the Candidate never
 * caused. Only the user may re-submit a mutation, through the control that
 * Requirement 21 AC12 disables while the first attempt is in flight. So
 * `isMutation` short-circuits the predicate ahead of every other consideration,
 * and no error key, status code or attempt count can override it.
 *
 * A read carries no such hazard: `GET` is idempotent by contract, so repeating
 * one costs nothing but latency — which is why the retry budget is spent there
 * and the user sees an error state only after it is exhausted.
 *
 * Requirements: 21.9, 21.10.
 */

// ── Retry budget (AC9) ────────────────────────────────────────────────────────

/**
 * Requirement 21 AC9: a failed read is retried **at most twice**.
 *
 * Counted in retries, not in attempts: a read that keeps failing is issued at
 * most `1 + MAX_READ_RETRIES` times in total.
 */
export const MAX_READ_RETRIES = 2

/** Delay before the first retry, in milliseconds. */
export const RETRY_BASE_DELAY_MS = 250

/** Factor each successive retry delay is multiplied by, giving AC9's increasing delay. */
export const RETRY_BACKOFF_FACTOR = 2

// ── Retryable outcomes (Req 3 AC11, AC12) ─────────────────────────────────────

/** `error` key of the transient upstream failure the Backend_Api reports (Req 3 AC11). */
export const UPSTREAM_UNAVAILABLE_ERROR = 'upstream_unavailable'

/** The only status code `upstream_unavailable` is advertised on (Req 3 AC11). */
export const UPSTREAM_UNAVAILABLE_STATUS = 503

/** `error` key the Api_Client synthesizes when its request budget elapses (Req 3 AC12). */
export const REQUEST_TIMEOUT_ERROR = 'request_timeout'

/**
 * The complete set of Error_Envelope `error` keys that report a retryable
 * outcome.
 *
 * Deliberately narrow. A retryable outcome is one the Backend_Api itself
 * describes as transient, so the set is exactly what the requirements name: the
 * 503 upstream failure (Requirement 3 AC11) and the client-side timeout
 * (Requirement 3 AC12). Everything else is either a deterministic refusal that
 * a second identical request would earn again (`validation_failed`,
 * `not_authorized`, `illegal_transition`) or an outcome with its own prescribed
 * handling — 401 goes to the Session_Manager refresh path, 403 to the uniform
 * denial surface, and 429 surfaces its `Retry-After` to the user rather than
 * being re-sent automatically against a limit that is still in force.
 */
export const RETRYABLE_ERROR_KEYS = [UPSTREAM_UNAVAILABLE_ERROR, REQUEST_TIMEOUT_ERROR] as const

/** Union of the retryable Error_Envelope `error` keys. */
export type RetryableErrorKey = (typeof RETRYABLE_ERROR_KEYS)[number]

/**
 * The part of a decoded failure that decides retryability.
 *
 * Structural rather than an `ApiError` import so the Api_Client, a test or the
 * Error_Presenter can all ask the question with whatever they hold. An `ApiError`
 * satisfies it as-is.
 */
export interface RetryableOutcome {
  /** The Error_Envelope `error` key. */
  readonly error: string
  /** The response status code, where the failure came from a response at all. */
  readonly httpStatus?: number | undefined
}

/** Whether an Error_Envelope `error` key names a retryable outcome. */
export function isRetryableErrorKey(error: unknown): error is RetryableErrorKey {
  return typeof error === 'string' && (RETRYABLE_ERROR_KEYS as readonly string[]).includes(error)
}

/**
 * Whether a decoded failure reports a retryable outcome (Req 3 AC11, AC12).
 *
 * Derived from the decoded envelope rather than from a status-code range, so the
 * classification follows the Backend_Api's own taxonomy. `upstream_unavailable`
 * additionally has to arrive on its advertised 503 — the same key on another
 * status is not a contract the Api_Client recognizes — while a synthesized
 * `request_timeout` carries no status at all, because no response arrived.
 *
 * Returns `false` for a missing outcome: an unclassifiable failure is surfaced,
 * not retried.
 */
export function isRetryableOutcome(outcome: RetryableOutcome | null | undefined): boolean {
  if (outcome == null) {
    return false
  }
  if (outcome.error === REQUEST_TIMEOUT_ERROR) {
    return true
  }
  if (outcome.error === UPSTREAM_UNAVAILABLE_ERROR) {
    return outcome.httpStatus === undefined || outcome.httpStatus === UPSTREAM_UNAVAILABLE_STATUS
  }
  return false
}

// ── The retry decision (AC9, AC10) ────────────────────────────────────────────

/**
 * Everything the retry decision depends on — and nothing else.
 *
 * The three facts of Requirement 21 AC9/AC10, kept free of the request and the
 * response they were read off so the predicate stays a pure function of them.
 */
export interface RetryContext {
  /** `true` when the request mutates Backend_Api state (AC10). */
  readonly isMutation: boolean
  /** `true` when the outcome reports a retryable failure (AC9); see {@link isRetryableOutcome}. */
  readonly isRetryable: boolean
  /**
   * Retries already spent on this request, `0` on the first failure.
   *
   * Counts retries, not attempts, so it is compared against
   * {@link MAX_READ_RETRIES} directly.
   */
  readonly retriesAttempted: number
}

/**
 * Whether the Api_Client may retry a failed request (Requirement 21 AC9, AC10).
 *
 * The conjunction the requirements specify, and exactly that: a retry is
 * permitted **if and only if** the request is a read, the outcome is retryable,
 * and fewer than {@link MAX_READ_RETRIES} retries have been spent. Every other
 * combination — any mutation, any non-retryable outcome, an exhausted budget —
 * yields `false`, and the caller renders the error state (Requirement 21 AC8).
 *
 * Note the ordering is immaterial to the result: `&&` over three independent
 * booleans commutes, so there is no precedence between "mutation" and "budget
 * exhausted" to reason about. `isMutation` is tested first only to make AC10's
 * unconditional prohibition the first thing a reader sees.
 */
export function shouldRetry(context: RetryContext): boolean {
  return !context.isMutation && context.isRetryable && context.retriesAttempted < MAX_READ_RETRIES
}

/** A failed request awaiting a retry decision, with retryability still to be classified. */
export interface RetryAttempt {
  /** `true` when the request mutates Backend_Api state (AC10). */
  readonly isMutation: boolean
  /** Retries already spent on this request, `0` on the first failure. */
  readonly retriesAttempted: number
  /** The decoded failure, or `null`/`undefined` when it could not be classified. */
  readonly outcome: RetryableOutcome | null | undefined
}

/**
 * {@link shouldRetry} applied to a decoded failure — the one call the Api_Client
 * makes per failed request.
 *
 * Classifies the outcome with {@link isRetryableOutcome} and feeds the result to
 * the predicate, so the two concerns stay separately testable.
 */
export function shouldRetryOutcome(attempt: RetryAttempt): boolean {
  return shouldRetry({
    isMutation: attempt.isMutation,
    isRetryable: isRetryableOutcome(attempt.outcome),
    retriesAttempted: attempt.retriesAttempted,
  })
}

// ── Increasing delay (AC9) ────────────────────────────────────────────────────

/**
 * How long to wait before the next retry, in milliseconds (Requirement 21 AC9).
 *
 * Exponential in the retries already spent — 250 ms before the first retry,
 * 500 ms before the second — so each wait is strictly longer than the last, as
 * AC9's "increasing delay" requires, while the whole budget still resolves well
 * inside a second of added latency. An unusable count falls back to the base
 * delay rather than producing a nonsense timer.
 */
export function retryDelayMs(retriesAttempted: number): number {
  if (!Number.isFinite(retriesAttempted) || retriesAttempted <= 0) {
    return RETRY_BASE_DELAY_MS
  }
  return RETRY_BASE_DELAY_MS * RETRY_BACKOFF_FACTOR ** retriesAttempted
}

/** The full schedule of retry delays, in order: what a read spends its budget on. */
export function retryDelaySchedule(): readonly number[] {
  return Array.from({ length: MAX_READ_RETRIES }, (_unused, index) => retryDelayMs(index))
}
