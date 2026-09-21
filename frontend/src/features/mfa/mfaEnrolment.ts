/**
 * Admin multi-factor enrolment and verification: the two requests, the QR image
 * source and the own-account read the enrolment indicator comes from.
 *
 * Requirement 5:
 * - AC4 `POST /api/v1/auth/mfa/enroll` returns `qr_code_png_b64` and
 *   `provisioning_uri` ({@link startMfaEnrolment}, {@link qrCodeImageSource}).
 * - AC6 `POST /api/v1/auth/mfa/verify` takes a 6-digit code and reports a verified
 *   outcome ({@link verifyMfaCode}, {@link isVerifiedOutcome}).
 * - AC7 the enrolment indicator is the `mfa_enrolled` member of the account
 *   payload ({@link findOwnAccount}).
 *
 * Pure promises and pure decoders — no React — so the whole data path of the slice
 * is drivable from a test with a stub Api_Client and no renderer. Credential
 * attachment, `Accept-Language`, the timeout budget, the retry policy, the 401
 * refresh-and-replay path, error decoding and the Support_Reference all belong to
 * the Api_Client (Requirement 3 AC1) and are not restated here.
 *
 * ## Where `mfa_enrolled` comes from (AC7)
 *
 * The Backend_Api publishes `mfa_enrolled` on `AccountDTO`, and the only read that
 * returns an `AccountDTO` for the signed-in account is `GET /admin/accounts` — the
 * paginated Admin list. There is no `GET /me` carrying the account payload, and the
 * login response carries a token pair only. So the indicator is read by finding the
 * caller's own row in that list, filtered to `role=ADMIN`, following the keyset
 * cursor until the row is found.
 *
 * That read is Admin-only, which costs nothing: AC7 asks for the indicator on the
 * *Admin* account screen, and AC4/AC6 gate enrolment on the Admin role too, so the
 * whole panel renders only for a principal whose `roles` contain `ADMIN`.
 *
 * Requirements: 5.4, 5.6, 5.7.
 */

import type { ApiClient } from '../../api/client'
import type { components } from '../../api/generated/schema'
import { byId, deriveLastIdCursor, DEFAULT_PAGE_SIZE } from '../../lib/cursor'

// ── Paths ─────────────────────────────────────────────────────────────────────

/** `POST` path that begins enrolment (AC4). */
export const MFA_ENROLL_PATH = '/api/v1/auth/mfa/enroll'

/** `POST` path that verifies a code against the enrolled secret (AC6). */
export const MFA_VERIFY_PATH = '/api/v1/auth/mfa/verify'

/** `GET` path the `mfa_enrolled` member is read from (AC7). */
export const ADMIN_ACCOUNTS_PATH = '/api/v1/admin/accounts'

// ── Payloads ──────────────────────────────────────────────────────────────────

/** What a 200 from `POST /auth/mfa/enroll` carries (AC4). */
export type MfaEnrolment = components['schemas']['MfaEnrolmentDTO']

/** The account payload whose `mfa_enrolled` member AC7 renders. */
export type Account = components['schemas']['AccountDTO']

/** The member of the verify response that reports the outcome (AC6). */
export const MFA_VERIFIED_MEMBER = 'verified'

/**
 * Whether a verify response reports a verified outcome (AC6).
 *
 * The contract declares the body as a map of booleans, so the member is read
 * defensively: only a literal `true` under `verified` is a confirmation, and
 * anything else — a `false`, a missing member, a body of another shape — is not.
 */
export function isVerifiedOutcome(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) {
    return false
  }
  return (payload as Record<string, unknown>)[MFA_VERIFIED_MEMBER] === true
}

/** Whether a base64 value can be rendered as an image source. */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

/**
 * The `src` of the enrolment QR image, or `null` when the response carried none
 * (AC4).
 *
 * The Backend_Api sends the PNG as base64 rather than as a URL, so a `data:` URI
 * is the only way to render it — and the only way that keeps the image out of a
 * second request whose response would be cached by the browser. The value is
 * checked against the base64 alphabet first: a non-base64 value would otherwise
 * become an `img src` the browser resolves as a relative URL, issuing a request
 * this slice never intended.
 */
export function qrCodeImageSource(qrCodePngB64: unknown): string | null {
  if (typeof qrCodePngB64 !== 'string') {
    return null
  }
  const value = qrCodePngB64.trim()
  if (value === '' || value.length % 4 !== 0 || !BASE64.test(value)) {
    return null
  }
  return `data:image/png;base64,${value}`
}

// ── Cache keys ────────────────────────────────────────────────────────────────

/** Root of every cache entry this slice owns. */
export const MFA_QUERY_SCOPE = 'mfa' as const

/** Cache key of the signed-in account's payload (AC7). */
export function ownAccountQueryKey(accountId: string): readonly unknown[] {
  return [MFA_QUERY_SCOPE, 'own-account', accountId]
}

// ── Requests ──────────────────────────────────────────────────────────────────

/**
 * `POST /auth/mfa/enroll` — begins enrolment and returns the artefacts (AC4).
 *
 * Every call mints a **new** secret on the Backend_Api, which is why the screen
 * issues it from an explicit control rather than on mount: a read-shaped retry or
 * a background refetch would silently invalidate an authenticator entry the Admin
 * had already scanned.
 */
export async function startMfaEnrolment(api: ApiClient): Promise<MfaEnrolment> {
  const { data } = await api.request('post', MFA_ENROLL_PATH)
  return data
}

/**
 * `POST /auth/mfa/verify` — submits a 6-digit code and reports the outcome (AC6).
 *
 * Resolves `false` for a 200 that does not report a verified outcome; an incorrect
 * code is answered with an `invalid_mfa_code` envelope, which rejects and is
 * classified by the caller.
 */
export async function verifyMfaCode(
  api: ApiClient,
  accountId: string,
  code: string,
): Promise<boolean> {
  const { data } = await api.request('post', MFA_VERIFY_PATH, {
    body: { account_id: accountId, code },
  })
  return isVerifiedOutcome(data)
}

/**
 * How many pages {@link findOwnAccount} walks before giving up.
 *
 * A bound rather than "until the list ends": the walk is driven by data the
 * Backend_Api returns, and an endpoint that kept advertising a further page would
 * otherwise loop forever. Twenty pages of twenty rows is far more Admin accounts
 * than the platform has, so reaching the bound means something is wrong, not that
 * the account is further along.
 */
export const OWN_ACCOUNT_MAX_PAGES = 20

/**
 * The signed-in account's own payload, for the `mfa_enrolled` indicator (AC7).
 *
 * Reads `GET /admin/accounts?role=ADMIN` and follows the keyset cursor — the last
 * returned identifier, as Requirement 16 AC3 fixes it — until the row whose `id`
 * equals `accountId` is found. Resolves `null` when the account is not in the
 * filtered list, so the screen can say "not known" instead of asserting an
 * enrolment state it never read.
 */
export async function findOwnAccount(
  api: ApiClient,
  accountId: string,
  signal?: AbortSignal,
): Promise<Account | null> {
  const wanted = typeof accountId === 'string' ? accountId.trim() : ''
  if (wanted === '') {
    return null
  }

  let cursor: string | null = null
  for (let page = 0; page < OWN_ACCOUNT_MAX_PAGES; page += 1) {
    const { data } = await api.request('get', ADMIN_ACCOUNTS_PATH, {
      params: {
        query: {
          role: 'ADMIN',
          limit: DEFAULT_PAGE_SIZE,
          ...(cursor === null ? {} : { after_id: cursor }),
        },
      },
      ...(signal === undefined ? {} : { signal }),
    })
    const accounts: readonly Account[] = data
    const own = accounts.find((account) => account.id === wanted)
    if (own !== undefined) {
      return own
    }
    const next = deriveLastIdCursor(accounts, { cursorOf: byId })
    if (!next.hasNextPage) {
      return null
    }
    cursor = String(next.nextCursor)
  }
  return null
}
