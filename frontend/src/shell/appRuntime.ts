/**
 * The runtime the application shell is built on: the TanStack Query cache, the
 * Api_Client, the Session_Manager and the router, wired to each other.
 *
 * `AppShell.tsx` renders the providers; this module decides *what they are
 * providers of*. It holds no JSX and no React state, so the whole wiring — the
 * cache reset, the login redirect, the failure observers — is constructible and
 * assertable in a unit test with no rendering at all.
 *
 * ## The construction order is forced by a cycle
 *
 * Four collaborators, each needing one of the others:
 *
 * - the Session_Manager needs a cache reset (Req 4 AC7, AC9) and a navigation to
 *   the login screen (Req 4 AC7, AC9),
 * - the navigation needs the router,
 * - the router needs the Api_Client, because the Route_Guard issues
 *   `GET /me/status` with it (Req 7 AC1),
 * - and the Api_Client needs the Session_Manager for the token and the 401 path
 *   (Req 3 AC2, AC7).
 *
 * So the cycle is broken the same way `createApiRuntime` breaks its own half: the
 * two effects the Session_Manager receives are closures over a `router` binding
 * that is filled in one line later. By the time either can fire — a refresh
 * rejection or a logout, both of which require a session, which requires a
 * rendered login screen — the router exists.
 *
 * ## Clearing the cache is wired once, for all three triggers
 *
 * {@link createAppRuntime} passes the *same* reset function to the
 * Session_Manager as `clearCache` and publishes it on the runtime for the
 * ContextSwitch control (task 12.2) to call through
 * `appServices.useClearServerState`. Logout (Req 4 AC9, AC10), a refresh refused
 * with a 4xx (Req 4 AC7) and a context switch (Req 8 AC11) therefore all run one
 * implementation — there is no second code path that could clear less.
 *
 * ## Every failure is observed once, in one place
 *
 * `ApiClientConfig.onFailure` fires for exactly the failures a caller is about to
 * see, on every request the application makes, and never on a success. Two
 * cross-cutting obligations hang off that single hook:
 *
 * - Requirement 23 AC3 — the most recent failed Support_Reference is retained for
 *   the browsing context, so the recovery boundary and the error surfaces can
 *   quote it (`errors/supportReferenceStore.ts`).
 * - Requirement 7 AC6 — an `account_not_approved` envelope from *any* request
 *   replaces the retained Account_Status and, through the Route_Guard's next
 *   decision, sends the user to the Status_Notice (`routing/accountStatus.ts`).
 *
 * Wiring both here is what makes "any request" true without every feature slice
 * having to remember to report its own failures.
 *
 * Requirements: 1.2, 1.3, 4.7, 4.9, 8.11.
 */

import { QueryClient } from '@tanstack/react-query'
import type { ReactElement } from 'react'

import {
  createApiRuntime,
  type ApiClient,
  type ApiFailure,
  type ApiRuntimeConfig,
} from '../api/client'
import { recordFailedSupportReference } from '../errors/supportReferenceStore'
import { reportAccountNotApproved } from '../routing/accountStatus'
import { LOGIN_PATH } from '../routing/paths'
import { createAppRouter, type ScreenElements } from '../routing/routes'
import { recordSessionEnd } from '../session/sessionEndNotice'
import type { SessionEndReason, SessionManager } from '../session/SessionManager'

import type { ServerStateResetReason } from './appServices'

/** The data router the shell renders. */
export type AppRouter = ReturnType<typeof createAppRouter>

// ── The session-end notice carried to the login screen (Req 4 AC7, AC9) ───────

/**
 * The `Location.state` attached to the redirect the Session_Manager triggers when
 * a session ends.
 *
 * Requirement 4 AC7 asks for a *session-expired notice* on the login screen, and
 * AC9 asks for a redirect after a logout without one. Both arrive at the same
 * path, so the reason rides along in router state — not in the URL, which would
 * put a session event into the address bar and the history entry.
 */
export interface SessionEndState {
  readonly sessionEnded: SessionEndReason
}

/** Builds the login-redirect state for a session that has ended. */
export function sessionEndRedirectState(reason: SessionEndReason): SessionEndState {
  return { sessionEnded: reason }
}

/**
 * Whether the login screen should render the session-expired notice (Req 4 AC7).
 *
 * The seam the login screen (task 14.1) reads its notice from. Tolerates any
 * state shape, so a direct navigation to the login screen simply shows no notice.
 */
export function wasSessionExpired(state: unknown): boolean {
  if (typeof state !== 'object' || state === null) {
    return false
  }
  return (state as Partial<SessionEndState>).sessionEnded === 'session-expired'
}

// ── The TanStack Query cache (Req 1 AC3) ──────────────────────────────────────

/**
 * Creates the single TanStack Query cache of the application.
 *
 * `retry: false` on both queries and mutations is not a relaxation — it is what
 * keeps Requirement 21 AC9/AC10 enforceable. The Api_Client already retries an
 * idempotent read at most twice with increasing delay and never retries a
 * mutation (`lib/retry.ts`, Property 19). A second retry budget layered on top
 * would multiply those attempts and would happily re-issue a mutation, so the
 * cache defers retrying entirely to the layer that owns the policy.
 *
 * `refetchOnWindowFocus` is off for the same reason a screen never refetches
 * behind the user's back: every read in this application is either explicitly
 * invalidated by the mutation that changed it or polled on a schedule the
 * requirements name (CV scan state, extraction drafts, export jobs).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        // Reads are invalidated by the mutations that change them, so a cached
        // entry is served until something says otherwise.
        staleTime: 30_000,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

// ── Construction ──────────────────────────────────────────────────────────────

export interface AppRuntimeOptions {
  /**
   * The root layout element — the shell chrome with the recovery boundary around
   * the routed `Outlet`.
   *
   * Supplied by the caller rather than built here because it is JSX and this
   * module is deliberately JSX-free; `AppShell.tsx` passes `<AppShellLayout />`.
   */
  readonly shellElement: ReactElement
  /** Real screens for paths whose feature slice exists (see `routing/routes.tsx`). */
  readonly elements?: ScreenElements
  /** Sub-path the application is served from, when it is not the origin root. */
  readonly basename?: string
  /** Cache override, for a test that wants to inspect or seed it. */
  readonly queryClient?: QueryClient
  /**
   * Overrides for the effects the Api_Client and the Session_Manager reach the
   * outside world through — `fetch`, the clock, the timer, the base URL, the
   * Locale reader.
   *
   * The three the shell owns are deliberately not overridable: `clearCache` and
   * `redirectToLogin` are what Requirements 4 AC7/AC9 and 8 AC11 are satisfied
   * by, and `onFailure` is what makes Requirements 7 AC6 and 23 AC3 hold for
   * *every* request. A caller that could replace them could silently drop them.
   */
  readonly apiRuntime?: Omit<ApiRuntimeConfig, 'clearCache' | 'redirectToLogin' | 'onFailure'>
}

/** Everything the shell providers need, wired together. */
export interface AppRuntime {
  /** The sole HTTP layer (Requirement 3 AC1). */
  readonly api: ApiClient
  /** In-memory token custody and refresh (Requirement 4). */
  readonly session: SessionManager
  /** The server-state cache (Requirement 1 AC3). */
  readonly queryClient: QueryClient
  /** The data router (Requirement 1 AC5). */
  readonly router: AppRouter
  /** Discards every cached server-state entry (Req 4 AC7, AC9, Req 8 AC11). */
  readonly clearServerState: (reason: ServerStateResetReason) => void
}

/**
 * Builds the application runtime.
 *
 * Called once per browsing context by {@link import('./AppShell').AppShell}, and
 * once per case by a test. Nothing is shared between instances: the tokens, the
 * cache and the router all belong to the instance, which is what makes a page
 * reload start from no session (Requirement 4 AC11).
 */
export function createAppRuntime(options: AppRuntimeOptions): AppRuntime {
  const queryClient = options.queryClient ?? createQueryClient()

  // Filled in below, once the Api_Client the router needs exists. Only reachable
  // from effects that presuppose a session, so it is never read while null.
  let router: AppRouter | null = null

  /**
   * Requirement 4 AC7, AC9 and Requirement 8 AC11: discard the entire cache.
   *
   * In-flight reads are cancelled first. `clear()` removes the entries, but a
   * fetch already on the wire would still resolve and re-add its own entry —
   * carrying data fetched under the session, or the Active_Context, that has just
   * been left behind.
   */
  const clearServerState = (_reason: ServerStateResetReason): void => {
    void queryClient.cancelQueries()
    queryClient.clear()
  }

  /**
   * Requirement 4 AC7, AC9: land on the login screen, with the notice AC7 asks for.
   *
   * The reason is recorded *before* the navigation and independently of it. The
   * Route_Guard above the screen the session was displayed under issues its own
   * redirect to the login screen on the very next render, carrying the retained
   * location and no reason, and that redirect lands last — so the state below is
   * the reason's less reliable half. See `session/sessionEndNotice.ts`.
   */
  const redirectToLogin = (reason: SessionEndReason): void => {
    recordSessionEnd(reason)
    void router?.navigate(LOGIN_PATH, {
      replace: true,
      state: sessionEndRedirectState(reason),
    })
  }

  /**
   * The single failure observer: Requirement 23 AC3 and Requirement 7 AC6 for
   * every request the application issues. See the module comment.
   */
  const onFailure = (failure: ApiFailure): void => {
    recordFailedSupportReference(failure.supportReference)
    reportAccountNotApproved(failure)
  }

  const { api, session } = createApiRuntime({
    ...options.apiRuntime,
    clearCache: clearServerState,
    redirectToLogin,
    onFailure,
  })

  router = createAppRouter({
    api,
    shellElement: options.shellElement,
    ...(options.elements === undefined ? {} : { elements: options.elements }),
    ...(options.basename === undefined ? {} : { basename: options.basename }),
  })

  return { api, session, queryClient, router, clearServerState }
}

// ── The one runtime of a browsing context ─────────────────────────────────────

/**
 * The runtime of this browsing context, created on first use.
 *
 * Module-scoped rather than held in component state because its lifetime *is* the
 * module's lifetime: the tokens live for the browsing context (Requirement 4 AC3)
 * and disappear on reload (AC11), the router owns the one history stack, and the
 * cache is the application's single server-state store (Requirement 1 AC3).
 * Anchoring it here also means React's double-invoked render under `StrictMode`
 * cannot produce a second session.
 */
let sharedRuntime: AppRuntime | null = null

/**
 * The shared runtime, built from `options` on the first call.
 *
 * Later calls return the existing instance and ignore their arguments — there is
 * one shell per browsing context, so there is nothing to reconfigure.
 */
export function sharedAppRuntime(options: AppRuntimeOptions): AppRuntime {
  sharedRuntime ??= createAppRuntime(options)
  return sharedRuntime
}

/**
 * Discards the shared runtime so the next call builds a new one.
 *
 * For test isolation. Production code never needs it: a reload is what ends a
 * browsing context, and that discards the module along with the session.
 */
export function resetSharedAppRuntime(): void {
  sharedRuntime = null
}
