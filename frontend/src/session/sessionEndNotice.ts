/**
 * The browsing-context store for the reason the last session ended
 * (Requirement 4 AC7, AC9).
 *
 * AC7 asks the login screen for a *session-expired notice* after a Refresh_Token
 * exchange was refused; AC9 asks for a plain redirect after a logout. Both land on
 * the same screen, so the screen needs the reason — and router state alone cannot
 * carry it reliably.
 *
 * ## Why router state alone is not enough
 *
 * A session almost always ends while a guarded screen is displayed, and that
 * produces *two* navigations to the login screen from one event:
 *
 * 1. `SessionManager.clear` publishes the empty session and then calls
 *    `redirectToLogin`, whose navigation carries `sessionEndRedirectState(reason)`.
 * 2. The publish re-renders the Route_Guard above the displayed screen, which now
 *    sees no Access_Token and renders its own redirect to the login screen —
 *    carrying the requested location (Req 8 AC2) and no reason.
 *
 * The second one lands last, so the reason is overwritten before the login screen
 * ever reads it and the notice AC7 requires never appears. Neither redirect is
 * wrong: one is the session-end notice, the other is the retained location the
 * user should return to after signing in again.
 *
 * So the reason is kept *outside* the location, where a competing navigation
 * cannot replace it, exactly as `errors/supportReferenceStore.ts` keeps the most
 * recent Support_Reference outside the surface that renders it. The login screen
 * reads both: the router state (still authoritative when the session ended on an
 * unguarded screen) and this store.
 *
 * Scope is the browsing context — the same boundary the in-memory tokens have
 * (AC3, AC11). Nothing is persisted: this is a variable, never `sessionStorage`.
 */

import { useSyncExternalStore } from 'react'

import type { SessionEndReason } from './SessionManager'

let lastReason: SessionEndReason | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Records why the session ended (AC7, AC9).
 *
 * Wired to the one redirect the Session_Manager triggers, so a logout replaces an
 * earlier expiry — the user is then signed out deliberately, and AC9 asks for no
 * notice.
 */
export function recordSessionEnd(reason: SessionEndReason): void {
  if (lastReason === reason) {
    return
  }
  lastReason = reason
  emit()
}

/** Why the last session ended, or `null` when none has ended here. */
export function latestSessionEnd(): SessionEndReason | null {
  return lastReason
}

/**
 * Discards the recorded reason.
 *
 * Called when a session is established — a fresh session has not expired, so the
 * notice must not survive into it — and for test isolation.
 */
export function clearSessionEnd(): void {
  if (lastReason === null) {
    return
  }
  lastReason = null
  emit()
}

/** Subscribes to the recorded reason, re-rendering when a session ends. */
export function useLatestSessionEnd(): SessionEndReason | null {
  return useSyncExternalStore(subscribe, latestSessionEnd, latestSessionEnd)
}

/** Whether the last session ended by expiry, and so the notice of AC7 is owed. */
export function useSessionExpired(): boolean {
  return useLatestSessionEnd() === 'session-expired'
}
