/**
 * The non-component half of the session context: the context object, the value
 * shape it carries, the hooks that read it and the retained Account_Status
 * helpers (Requirement 4 AC3, Requirement 7 AC1, AC6).
 *
 * Separate from `SessionContext.tsx` because that file holds the provider
 * component only — the same split as `DirectionProvider.tsx` /
 * `localeDirection.ts`. Nothing here holds state: the session lives in the
 * Session_Manager closure and the provider republishes it.
 *
 * ## No token material crosses this boundary
 *
 * {@link SessionContextValue} carries the principal, the `roles`/`act` claims,
 * `authenticated`, the retained Account_Status and the operations that end or
 * re-establish a session. It carries neither token, and not the Session_Manager
 * itself either, because `getAccessToken` is a token accessor and exposing the
 * manager through context would hand every component the Access_Token. The
 * Api_Client — the one collaborator that needs it, and not a component — receives
 * the manager directly in the shell.
 *
 * Nothing in this module reads or writes `localStorage`, `sessionStorage`, a
 * cookie or IndexedDB (AC3), so a page reload starts with no session (AC11).
 *
 * Requirements: 4.3.
 */

import { createContext, useContext, useMemo } from 'react'

import type { AccountStatus, Role } from '../api/enums'
import type { Locale } from '../lib/locale'
import { ACCOUNT_STATUS_VALUES, type AccessSubject, type ActiveContext } from '../routing/access'

import type { Principal, SessionEndReason, TokenPair } from './SessionManager'

// ── Retained Account_Status ───────────────────────────────────────────────────

/**
 * The Account_Status the Web_Client is currently going on, with the onboarding
 * hint that accompanies it (Req 7 AC1).
 *
 * `nextStep` is the `next_step` member the Status_Notice renders, or `null` when
 * the Backend_Api sends none.
 */
export interface RetainedStatus {
  readonly status: AccountStatus
  readonly nextStep: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Reads a {@link RetainedStatus} out of a `{status, next_step}` payload — the
 * `GET /me/status` body (Req 7 AC1) and the `details` member of an
 * `account_not_approved` envelope (Req 7 AC6) share that shape.
 *
 * Returns `null` — never throws — when `status` is absent or is not a value the
 * contract declares, so an unrecognized status leaves the previously retained one
 * in place instead of gating navigation on a value nothing can decide against.
 */
export function retainedStatusFrom(payload: unknown): RetainedStatus | null {
  if (!isRecord(payload)) {
    return null
  }
  const status = payload['status']
  if (!ACCOUNT_STATUS_VALUES.includes(status)) {
    return null
  }
  const nextStep = payload['next_step']
  return { status, nextStep: typeof nextStep === 'string' && nextStep.length > 0 ? nextStep : null }
}

// ── Context value ─────────────────────────────────────────────────────────────

/** Options accepted when a session is established. */
export interface EstablishSessionOptions {
  /**
   * The account's `language_preference`, applied as the active Locale
   * (Requirement 19 AC3). An unsupported or absent value falls back to the
   * browser-preference resolution of AC4.
   */
  readonly languagePreference?: unknown
}

/** Applies the Locale of a newly established session (Req 19 AC3). */
export type LocaleApplier = (languagePreference: unknown) => Promise<Locale>

/**
 * Everything the component tree may know and do about the session.
 *
 * Carries no token material and no reference to the Session_Manager; see the
 * module comment.
 */
export interface SessionContextValue {
  /** Whether an Access_Token is held. */
  readonly authenticated: boolean
  /** The decoded Access_Token claims, or `null` when no session is held. */
  readonly principal: Principal | null
  /** The `roles` claim; empty when no session is held. */
  readonly roles: readonly Role[]
  /** The `act` claim — the Active_Context — or `null` when no session is held. */
  readonly act: ActiveContext | null
  /** The retained Account_Status, or `null` while it is not yet known. */
  readonly status: AccountStatus | null
  /** The retained `next_step` hint, or `null`. */
  readonly nextStep: string | null
  /**
   * The claims and the retained status as one {@link AccessSubject}, ready for
   * `decideRouteAccess` and `deriveNavigationMenu`; `null` when no session is
   * held, which those functions read as "redirect to login".
   *
   * Stable by identity until the session or the retained status changes, so a
   * memoized menu derivation is not recomputed on every render.
   */
  readonly subject: AccessSubject | null
  /**
   * Adopts a token pair: the login response (Req 4 AC2) and the
   * `POST /auth/context` response of a context switch (Req 8 AC10) both arrive
   * here.
   *
   * Discards the retained Account_Status, applies the account's Locale when one
   * is supplied (Req 19 AC3) and returns the decoded principal so the caller can
   * navigate to the landing destination of the new Active_Context — this module
   * knows nothing about routes. Returns `null` when the Access_Token could not be
   * decoded.
   *
   * Clearing the TanStack Query cache on a context switch (Req 8 AC11) is the
   * caller's: adopting a pair is not by itself a reason to discard cached data,
   * and a proactive refresh must not (Req 4 AC5).
   */
  readonly establishSession: (
    pair: TokenPair,
    options?: EstablishSessionOptions,
  ) => Principal | null
  /**
   * Replaces the retained Account_Status (Req 7 AC1, AC6). `null` returns it to
   * "not yet known".
   */
  readonly retainStatus: (retained: RetainedStatus | null) => void
  /**
   * Ends the session through `POST /auth/logout`, then discards the tokens,
   * clears the cache and redirects to login regardless of the response status
   * (Req 4 AC9, AC10).
   */
  readonly logout: () => Promise<void>
  /**
   * Ends the session now, without calling the Backend_Api: discards the tokens,
   * clears the cache and redirects to login (Req 4 AC7).
   */
  readonly clear: (reason: SessionEndReason) => void
}

/**
 * The session context.
 *
 * `null` outside a `SessionProvider`, which {@link useSession} reports as a
 * wiring error rather than silently rendering as though nobody were signed in.
 */
export const SessionContext = createContext<SessionContextValue | null>(null)

// ── Hooks ─────────────────────────────────────────────────────────────────────

/**
 * The session context.
 *
 * Throws outside a `SessionProvider`: a component that asks about the session and
 * is told "no session" when the provider is merely missing would render a login
 * redirect for an authenticated user.
 */
export function useSession(): SessionContextValue {
  const value = useContext(SessionContext)
  if (value === null) {
    throw new Error('useSession must be used within a SessionProvider')
  }
  return value
}

/**
 * The {@link AccessSubject} for the current session, or `null` when no
 * Access_Token is held — the input `decideRouteAccess` and `deriveNavigationMenu`
 * take (Req 7 AC2, Req 8 AC3, AC5).
 */
export function useAccessSubject(): AccessSubject | null {
  return useSession().subject
}

/** Whether an Access_Token is held. */
export function useIsAuthenticated(): boolean {
  return useSession().authenticated
}

/** The decoded Access_Token claims, or `null` when no session is held. */
export function usePrincipal(): Principal | null {
  return useSession().principal
}

/** The retained Account_Status and its `next_step` hint (Req 7 AC1). */
export function useRetainedStatus(): RetainedStatus | null {
  const { status, nextStep } = useSession()
  return useMemo(() => (status === null ? null : { status, nextStep }), [status, nextStep])
}
