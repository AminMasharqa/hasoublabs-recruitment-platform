import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  createSessionManager,
  type RefreshOutcome,
  type SessionEndReason,
  type SessionManager,
  type TokenPair,
  type UnauthorizedOutcome,
} from './SessionManager'

/**
 * ## How the property is read
 *
 * Design Property 5 states: *for any* number N of concurrent callers awaiting a
 * refresh, the Session_Manager issues exactly one refresh exchange and resolves
 * all N callers with the result of that single exchange; a single 401 with a
 * Refresh_Token held triggers exactly one refresh and exactly one replay of the
 * original request.
 *
 * Both halves are driven through the same generated scenario, because both go
 * through the one single-flight primitive in `SessionManager.refreshNow`:
 * `ensureFresh` (the proactive path, Req 4 AC8) and `onUnauthorized` (the
 * reactive 401 path, Req 4 AC6) are generated as an arbitrary interleaving of
 * N callers over one manager.
 *
 * ## Making "concurrent" mean concurrent
 *
 * The injected exchange stub parks on a gate promise the test releases by hand,
 * so every caller is genuinely in flight at the same time rather than merely
 * issued in sequence. The assertions therefore split in two:
 *
 * - *Before* the release: the exchange has been entered exactly once, no replay
 *   has run, and every caller that must wait on the exchange is still pending.
 *   This is what rules out "N sequential exchanges that happen to agree".
 * - *After* the release: every waiting caller resolves on the **same object**
 *   the single exchange produced (identity, not just deep equality), and the
 *   exchange is never entered a second time.
 *
 * The scheduler never fires, so the proactive timer cannot contribute an
 * exchange of its own and the count observed is purely the coalescing.
 *
 * ## The replay bound
 *
 * `onUnauthorized` replays exactly once per caller when — and only when — the
 * exchange yielded a token, including when that replay itself comes back 401:
 * the rejection propagates untouched, with no second exchange and no second
 * replay. `replayRejects` generates that branch.
 *
 * **Validates: Requirements 4.6, 4.8**
 */

// ── Fixtures ──────────────────────────────────────────────────────────────────

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** An unsigned JWT; the Web_Client never verifies the signature. */
function accessToken(expEpochSeconds: number): string {
  const claims = {
    sub: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    exp: expEpochSeconds,
    act: 'CANDIDATE',
    roles: ['CANDIDATE'],
    session_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    type: 'access',
  }
  return `${base64Url('{"alg":"HS256","typ":"JWT"}')}.${base64Url(JSON.stringify(claims))}.sig`
}

const NOW_MS = Date.UTC(2026, 0, 15, 12, 0, 0)
const NOW_SECONDS = NOW_MS / 1000

/** Inside the 60-second lead window, so `ensureFresh` must exchange. */
const DUE_EXP_SECONDS = NOW_SECONDS + 30
/** Outside the lead window, so `ensureFresh` reports `fresh` without exchanging. */
const FRESH_EXP_SECONDS = NOW_SECONDS + 1800
/** The Access_Token the exchange hands back. */
const REFRESHED_EXP_SECONDS = NOW_SECONDS + 3600

const HELD_REFRESH_TOKEN = 'refresh-1'
const ROTATED_REFRESH_TOKEN = 'refresh-2'

/** The 401 a replayed request may itself come back with (Req 4 AC6). */
const REPLAY_UNAUTHORIZED = { httpStatus: 401, error: 'invalid_token' }

function pair(expEpochSeconds: number, refreshToken: string): TokenPair {
  return { accessToken: accessToken(expEpochSeconds), refreshToken }
}

// ── Generated scenario ────────────────────────────────────────────────────────

/** Which entry point a concurrent caller uses. */
type CallerKind = 'ensureFresh' | 'onUnauthorized'

/** How the one permitted exchange ends. */
type ExchangeScenario =
  | { readonly kind: 'success' }
  | { readonly kind: 'rejected'; readonly httpStatus: number }
  | { readonly kind: 'failed'; readonly httpStatus: number | null }

interface Scenario {
  /**
   * The concurrent callers, in issue order. Length is the N of the property:
   * 1 (the degenerate single caller) through 50.
   */
  readonly callers: readonly CallerKind[]
  /** Whether the held Access_Token is already inside its refresh lead window. */
  readonly due: boolean
  readonly exchange: ExchangeScenario
  /** Whether the replayed request itself comes back 401. */
  readonly replayRejects: boolean
}

const callerKind: fc.Arbitrary<CallerKind> = fc.constantFrom<CallerKind>(
  'ensureFresh',
  'onUnauthorized',
)

const exchangeScenario: fc.Arbitrary<ExchangeScenario> = fc.oneof(
  { weight: 4, arbitrary: fc.constant<ExchangeScenario>({ kind: 'success' }) },
  {
    weight: 1,
    arbitrary: fc
      .integer({ min: 400, max: 499 })
      .map((httpStatus): ExchangeScenario => ({ kind: 'rejected', httpStatus })),
  },
  {
    weight: 1,
    // A 5xx, or a network error / timeout that carries no status at all.
    arbitrary: fc
      .option(fc.integer({ min: 500, max: 599 }), { nil: null })
      .map((httpStatus): ExchangeScenario => ({ kind: 'failed', httpStatus })),
  },
)

const scenario: fc.Arbitrary<Scenario> = fc.record({
  callers: fc.array(callerKind, { minLength: 1, maxLength: 50 }),
  due: fc.boolean(),
  exchange: exchangeScenario,
  replayRejects: fc.boolean(),
})

// ── Model ─────────────────────────────────────────────────────────────────────

/** What a caller must observe: the shared exchange, or an untouched `fresh`. */
type Expectation = 'exchange' | 'fresh'

/**
 * Derives, from the issue order alone, which callers join the single exchange.
 *
 * `onUnauthorized` always forces one. `ensureFresh` forces one only when the
 * held Access_Token is due; otherwise it reports `fresh` — unless an exchange is
 * already in flight, in which case it joins that one instead.
 */
function expectationsFor(model: Scenario): {
  readonly expectations: readonly Expectation[]
  readonly exchanges: number
} {
  let started = false
  const expectations = model.callers.map((kind): Expectation => {
    if (kind === 'onUnauthorized' || started || model.due) {
      started = true
      return 'exchange'
    }
    return 'fresh'
  })
  return { expectations, exchanges: started ? 1 : 0 }
}

/** The single {@link RefreshOutcome} every waiting caller must resolve on. */
function expectedOutcomeFor(model: Scenario): Partial<RefreshOutcome> {
  switch (model.exchange.kind) {
    case 'success':
      return { status: 'refreshed' }
    case 'rejected':
      return { status: 'rejected', httpStatus: model.exchange.httpStatus }
    case 'failed':
      return { status: 'failed' }
  }
}

function exchangeRejection(exchange: ExchangeScenario): unknown {
  if (exchange.kind === 'rejected') {
    return { httpStatus: exchange.httpStatus, error: 'invalid_token' }
  }
  return exchange.kind === 'failed' && exchange.httpStatus !== null
    ? { httpStatus: exchange.httpStatus, error: 'upstream_unavailable' }
    : new TypeError('network error')
}

/**
 * Lets already-resolvable promises settle without letting the gated exchange
 * settle: the gate is a promise, so no number of microtask turns can release it.
 */
async function flushMicrotasks(): Promise<void> {
  for (let tick = 0; tick < 8; tick += 1) {
    await Promise.resolve()
  }
}

// ── Harness ───────────────────────────────────────────────────────────────────

interface Harness {
  readonly manager: SessionManager
  /** Releases the parked exchange. */
  readonly release: () => void
  /** The Refresh_Token each entry into the exchange was handed, in order. */
  readonly exchangeTokens: readonly string[]
  /** The Access_Token each replay was handed, in order. Appended to by the replay stub. */
  readonly replayTokens: string[]
  readonly clearCacheReasons: readonly SessionEndReason[]
  readonly redirectReasons: readonly SessionEndReason[]
}

function buildHarness(model: Scenario): Harness {
  const exchangeTokens: string[] = []
  const replayTokens: string[] = []
  const clearCacheReasons: SessionEndReason[] = []
  const redirectReasons: SessionEndReason[] = []

  let openGate = (): void => undefined
  const gate = new Promise<void>((resolve) => {
    openGate = () => {
      resolve()
    }
  })

  const manager = createSessionManager({
    exchangeRefreshToken: async (refreshToken) => {
      exchangeTokens.push(refreshToken)
      // Parks here, so every caller issued afterwards is genuinely concurrent.
      await gate
      if (model.exchange.kind === 'success') {
        return pair(REFRESHED_EXP_SECONDS, ROTATED_REFRESH_TOKEN)
      }
      throw exchangeRejection(model.exchange)
    },
    revokeSession: async () => undefined,
    clearCache: (reason) => {
      clearCacheReasons.push(reason)
    },
    redirectToLogin: (reason) => {
      redirectReasons.push(reason)
    },
    now: () => NOW_MS,
    // Never fires: this property observes the coalescing, not the schedule.
    schedule: () => () => undefined,
  })

  manager.login(pair(model.due ? DUE_EXP_SECONDS : FRESH_EXP_SECONDS, HELD_REFRESH_TOKEN))

  return {
    manager,
    release: () => {
      openGate()
    },
    exchangeTokens,
    replayTokens,
    clearCacheReasons,
    redirectReasons,
  }
}

type CallerResult = PromiseSettledResult<RefreshOutcome | UnauthorizedOutcome<string>>

describe('Session_Manager refresh coalescing properties', () => {
  // Feature: frontend-web-application, Property 5: Refresh is single-flight and
  // replays once — For any number N of concurrent callers awaiting a refresh, the
  // Session_Manager issues exactly one refresh exchange and resolves all N callers
  // with the result of that single exchange; a single 401 with a refresh token held
  // triggers exactly one refresh and exactly one replay of the original request.
  //
  // **Validates: Requirements 4.6, 4.8**
  it('issues one exchange for N concurrent callers and replays each 401 once', async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async (model) => {
        const harness = buildHarness(model)
        const { expectations, exchanges } = expectationsFor(model)
        const expectedOutcome = expectedOutcomeFor(model)

        // ── Issue all N callers synchronously, so they overlap by construction ──
        const settled: boolean[] = []
        const promises: Promise<RefreshOutcome | UnauthorizedOutcome<string>>[] = []
        model.callers.forEach((kind, index) => {
          settled.push(false)
          const promise: Promise<RefreshOutcome | UnauthorizedOutcome<string>> =
            kind === 'ensureFresh'
              ? harness.manager.ensureFresh()
              : harness.manager.onUnauthorized(async (token) => {
                  harness.replayTokens.push(token)
                  if (model.replayRejects) {
                    throw REPLAY_UNAUTHORIZED
                  }
                  return `replayed-${index}`
                })
          // Also marks the promise handled, so a propagated replay 401 cannot
          // surface as an unhandled rejection.
          promise.then(
            () => {
              settled[index] = true
            },
            () => {
              settled[index] = true
            },
          )
          promises.push(promise)
        })

        // ── While the exchange is parked ───────────────────────────────────────
        await flushMicrotasks()
        // AC8: one exchange for all N, always against the held Refresh_Token.
        expect(harness.exchangeTokens).toEqual(
          exchanges === 0 ? [] : [HELD_REFRESH_TOKEN],
        )
        // No replay can precede the exchange it depends on.
        expect(harness.replayTokens).toEqual([])
        expectations.forEach((expectation, index) => {
          // Everyone bound to the exchange is still waiting on it; only the
          // untouched `fresh` callers have resolved.
          expect(settled[index]).toBe(expectation === 'fresh')
        })

        // ── Release, then observe how the single result was shared ─────────────
        const allSettled = Promise.allSettled(promises)
        harness.release()
        const results: CallerResult[] = await allSettled
        await flushMicrotasks()

        // No second exchange: not from the replays, not from a retry.
        expect(harness.exchangeTokens).toEqual(
          exchanges === 0 ? [] : [HELD_REFRESH_TOKEN],
        )

        let sharedOutcome: RefreshOutcome | null = null
        const shareOutcome = (outcome: RefreshOutcome): void => {
          expect(outcome).toMatchObject(expectedOutcome)
          if (sharedOutcome === null) {
            sharedOutcome = outcome
          }
          // Identity, not equality: every caller resolved on the result of the
          // one exchange rather than on an equal-looking result of its own.
          expect(outcome).toBe(sharedOutcome)
        }

        results.forEach((result, index) => {
          if (expectations[index] === 'fresh') {
            expect(result).toEqual({ status: 'fulfilled', value: { status: 'fresh' } })
            return
          }
          if (model.callers[index] === 'ensureFresh') {
            expect(result.status).toBe('fulfilled')
            if (result.status === 'fulfilled') {
              shareOutcome(result.value as RefreshOutcome)
            }
            return
          }
          if (model.exchange.kind !== 'success') {
            // No token to replay with: the caller receives the shared refusal.
            expect(result.status).toBe('fulfilled')
            if (result.status === 'fulfilled') {
              const outcome = result.value as UnauthorizedOutcome<string>
              expect(outcome.replayed).toBe(false)
              if (!outcome.replayed) {
                shareOutcome(outcome.refresh)
              }
            }
            return
          }
          if (model.replayRejects) {
            // AC6: the replay's own 401 propagates untouched.
            expect(result.status).toBe('rejected')
            if (result.status === 'rejected') {
              expect(result.reason).toBe(REPLAY_UNAUTHORIZED)
            }
            return
          }
          expect(result).toEqual({
            status: 'fulfilled',
            value: { replayed: true, result: `replayed-${index}` },
          })
        })

        // ── Exactly one replay per 401 caller, and only on a usable token ──────
        const unauthorizedCallers = model.callers.filter(
          (kind) => kind === 'onUnauthorized',
        ).length
        if (exchanges === 0) {
          // No caller needed an exchange, so nothing about the session moved.
          expect(unauthorizedCallers).toBe(0)
          expect(harness.replayTokens).toEqual([])
          expect(harness.clearCacheReasons).toEqual([])
          expect(harness.redirectReasons).toEqual([])
          expect(harness.manager.getAccessToken()).toBe(accessToken(FRESH_EXP_SECONDS))
          return
        }
        if (model.exchange.kind === 'success') {
          expect(harness.replayTokens).toHaveLength(unauthorizedCallers)
          // Each replay carried the Access_Token the one exchange produced.
          expect(new Set(harness.replayTokens)).toEqual(
            new Set(unauthorizedCallers === 0 ? [] : [accessToken(REFRESHED_EXP_SECONDS)]),
          )
          expect(harness.manager.getAccessToken()).toBe(accessToken(REFRESHED_EXP_SECONDS))
          expect(harness.clearCacheReasons).toEqual([])
          expect(harness.redirectReasons).toEqual([])
          return
        }

        expect(harness.replayTokens).toEqual([])
        if (model.exchange.kind === 'rejected') {
          // AC7 runs once for the one exchange, not once per waiting caller.
          expect(harness.clearCacheReasons).toEqual(['session-expired'])
          expect(harness.redirectReasons).toEqual(['session-expired'])
          expect(harness.manager.getAccessToken()).toBeNull()
        } else {
          expect(harness.clearCacheReasons).toEqual([])
          expect(harness.redirectReasons).toEqual([])
        }
      }),
      { numRuns: 200 },
    )
  })
})
