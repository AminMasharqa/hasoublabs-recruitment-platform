/**
 * The browsing-context store for the most recent failed request's
 * Support_Reference.
 *
 * Requirement 23:
 * - AC3 the Support_Reference of the most recent failed request is retained for
 *   the lifetime of the browsing context ({@link recordFailedSupportReference},
 *   {@link latestFailedSupportReference}).
 * - AC4 a Support_Reference is never rendered on a successful outcome: only a
 *   failure is ever recorded here, so there is no successful value to retain.
 *
 * Requirement 21 AC11: the recovery boundary reads {@link latestFailedSupportReference}
 * because an unhandled rendering error carries no reference of its own.
 *
 * ## Why a module-level store rather than a React context
 *
 * "The lifetime of the browsing context" is exactly the lifetime of this module
 * instance: a module-scoped value survives every unmount, remount, route change,
 * locale switch and query-cache reset, and disappears on reload — the same
 * boundary Requirement 4 AC3 gives the in-memory session. A context value would
 * be lost whenever a provider above it remounted, and the recovery boundary that
 * needs the value is itself what catches the failure that remounted the tree.
 * Reads still flow through React via {@link useLatestFailedSupportReference}, so
 * a mounted surface re-renders when a newer failure is recorded.
 *
 * Nothing is persisted: the store is a variable, never `sessionStorage`.
 */

import { useSyncExternalStore } from 'react'

let latestReference: string | null = null
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

/** A reference worth retaining: a non-blank string. */
export function usableSupportReference(reference: unknown): string | null {
  return typeof reference === 'string' && reference.trim().length > 0 ? reference : null
}

/**
 * Records the Support_Reference of a failed request (AC3).
 *
 * Only failures reach this function — the Api_Client reads `X-Request-ID` on
 * every response, but a success is never recorded — so the retained value is
 * always one a user could be asked to quote (AC4). A blank or absent reference
 * leaves the retained value untouched, so a failure that carried no
 * `X-Request-ID` does not erase a usable earlier one.
 *
 * @returns The reference now retained, which may be an earlier one.
 */
export function recordFailedSupportReference(reference: unknown): string | null {
  const usable = usableSupportReference(reference)
  if (usable === null || usable === latestReference) {
    return latestReference
  }
  latestReference = usable
  emit()
  return latestReference
}

/** The most recent failed request's Support_Reference, or `null` (AC3). */
export function latestFailedSupportReference(): string | null {
  return latestReference
}

/**
 * Discards the retained Support_Reference.
 *
 * Exists for test isolation. It is deliberately not called on logout, session
 * expiry or context switch: AC3 retains the reference for the browsing context,
 * not for the session, so a user can still quote it after being signed out by
 * the very failure they are reporting.
 */
export function clearFailedSupportReference(): void {
  if (latestReference === null) {
    return
  }
  latestReference = null
  emit()
}

/** Subscribes to the retained Support_Reference, re-rendering on a newer failure. */
export function useLatestFailedSupportReference(): string | null {
  return useSyncExternalStore(subscribe, latestFailedSupportReference, latestFailedSupportReference)
}
