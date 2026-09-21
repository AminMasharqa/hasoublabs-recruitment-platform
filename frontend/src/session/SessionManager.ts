/**
 * Session_Manager — in-memory token custody, proactive refresh scheduling,
 * single-flight refresh coalescing and 401-driven refresh-and-replay
 * (Requirement 4 AC3, AC5–AC11).
 *
 * ## Dependency inversion: this module issues no HTTP
 *
 * The Api_Client (`src/api/client.ts`) is the *sole* HTTP layer of the
 * Web_Client (Requirement 3 AC1), and it is also the module that discovers a 401
 * and asks the Session_Manager to recover from it. If the Session_Manager called
 * the Api_Client directly the two would form an import cycle, and the Api_Client
 * does not exist yet.
 *
 * So every effect that reaches outside this module is injected through
 * {@link SessionManagerConfig}:
 *
 * - `exchangeRefreshToken` — `POST /auth/refresh` with `{refresh_token}` (AC4).
 * - `revokeSession` — `POST /auth/logout` (AC9).
 * - `clearCache` — discards every cached server-state entry (AC7, AC9).
 * - `redirectToLogin` — navigates to the login screen, with the session-expired
 *   notice when the reason calls for it (AC7, AC9).
 * - `now` / `schedule` — the clock and the timer, so the proactive refresh
 *   schedule (AC4) is observable without patching globals.
 *
 * The wiring lives where the collaborators do: the Api_Client supplies the two
 * token exchanges, the shell supplies the TanStack Query cache reset and the
 * router navigation. Tests supply stubs and drive the schedule by hand — no fake
 * timers, no mocked `fetch`, no module mocking.
 *
 * ## In memory only (AC3, AC11)
 *
 * Both tokens and the decoded principal live in closure variables of
 * {@link createSessionManager} and nowhere else. This module reads and writes no
 * `localStorage`, no `sessionStorage`, no cookie and no IndexedDB, and hands the
 * Access_Token to nobody but the injected exchanges and the replay callback. A
 * page reload therefore constructs a manager with no session at all, which is
 * exactly AC11: the user signs in again.
 *
 * For the same reason the reactive snapshot exposed to React
 * ({@link SessionSnapshot}) carries the principal but *not* the tokens: nothing
 * that ends up in component props, React DevTools or a rendering-error overlay
 * should carry token material.
 *
 * ## Freshness has one funnel
 *
 * Both the proactive timer and the reactive 401 path go through one single-flight
 * primitive, so concurrent callers share a single exchange and all resolve on its
 * result (AC8). Neither path touches in-flight requests: a successful exchange
 * only replaces the two stored tokens, leaving the request queue intact (AC5).
 *
 * Requirements: 4.3, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11.
 */

import {
  decodePrincipal,
  refreshTimingForToken,
  type Principal,
  type RefreshTiming,
} from '../lib/refresh'

export type { Principal } from '../lib/refresh'

// ── Tokens ────────────────────────────────────────────────────────────────────

/**
 * The token pair the Backend_Api issues from `POST /auth/login`,
 * `POST /auth/refresh` and `POST /auth/context`.
 *
 * The wire shape is `TokenResponse` (`{access_token, refresh_token, expires_in,
 * token_type}`); {@link tokenPairFrom} narrows it to the two members this module
 * keeps. `expires_in` is deliberately dropped: the refresh schedule is computed
 * from the `exp` claim of the Access_Token itself, which is what the Backend_Api
 * actually enforces.
 */
export interface TokenPair {
  /** The Access_Token, attached as `Authorization: Bearer` by the Api_Client. */
  readonly accessToken: string
  /** The Refresh_Token, sent as `{refresh_token}` to `POST /auth/refresh`. */
  readonly refreshToken: string
}

/** The `TokenResponse` members this module consumes. */
export interface TokenResponseLike {
  readonly access_token: string
  readonly refresh_token: string
}

/** Narrows a Backend_Api `TokenResponse` to a {@link TokenPair}. */
export function tokenPairFrom(response: TokenResponseLike): TokenPair {
  return { accessToken: response.access_token, refreshToken: response.refresh_token }
}

// ── Session teardown ──────────────────────────────────────────────────────────

/**
 * Why a session ended — the only distinction the login screen needs.
 *
 * - `logout` — the user activated the logout control (AC9, AC10).
 * - `session-expired` — a Refresh_Token exchange was refused with a 4xx, so the
 *   login screen shows the session-expired notice (AC7).
 */
export type SessionEndReason = 'logout' | 'session-expired'

// ── Refresh outcomes ──────────────────────────────────────────────────────────

/**
 * The result of asking for a fresh Access_Token.
 *
 * {@link SessionManager.ensureFresh} never rejects; every way an exchange can end
 * is one of these members. That matters for the proactive timer, whose callback
 * has nobody to hand a rejection to.
 */
export type RefreshOutcome =
  /** The held Access_Token is not yet due for exchange; no request was issued. */
  | { readonly status: 'fresh' }
  /** The exchange succeeded: both tokens were replaced (AC5). */
  | { readonly status: 'refreshed'; readonly principal: Principal | null }
  /** No Refresh_Token is held, so there is nothing to exchange (AC6 precondition). */
  | { readonly status: 'no-session' }
  /**
   * The exchange was refused with a 400–499. The session has already been
   * discarded, the cache cleared and the redirect issued (AC7).
   */
  | { readonly status: 'rejected'; readonly httpStatus: number }
  /**
   * The exchange failed for a reason that is not a 4xx — a 5xx, a timeout, a
   * network error. The tokens are *kept*: AC7 ties discarding them to a 4xx
   * specifically, and a Backend_Api that is briefly unavailable has not
   * invalidated anything.
   */
  | { readonly status: 'failed'; readonly error: unknown }
  /**
   * The session was torn down (logout, or a 4xx on another path) while this
   * exchange was in flight, so its result was discarded rather than reviving a
   * session the user already ended.
   */
  | { readonly status: 'superseded' }

/** A {@link RefreshOutcome} that did not produce a usable Access_Token. */
export type UnusableRefreshOutcome = Exclude<
  RefreshOutcome,
  { readonly status: 'refreshed' } | { readonly status: 'fresh' }
>

/**
 * The result of the reactive 401 path: either the one permitted replay ran, or
 * the refresh did not yield a token to replay with (AC6).
 */
export type UnauthorizedOutcome<T> =
  | { readonly replayed: true; readonly result: T }
  | { readonly replayed: false; readonly refresh: UnusableRefreshOutcome }

// ── Injected effects ──────────────────────────────────────────────────────────

/** Cancels a scheduled callback. Calling it twice, or after the callback ran, is a no-op. */
export type CancelScheduled = () => void

/**
 * Arms a one-shot timer. `delayMs` is never negative.
 *
 * The default is `setTimeout`; tests pass a recorder and fire the callback when
 * they want the schedule to elapse.
 */
export type Scheduler = (callback: () => void, delayMs: number) => CancelScheduled

/** Reads the current instant in epoch milliseconds. Defaults to `Date.now`. */
export type Clock = () => number

/** The default clock. */
export const systemClock: Clock = () => Date.now()

/** The default scheduler. */
export const timeoutScheduler: Scheduler = (callback, delayMs) => {
  const handle = setTimeout(callback, delayMs)
  return () => {
    clearTimeout(handle)
  }
}

/**
 * Floor applied to an immediately-due refresh delay.
 *
 * `computeRefreshTiming` reports `delayMs: 0` for a token already inside its
 * 60-second lead window, which is correct — the exchange is overdue. But arming
 * a 0ms timer with a token that is *always* overdue (a Backend_Api issuing
 * sub-60-second tokens) would spin the exchange as fast as the event loop
 * allows. The floor bounds that to one exchange per second while still
 * satisfying AC4, which only constrains how *late* a refresh may be.
 */
export const MIN_REFRESH_DELAY_MS = 1000

/** Effects the Session_Manager needs but must not implement itself. */
export interface SessionManagerConfig {
  /**
   * Exchanges a Refresh_Token at `POST /auth/refresh` (AC4, AC5).
   *
   * Resolves with the new pair. Rejects on failure; a rejection carrying an
   * `httpStatus` in 400–499 (the `ApiError` shape from `src/api/errors.ts`) is
   * read as "this Refresh_Token is dead" and triggers AC7.
   */
  readonly exchangeRefreshToken: (refreshToken: string) => Promise<TokenPair>
  /**
   * Calls `POST /auth/logout` for the held Access_Token (AC9).
   *
   * A rejection is swallowed: the session is discarded regardless of the
   * response status (AC10).
   */
  readonly revokeSession: (accessToken: string) => Promise<void>
  /**
   * Discards every cached server-state entry — the whole TanStack Query cache
   * (AC7, AC9). Called before the redirect so no stale screen can paint.
   */
  readonly clearCache: (reason: SessionEndReason) => void
  /**
   * Navigates to the login screen. The login screen renders the session-expired
   * notice when `reason` is `session-expired` (AC7).
   */
  readonly redirectToLogin: (reason: SessionEndReason) => void
  /** Clock override. Defaults to {@link systemClock}. */
  readonly now?: Clock
  /** Timer override. Defaults to {@link timeoutScheduler}. */
  readonly schedule?: Scheduler
}

// ── Reactive snapshot ─────────────────────────────────────────────────────────

/**
 * What the app may observe about the session.
 *
 * Carries no token material on purpose (see the module comment): a component
 * that needs to talk to the Backend_Api goes through the Api_Client, which reads
 * the token from {@link SessionManager.getAccessToken} at request time.
 *
 * Instances are frozen and replaced only when the session actually changes, so
 * `useSyncExternalStore` can compare them by identity.
 */
export interface SessionSnapshot {
  /** The decoded Access_Token claims, or `null` when no session is held. */
  readonly principal: Principal | null
  /** Whether an Access_Token is held. */
  readonly authenticated: boolean
}

const ABSENT_SESSION: SessionSnapshot = Object.freeze({ principal: null, authenticated: false })

// ── The interface ─────────────────────────────────────────────────────────────

/** In-memory token custody and refresh coordination (Requirement 4). */
export interface SessionManager {
  /**
   * Adopts a token pair: stores both tokens, decodes the principal and arms the
   * proactive refresh timer (AC2, AC4).
   *
   * Returns the decoded principal so the caller can navigate to the landing
   * destination of the Active_Context, or `null` when the Access_Token could not
   * be decoded. The navigation itself is the caller's: this module knows nothing
   * about routes.
   *
   * Also the entry point for a context switch (`POST /auth/context`, Req 8 AC10):
   * clear the cache, then adopt the new pair and rebuild the menu from the new
   * `act`. No redirect and no cache reset happen here, which is why the switch
   * keeps the session alive while {@link clear} ends it.
   */
  login(pair: TokenPair): Principal | null
  /** The held Access_Token, or `null`. Read by the Api_Client on every request. */
  getAccessToken(): string | null
  /** The decoded Access_Token claims, or `null`. */
  getPrincipal(): Principal | null
  /** Whether an Access_Token is held. */
  isAuthenticated(): boolean
  /**
   * Ensures the held Access_Token is not inside its 60-second lead window,
   * exchanging the Refresh_Token if it is (AC4, AC8).
   *
   * Single-flight: concurrent callers receive the same promise and resolve on
   * the result of one exchange. Never rejects — every failure mode is a
   * {@link RefreshOutcome}.
   */
  ensureFresh(): Promise<RefreshOutcome>
  /**
   * The reactive 401 path: at most one Refresh_Token exchange and at most one
   * replay of the original request (AC6).
   *
   * `replay` is invoked exactly once, with the Access_Token the exchange
   * produced, and only when the exchange produced one. A 401 from the replay is
   * propagated to the caller untouched — there is no second refresh and no
   * second replay, which is what bounds the recursion structurally.
   *
   * Concurrent 401s coalesce onto the single in-flight exchange (AC8) and each
   * replays its own request once.
   */
  onUnauthorized<T>(replay: (accessToken: string) => Promise<T>): Promise<UnauthorizedOutcome<T>>
  /**
   * Calls `POST /auth/logout`, then discards both tokens, clears the cache and
   * redirects to login — regardless of the response status, including when the
   * call fails outright (AC9, AC10).
   */
  logout(): Promise<void>
  /**
   * Ends the session now: cancels the refresh timer, discards both tokens and
   * the principal, clears every cached server-state entry and redirects to
   * login (AC7, AC9).
   *
   * An exchange still in flight is neutralized: its result is discarded rather
   * than reviving the session.
   */
  clear(reason: SessionEndReason): void
  /** The current {@link SessionSnapshot}; stable by identity until the session changes. */
  getSnapshot(): SessionSnapshot
  /**
   * Subscribes to session changes. Returns the unsubscribe function.
   *
   * Exists for `SessionContext` (`useSyncExternalStore`); this module holds no
   * React import.
   */
  subscribe(listener: () => void): () => void
}

// ── Rejection classification (AC7) ────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * The HTTP status a refresh rejection carries, or `null` when it carries none.
 *
 * Reads the `httpStatus` member of the `ApiError` the Api_Client throws. A
 * network error, a timeout or a thrown non-error has no status and is therefore
 * never treated as a 4xx.
 */
export function refreshRejectionStatus(error: unknown): number | null {
  if (!isRecord(error)) {
    return null
  }
  const status = error['httpStatus']
  return typeof status === 'number' && Number.isFinite(status) ? status : null
}

/** Whether a refresh rejection means the Refresh_Token is dead (AC7). */
export function isRefreshRejected(error: unknown): boolean {
  const status = refreshRejectionStatus(error)
  return status !== null && status >= 400 && status <= 499
}

// ── Construction ──────────────────────────────────────────────────────────────

/** An exchange outcome, which — unlike {@link RefreshOutcome} — is never `fresh`. */
type ExchangeOutcome = Exclude<RefreshOutcome, { readonly status: 'fresh' }>

const FRESH: RefreshOutcome = Object.freeze({ status: 'fresh' })
const NO_SESSION: UnusableRefreshOutcome = Object.freeze({ status: 'no-session' })
const SUPERSEDED: UnusableRefreshOutcome = Object.freeze({ status: 'superseded' })

/**
 * Creates a Session_Manager over the injected effects.
 *
 * All state is closure-local, so a new instance — which is what a page reload
 * produces — starts with no session (AC3, AC11). The app constructs exactly one
 * instance in the shell; tests construct one per case and share nothing.
 */
export function createSessionManager(config: SessionManagerConfig): SessionManager {
  const now = config.now ?? systemClock
  const schedule = config.schedule ?? timeoutScheduler

  let accessToken: string | null = null
  let refreshToken: string | null = null
  let principal: Principal | null = null
  let snapshot: SessionSnapshot = ABSENT_SESSION

  let cancelTimer: CancelScheduled | null = null
  let inflight: Promise<ExchangeOutcome> | null = null
  /**
   * Bumped by every teardown. An exchange captures it at the start and discards
   * its own result if the value moved, which is what stops a refresh that was
   * already in flight from resurrecting a session the user logged out of.
   */
  let generation = 0

  const listeners = new Set<() => void>()

  function publish(): void {
    snapshot =
      accessToken === null && principal === null
        ? ABSENT_SESSION
        : Object.freeze({ principal, authenticated: accessToken !== null })
    for (const listener of listeners) {
      listener()
    }
  }

  function cancelScheduledRefresh(): void {
    if (cancelTimer !== null) {
      cancelTimer()
      cancelTimer = null
    }
  }

  /** Arms the proactive timer for the held Access_Token (AC4). */
  function scheduleProactiveRefresh(): void {
    cancelScheduledRefresh()
    if (accessToken === null) {
      return
    }
    const timing: RefreshTiming | null = refreshTimingForToken(accessToken, now())
    if (timing === null) {
      // An Access_Token whose claims do not decode gives nothing to schedule
      // against. The reactive 401 path remains the safety net.
      return
    }
    const delayMs = timing.due ? Math.max(timing.delayMs, MIN_REFRESH_DELAY_MS) : timing.delayMs
    cancelTimer = schedule(() => {
      cancelTimer = null
      // `ensureFresh` never rejects, so the timer callback cannot produce an
      // unhandled rejection.
      void ensureFresh()
    }, delayMs)
  }

  /**
   * Replaces both tokens and re-arms the timer (AC2, AC5).
   *
   * Nothing here touches in-flight requests or the cache: a refresh is a token
   * swap and the request queue is left intact (AC5).
   */
  function adopt(pair: TokenPair): Principal | null {
    accessToken = pair.accessToken
    refreshToken = pair.refreshToken
    principal = decodePrincipal(pair.accessToken)
    scheduleProactiveRefresh()
    publish()
    return principal
  }

  /** Discards tokens, the principal and any scheduled or in-flight refresh. */
  function discard(): void {
    cancelScheduledRefresh()
    inflight = null
    generation += 1
    accessToken = null
    refreshToken = null
    principal = null
  }

  function clear(reason: SessionEndReason): void {
    discard()
    publish()
    // Cache first, then navigation: a login screen must never paint over data
    // from the session that just ended.
    config.clearCache(reason)
    config.redirectToLogin(reason)
  }

  /** The single-flight exchange. Always issues a request unless one is already in flight. */
  function refreshNow(): Promise<ExchangeOutcome> {
    if (inflight !== null) {
      return inflight
    }
    const token = refreshToken
    if (token === null) {
      return Promise.resolve(NO_SESSION)
    }
    const attempt = exchange(token, generation).finally(() => {
      // Only retire this attempt; a teardown or a newer exchange may already
      // have replaced the slot.
      if (inflight === attempt) {
        inflight = null
      }
    })
    inflight = attempt
    return attempt
  }

  async function exchange(token: string, startedAt: number): Promise<ExchangeOutcome> {
    try {
      const pair = await config.exchangeRefreshToken(token)
      if (generation !== startedAt) {
        return SUPERSEDED
      }
      return { status: 'refreshed', principal: adopt(pair) }
    } catch (error) {
      if (generation !== startedAt) {
        return SUPERSEDED
      }
      if (isRefreshRejected(error)) {
        const httpStatus = refreshRejectionStatus(error) ?? 400
        clear('session-expired')
        return { status: 'rejected', httpStatus }
      }
      return { status: 'failed', error }
    }
  }

  function ensureFresh(): Promise<RefreshOutcome> {
    if (inflight !== null) {
      return inflight
    }
    if (refreshToken === null) {
      return Promise.resolve(NO_SESSION)
    }
    if (accessToken !== null) {
      const timing = refreshTimingForToken(accessToken, now())
      if (timing !== null && !timing.due) {
        return Promise.resolve(FRESH)
      }
    }
    return refreshNow()
  }

  async function onUnauthorized<T>(
    replay: (accessToken: string) => Promise<T>,
  ): Promise<UnauthorizedOutcome<T>> {
    // Forced rather than `ensureFresh`: the Backend_Api has rejected the token
    // we hold, so its `exp` claim says nothing useful. Concurrent 401s still
    // coalesce onto one exchange (AC8).
    const outcome = await refreshNow()
    if (outcome.status !== 'refreshed') {
      return { replayed: false, refresh: outcome }
    }
    const token = accessToken
    if (token === null) {
      // Torn down between the exchange resolving and this line.
      return { replayed: false, refresh: SUPERSEDED }
    }
    return { replayed: true, result: await replay(token) }
  }

  async function logout(): Promise<void> {
    const token = accessToken
    // Stop the proactive timer and neutralize any in-flight exchange before
    // awaiting, so nothing can hand this session a new token pair while the
    // logout call is on the wire.
    discard()
    publish()
    if (token !== null) {
      try {
        await config.revokeSession(token)
      } catch {
        // AC10: the session is discarded regardless of the response status.
      }
    }
    config.clearCache('logout')
    config.redirectToLogin('logout')
  }

  return {
    login: adopt,
    getAccessToken: () => accessToken,
    getPrincipal: () => principal,
    isAuthenticated: () => accessToken !== null,
    ensureFresh,
    onUnauthorized,
    logout,
    clear,
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
