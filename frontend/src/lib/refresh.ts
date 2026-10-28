/**
 * Access_Token claim decoding and refresh-time computation (Requirement 4 AC2, AC4).
 *
 * Pure logic: no timers, no HTTP, no module state. `src/session/SessionManager.ts`
 * owns the clock and the exchange; this module only answers two questions about
 * a token it is handed:
 *
 * 1. *Who is this?* — the `sub`, `roles`, `act` and `session_id` claims the
 *    Route_Guard and Navigation_Menu key on (AC2).
 * 2. *When must the Refresh_Token be exchanged?* — an instant no later than
 *    `exp − 60s` and no earlier than the current instant (AC4).
 *
 * ## The client never verifies the signature
 *
 * Decoding here is a base64url decode of the claims segment and nothing else:
 * the signature is not checked, the `alg` header is ignored, and no key material
 * is involved. The Web_Client holds no signing key and could not verify a
 * signature even if it wanted to. The Backend_Api is the sole authority on token
 * validity — it verifies the signature and the Valkey session record on every
 * request (`app/platform/security/tokens.py`), and a token this module happily
 * decodes may still be rejected with a 401.
 *
 * So the decoded claims are used only for *presentation and scheduling*
 * decisions the Backend_Api re-checks anyway: which landing destination to
 * navigate to, which menu entries to render, when to schedule the next refresh.
 * A forged or tampered token can, at worst, make the Web_Client render a screen
 * whose requests then all fail with 403 — it cannot grant access to any data.
 * Nothing in this module may ever become the last line of defence.
 *
 * ## Claim shape
 *
 * The Backend_Api mints the access payload as (`_build_access_payload`):
 *
 * ```json
 * {
 *   "sub": "<account-uuid>", "iat": 1730000000, "exp": 1730001800,
 *   "act": "CANDIDATE", "roles": ["CANDIDATE", "SENIOR"],
 *   "session_id": "<uuid>", "type": "access"
 * }
 * ```
 *
 * Requirements: 4.2, 4.4.
 */

import type { Role } from '../api/enums'
import { ROLE_VALUES } from '../forms/validators'

// ── Refresh lead time (AC4) ───────────────────────────────────────────────────

/** Requirement 4 AC4: the exchange happens no later than 60 seconds before `exp`. */
export const REFRESH_LEAD_SECONDS = 60

/** {@link REFRESH_LEAD_SECONDS} in milliseconds, the unit timers are scheduled in. */
export const REFRESH_LEAD_MS = REFRESH_LEAD_SECONDS * 1000

// ── Decoded claims ────────────────────────────────────────────────────────────

/**
 * The authenticated principal, as carried by the Access_Token (AC2).
 *
 * `roles` is the full role set of the account; `act` is the single role the
 * account is currently acting as (the Active_Context).
 */
export interface Principal {
  /** `sub` — the account identifier. Opaque here; not parsed as a UUID. */
  readonly sub: string
  /** `roles` — every role the account holds, deduplicated, contract order preserved. */
  readonly roles: readonly Role[]
  /** `act` — the Active_Context the token was issued for. */
  readonly act: Role
  /** `session_id` — the Backend_Api session this token belongs to. */
  readonly sessionId: string
  /** `exp` — expiry as a NumericDate (epoch **seconds**, as JWT specifies). */
  readonly exp: number
}

/** The computed refresh schedule of one Access_Token. All instants are epoch **milliseconds**. */
export interface RefreshTiming {
  /**
   * The latest instant at which the exchange may start: `exp − 60s` (AC4).
   *
   * May be in the past for a token already inside its lead window.
   */
  readonly deadlineEpochMs: number
  /**
   * The instant the exchange should start — the scheduled refresh time.
   *
   * Clamped into `[now, deadline]`: never earlier than the current instant, and
   * no later than the deadline whenever the deadline has not already passed.
   */
  readonly atEpochMs: number
  /** `atEpochMs − now`, never negative — ready to hand to a timer. */
  readonly delayMs: number
  /** The deadline has passed, so the exchange is due immediately (`delayMs === 0`). */
  readonly due: boolean
  /** The token is already expired. Still due immediately; the exchange may fail. */
  readonly expired: boolean
}

// ── base64url decoding ────────────────────────────────────────────────────────

/** A JWT is three base64url segments separated by dots; the claims are the second. */
const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/

/**
 * Decodes one base64url segment to a UTF-8 string, or `null` when it is not
 * well-formed base64url or not valid UTF-8.
 */
function decodeBase64UrlSegment(segment: string): string | null {
  if (segment.length === 0 || !BASE64URL_SEGMENT.test(segment)) {
    return null
  }
  const base64 = segment.replaceAll('-', '+').replaceAll('_', '/')
  // A base64 body of length 4n+1 encodes no whole byte, so it cannot be padded
  // into a valid encoding.
  if (base64.length % 4 === 1) {
    return null
  }
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  try {
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    // `fatal` rejects invalid UTF-8 rather than substituting U+FFFD, so a
    // corrupted segment is reported as malformed instead of silently mangled.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/**
 * Base64url-decodes the claims segment of a JWT into a plain object.
 *
 * **The signature is not verified** — see the module comment. Returns `null` for
 * anything that is not a three-segment JWT whose claims segment decodes to a
 * JSON object: a malformed token never throws.
 */
export function decodeJwtClaims(token: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof token !== 'string') {
    return null
  }
  const segments = token.split('.')
  if (segments.length !== 3) {
    return null
  }
  const claimsSegment = segments[1]
  if (claimsSegment === undefined) {
    return null
  }
  const json = decodeBase64UrlSegment(claimsSegment)
  if (json === null) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null
  }
  return parsed as Readonly<Record<string, unknown>>
}

// ── Principal decoding (AC2) ──────────────────────────────────────────────────

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** A NumericDate claim: a finite, positive number of seconds. */
function numericDate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Projects the `roles` claim onto the contract's Role union.
 *
 * Duplicates are dropped and unrecognized members are ignored, so a role the
 * Backend_Api adds before this bundle knows about it degrades to "not held"
 * rather than invalidating the whole session. Access is decided by
 * `roles ∩ requiredRoles`, so an ignored member can only ever withhold a
 * destination — never grant one.
 */
function decodeRoles(value: unknown): readonly Role[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  const roles: Role[] = []
  for (const member of value) {
    if (ROLE_VALUES.includes(member) && !roles.includes(member)) {
      roles.push(member)
    }
  }
  return roles.length > 0 ? roles : null
}

/**
 * Decodes the Access_Token claims the session keys on (AC2).
 *
 * Returns `null` — never throws — when the token is malformed or when any of
 * `sub`, `roles`, `act`, `session_id` or `exp` is missing or unusable, because a
 * principal the Web_Client cannot fully identify cannot be used to pick a
 * landing destination or scope a Navigation_Menu. The Active_Context `act` must
 * name a known role for the same reason; unknown `roles` members are ignored
 * instead (see {@link decodeRoles}).
 *
 * Expiry is *not* considered here: an expired token still decodes, and it is the
 * Session_Manager that decides what to do about the expiry.
 */
export function decodePrincipal(token: unknown): Principal | null {
  const claims = decodeJwtClaims(token)
  if (claims === null) {
    return null
  }
  const sub = nonEmptyString(claims['sub'])
  const sessionId = nonEmptyString(claims['session_id'])
  const exp = numericDate(claims['exp'])
  const roles = decodeRoles(claims['roles'])
  const act = claims['act']
  if (sub === null || sessionId === null || exp === null || roles === null) {
    return null
  }
  if (!ROLE_VALUES.includes(act)) {
    return null
  }
  return { sub, roles, act, sessionId, exp }
}

// ── Refresh-time computation (AC4) ────────────────────────────────────────────

/** The latest permissible refresh instant for an `exp` claim: `exp − 60s`, in epoch ms. */
export function refreshDeadlineEpochMs(expEpochSeconds: number): number {
  return expEpochSeconds * 1000 - REFRESH_LEAD_MS
}

/**
 * True when the current instant has already reached `exp − 60s`, so no strictly
 * future refresh time can satisfy AC4 and the exchange is due immediately.
 */
export function isRefreshDue(expEpochSeconds: number, nowEpochMs: number): boolean {
  return nowEpochMs >= refreshDeadlineEpochMs(expEpochSeconds)
}

/**
 * Computes the refresh schedule for an `exp` claim against a caller-supplied
 * clock reading (AC4).
 *
 * The scheduled instant is `exp − 60s`, clamped so it is never earlier than
 * `now`. Refreshing exactly at the deadline consumes the full lifetime of the
 * token while still leaving the 60-second margin the requirement demands, which
 * keeps the number of exchanges — and the number of rotated Refresh_Tokens — to
 * the minimum.
 *
 * Degenerate case: a token handed over with fewer than 60 seconds of life left
 * (or already expired) has a deadline in the past, so the two bounds "no later
 * than `exp − 60s`" and "no earlier than now" cannot both hold. The clamp
 * resolves it toward `now`, reported as `due: true` — an immediate exchange is
 * the only action that can keep the session alive. Callers that need to
 * distinguish this case can test it with {@link isRefreshDue} before scheduling.
 *
 * Returns `null` when either input is not a usable number, so a nonsense `exp`
 * cannot produce a nonsense timer.
 */
export function computeRefreshTiming(
  expEpochSeconds: unknown,
  nowEpochMs: unknown,
): RefreshTiming | null {
  const exp = numericDate(expEpochSeconds)
  if (exp === null || typeof nowEpochMs !== 'number' || !Number.isFinite(nowEpochMs)) {
    return null
  }
  const expiryEpochMs = exp * 1000
  const deadlineEpochMs = expiryEpochMs - REFRESH_LEAD_MS
  const due = nowEpochMs >= deadlineEpochMs
  const atEpochMs = due ? nowEpochMs : deadlineEpochMs
  return {
    deadlineEpochMs,
    atEpochMs,
    delayMs: atEpochMs - nowEpochMs,
    due,
    expired: nowEpochMs >= expiryEpochMs,
  }
}

/**
 * The scheduled refresh instant for an `exp` claim, in epoch milliseconds, or
 * `null` when the inputs are unusable. Convenience projection of
 * {@link computeRefreshTiming}.
 */
export function computeRefreshAtEpochMs(
  expEpochSeconds: unknown,
  nowEpochMs: unknown,
): number | null {
  return computeRefreshTiming(expEpochSeconds, nowEpochMs)?.atEpochMs ?? null
}

/**
 * The delay a proactive refresh timer should be armed with, in milliseconds, or
 * `null` when the inputs are unusable. Never negative.
 */
export function computeRefreshDelayMs(
  expEpochSeconds: unknown,
  nowEpochMs: unknown,
): number | null {
  return computeRefreshTiming(expEpochSeconds, nowEpochMs)?.delayMs ?? null
}

/**
 * Decodes an Access_Token and computes its refresh schedule in one step — what
 * the Session_Manager needs on login and after every successful exchange.
 *
 * Returns `null` for a malformed token or an undecodable principal, so a token
 * the Web_Client cannot read never results in a scheduled timer.
 */
export function refreshTimingForToken(token: unknown, nowEpochMs: number): RefreshTiming | null {
  const principal = decodePrincipal(token)
  return principal === null ? null : computeRefreshTiming(principal.exp, nowEpochMs)
}
