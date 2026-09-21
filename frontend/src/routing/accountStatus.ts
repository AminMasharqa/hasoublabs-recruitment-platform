/**
 * Acquiring and replacing the retained Account_Status the Route_Guard gates on
 * (Requirement 7 AC1, AC6).
 *
 * Two inputs, one retained value:
 *
 * - **AC1** when an authenticated session is established, `GET /me/status` is
 *   issued and its `status`/`next_step` are retained
 *   ({@link useAccountStatusSync}).
 * - **AC6** an `account_not_approved` Error_Envelope *anywhere* in the
 *   application replaces the retained values from its `details` and sends the
 *   user to the Status_Notice ({@link reportAccountNotApproved},
 *   {@link useAccountNotApprovedSync}).
 *
 * The redirect half of AC6 is deliberately *not* implemented as a navigation
 * call. Replacing the retained status with a non-`Approved` value is by itself
 * enough: `decideRouteAccess` then answers `redirect-to-status-notice` for every
 * route that is not an Onboarding_Screen, and the Route_Guard renders that
 * redirect on its next render. So the redirect follows from the retained value
 * rather than from a second code path that could disagree with the guard — and a
 * failure observed on a screen the status still permits does not yank the user
 * off it.
 *
 * No React component and no JSX here: `RouteGuard.tsx` mounts these two hooks.
 *
 * ## Why a module-level store for AC6
 *
 * "Any request" includes requests issued by screens that are not mounted under a
 * guard, and by the Api_Client's `onFailure` observer, which the shell wires at
 * construction time — before React mounts. A module-scoped store, read through
 * `useSyncExternalStore`, bridges that: the shell forwards every failure to
 * {@link reportAccountNotApproved} and whichever guard is mounted applies it.
 * This is the same pattern `errors/supportReferenceStore.ts` uses, and for the
 * same reason.
 *
 * ## Why not TanStack Query for AC1
 *
 * The status read is a precondition of *rendering the router at all*: the guard
 * needs it before it can decide, and it is issued exactly once per session
 * rather than per screen. Implementing it here with an effect keeps the
 * Route_Guard's dependencies down to the session, the Api_Client and the error
 * primitives, so mounting a guarded route does not require a
 * `QueryClientProvider`. Concurrent guards are deduplicated by the in-flight map
 * below, which is all the caching this single read needs — the retained status
 * itself lives in the session, and is discarded on login, logout and context
 * switch by `SessionProvider`.
 *
 * Requirements: 7.1, 7.6.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import type { ApiClient } from '../api/client'
import { retainedStatusFrom, useSession, type RetainedStatus } from '../session/sessionState'

// ── The status read (Req 7 AC1) ───────────────────────────────────────────────

/**
 * The endpoint Requirement 7 AC1 names.
 *
 * `as const` so the generated contract types resolve the operation: a path the
 * Backend_Api stops publishing fails the typecheck here.
 */
export const ME_STATUS_PATH = '/api/v1/me/status' as const

/**
 * The failure surfaced when `GET /me/status` answers 200 with a body the client
 * cannot read a declared Account_Status out of.
 *
 * Shaped like a decoded Error_Envelope so the Error_Presenter localizes it
 * through the ordinary `errors:unexpected_response` entry. Guessing a status
 * instead would either leak a screen the real status forbids or bounce an
 * approved user to the Status_Notice.
 */
export const UNREADABLE_STATUS_FAILURE = Object.freeze({
  error: 'unexpected_response',
  message: null,
  details: null,
  request_id: null,
  httpStatus: 200,
  supportReference: null,
  refreshEligible: false,
  fieldViolations: [],
})

/** Issues `GET /me/status` and reads the retained pair out of the response (AC1). */
export async function fetchAccountStatus(api: ApiClient): Promise<RetainedStatus | null> {
  const { data } = await api.request('get', ME_STATUS_PATH)
  return retainedStatusFrom(data)
}

/**
 * In-flight status reads, keyed by the `sub` claim they were issued for.
 *
 * Two guards mounted across one navigation — the old group unmounting while the
 * new one mounts — would otherwise each issue the call. Keyed by `sub` so a read
 * belonging to a previous session can never satisfy the next one.
 */
const inFlightStatusReads = new Map<string, Promise<RetainedStatus | null>>()

/** {@link fetchAccountStatus}, deduplicated per account (AC1). */
export function requestAccountStatus(
  api: ApiClient,
  sub: string,
): Promise<RetainedStatus | null> {
  const existing = inFlightStatusReads.get(sub)
  if (existing !== undefined) {
    return existing
  }
  const pending = fetchAccountStatus(api).finally(() => {
    inFlightStatusReads.delete(sub)
  })
  inFlightStatusReads.set(sub, pending)
  return pending
}

/** What {@link useAccountStatusSync} tells the Route_Guard about the read. */
export interface AccountStatusSync {
  /** Whether a status read is outstanding. */
  readonly pending: boolean
  /** The failure of the last attempt, or `null`. */
  readonly error: unknown
  /** Re-issues the read — the retry control of a failed status read (Req 21 AC8). */
  readonly retry: () => void
}

const IDLE_SYNC: AccountStatusSync = Object.freeze({
  pending: false,
  error: null,
  retry: () => undefined,
})

/**
 * Issues `GET /me/status` once per established session and retains the result
 * (AC1).
 *
 * Runs only while the session holds an Access_Token and no status is retained
 * yet, which is exactly the window in which `decideRouteAccess` answers
 * `await-status`. A retained status ends the read; a new session discards the
 * retained status (`SessionProvider`) and so starts a new one — which is also
 * what re-reads the status after a context switch.
 *
 * A failure is surfaced rather than retried in a loop: the Api_Client has already
 * applied its own read-retry budget (Req 21 AC9), so the guard renders the error
 * state with the retry control instead. An `account_not_approved` answer is
 * reported to the AC6 store rather than treated as an error, because it carries
 * the very status this read was asking for.
 *
 * @param api the Api_Client; `null` issues nothing, for a guard rendered without one
 */
export function useAccountStatusSync(api: ApiClient | null | undefined): AccountStatusSync {
  const { authenticated, principal, status, retainStatus } = useSession()
  const sub = principal === null ? null : principal.sub

  const [error, setError] = useState<unknown>(null)
  const [attempt, setAttempt] = useState(0)
  /**
   * The `sub`-and-attempt of the read this hook instance currently has
   * outstanding, so a re-render — including the one caused by the failure it just
   * recorded — does not issue a second.
   *
   * Released once the read settles, and that matters: the retained status can be
   * discarded again while this instance stays mounted (a context switch does
   * exactly that, Req 8 AC11, and React reuses the `RouteGuard` element across two
   * guarded groups at the same tree position). A latch that remembered the read
   * forever would leave the next `await-status` window with nothing to resolve it,
   * i.e. a screen loading indefinitely. Concurrent reads are still deduplicated
   * across instances by `inFlightStatusReads`.
   */
  const issued = useRef<string | null>(null)

  const needed = api != null && authenticated && sub !== null && status === null
  const attemptKey = sub === null ? null : `${sub}#${attempt}`

  useEffect(() => {
    if (!needed || api == null || sub === null || attemptKey === null) {
      return
    }
    if (issued.current === attemptKey) {
      return
    }
    issued.current = attemptKey

    let cancelled = false
    void requestAccountStatus(api, sub)
      .then(
        (retained) => {
          if (cancelled) {
            return
          }
          if (retained === null) {
            setError(UNREADABLE_STATUS_FAILURE)
            return
          }
          retainStatus(retained)
        },
        (failure: unknown) => {
          if (cancelled) {
            return
          }
          // AC6: the refusal itself carries the status, so it is a status answer
          // rather than a failed read.
          if (reportAccountNotApproved(failure) !== null) {
            return
          }
          setError(failure)
        },
      )
      .finally(() => {
        // Only release the latch this effect run took: a newer run has already
        // claimed it for its own key.
        if (issued.current === attemptKey) {
          issued.current = null
        }
      })

    return () => {
      cancelled = true
    }
  }, [needed, api, sub, attemptKey, retainStatus])

  const retry = useCallback(() => {
    setError(null)
    setAttempt((previous) => previous + 1)
  }, [])

  if (!needed) {
    return IDLE_SYNC
  }
  return { pending: error === null, error, retry }
}

// ── The account_not_approved replacement (Req 7 AC6) ──────────────────────────

/** The `error` member Requirement 7 AC6 keys on. */
export const ACCOUNT_NOT_APPROVED_ERROR = 'account_not_approved'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * The replacement status an `account_not_approved` Error_Envelope carries, or
 * `null` for anything else (AC6).
 *
 * Reads `details.status` / `details.next_step`, and tolerates an envelope whose
 * `details` is the pair itself. Returns `null` — rather than a guess — when the
 * envelope names no declared Account_Status, so an unreadable refusal leaves the
 * previously retained status in place.
 */
export function accountNotApprovedStatus(failure: unknown): RetainedStatus | null {
  if (!isRecord(failure) || failure.error !== ACCOUNT_NOT_APPROVED_ERROR) {
    return null
  }
  return retainedStatusFrom(failure.details) ?? retainedStatusFrom(failure)
}

/** A reported replacement, with the sequence number that makes it applicable once. */
interface AccountNotApprovedEntry {
  readonly retained: RetainedStatus
  readonly seq: number
}

let latestEntry: AccountNotApprovedEntry | null = null
let sequence = 0
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

function readLatestEntry(): AccountNotApprovedEntry | null {
  return latestEntry
}

/**
 * Reports a failure so that an `account_not_approved` envelope replaces the
 * retained Account_Status (AC6).
 *
 * The shell forwards every Api_Client failure here (`ApiClientConfig.onFailure`),
 * and any feature that catches a failure itself may too — reporting the same
 * envelope twice is harmless. A failure that is not `account_not_approved` is
 * ignored.
 *
 * @returns the replacement status when one was reported, else `null`
 */
export function reportAccountNotApproved(failure: unknown): RetainedStatus | null {
  const retained = accountNotApprovedStatus(failure)
  if (retained === null) {
    return null
  }
  sequence += 1
  latestEntry = { retained, seq: sequence }
  emit()
  return retained
}

/**
 * Discards a reported replacement.
 *
 * For test isolation only: the store is browsing-context scoped, and a replacement
 * that has been applied to the session is harmless to leave behind because it is
 * only ever applied once.
 */
export function clearAccountNotApproved(): void {
  if (latestEntry === null) {
    return
  }
  latestEntry = null
  emit()
}

/** The most recently reported replacement status, or `null` (AC6). */
export function latestAccountNotApproved(): RetainedStatus | null {
  return latestEntry === null ? null : latestEntry.retained
}

/**
 * Applies a reported `account_not_approved` replacement to the session (AC6).
 *
 * Applies each report at most once, and only while a session is held — a refusal
 * observed as a session ends must not resurrect a status for the next one. The
 * redirect to the Status_Notice is left to the Route_Guard, which answers
 * `redirect-to-status-notice` for every non-Onboarding_Screen as soon as the
 * replacement lands; see the module note.
 */
export function useAccountNotApprovedSync(): void {
  const { authenticated, status, nextStep, retainStatus } = useSession()
  const entry = useSyncExternalStore(subscribe, readLatestEntry, readLatestEntry)
  const appliedSeq = useRef(0)

  useEffect(() => {
    if (entry === null || entry.seq <= appliedSeq.current) {
      return
    }
    appliedSeq.current = entry.seq
    if (!authenticated) {
      return
    }
    if (entry.retained.status === status && entry.retained.nextStep === nextStep) {
      return
    }
    retainStatus(entry.retained)
  }, [entry, authenticated, status, nextStep, retainStatus])
}
