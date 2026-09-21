/**
 * What a `POST /api/v1/auth/login` attempt resolved to, as pure logic.
 *
 * Requirement 4:
 * - AC1 the contract path and the request body the login screen submits
 *   ({@link LOGIN_CONTRACT_PATH}, {@link loginRequestBody}).
 * - AC12 a 401 or a 403 is classified as one indistinguishable rejection
 *   ({@link classifyLoginFailure}), so no rendered difference can disclose
 *   whether the submitted email address belongs to an existing account.
 *
 * No React, no i18n, no DOM: the screen renders what this module decides.
 *
 * ## Why non-disclosure is a *classification* and not a careful message choice
 *
 * The Backend_Api answers a refused login with several different envelopes —
 * `authentication_required` (401) for wrong credentials *or* an account that does
 * not exist, `account_not_approved` (403) for an account that exists but has not
 * been approved — and each of those carries its own catalogue entry. Rendering
 * "the localized message of the Error_Envelope" literally would therefore say
 * "Your account is not approved yet" for an address that has an account and
 * something else for one that does not, which is exactly the disclosure AC12
 * forbids.
 *
 * So the envelope is discarded at the classification boundary. {@link LOGIN_REJECTED}
 * is a frozen singleton carrying **no members at all**: there is no field on it
 * through which the status code, the `error` key, the `details` or the
 * Support_Reference could reach a component, so the rejection surface cannot vary
 * with them even by accident. The one exception is the multi-factor step, which
 * Requirement 5 AC1 requires to be distinguishable — see
 * {@link MFA_REQUIRED_ERROR_KEY} below.
 *
 * Requirements: 4.1, 4.12.
 */

import type { Role } from '../../api/enums'
import { isApiError } from '../../errors/errorMessages'

// ── The endpoint (AC1) ────────────────────────────────────────────────────────

/**
 * The path Requirement 4 AC1 names.
 *
 * `as const` so the generated contract types resolve the operation: a path the
 * Backend_Api stops publishing fails the typecheck at the call site.
 */
export const LOGIN_CONTRACT_PATH = '/api/v1/auth/login' as const

/** The credentials Requirement 4 AC1 collects. */
export interface LoginCredentials {
  readonly email: string
  readonly password: string
  readonly role: Role
}

/**
 * The `LoginRequest` body for one attempt (AC1).
 *
 * Surrounding whitespace is stripped from the email address, which an address
 * cannot contain and which a browser autofill or a copy-paste routinely adds. The
 * password is passed through **byte-identically** — trimming it would silently
 * change the secret being verified — and so is the role, which is already one of
 * the contract's enumerated values.
 */
export function loginRequestBody(credentials: LoginCredentials): {
  readonly email: string
  readonly password: string
  readonly role: Role
} {
  return {
    email: credentials.email.trim(),
    password: credentials.password,
    role: credentials.role,
  }
}

// ── Classification (AC12) ─────────────────────────────────────────────────────

/**
 * The `error` member the Backend_Api answers with when the account is enrolled in
 * multi-factor authentication and no code was submitted (Requirement 5 AC1).
 *
 * It arrives on a 401, and it is deliberately *not* folded into the uniform
 * rejection: Requirement 5 AC1 requires the Web_Client to present a code-entry
 * step for it, which is only possible if the outcome is distinguishable. That is
 * the one place Requirement 4 AC12's indistinguishability yields, and it yields to
 * an explicit requirement rather than to an oversight.
 *
 * Task 14.2 turns this classification into the code-entry step; this slice only
 * reports the outcome.
 */
export const MFA_REQUIRED_ERROR_KEY = 'mfa_required'

/** The response status codes Requirement 4 AC12 makes indistinguishable. */
export const NON_DISCLOSING_LOGIN_STATUSES: readonly number[] = Object.freeze([401, 403])

/**
 * What a login attempt resolved to.
 *
 * `rejected` carries nothing at all — see the module comment. `mfa-required`
 * carries nothing either: the credentials the code step resubmits are the ones the
 * form still holds, not something read back off the envelope.
 */
export type LoginOutcome =
  /** A 401 or a 403: refused, and nothing more may be said (AC12). */
  | { readonly kind: 'rejected' }
  /** The account needs a multi-factor code (Req 5 AC1); task 14.2 continues here. */
  | { readonly kind: 'mfa-required' }
  /**
   * Anything else — a 422, a 429, a 5xx, a timeout, a transport failure — which
   * says nothing about the account and is rendered through the ordinary
   * Error_Presenter (Req 21 AC1, AC2).
   */
  | { readonly kind: 'failed'; readonly failure: unknown }

/** The single rejection value; frozen and memberless so nothing can ride along. */
export const LOGIN_REJECTED: LoginOutcome = Object.freeze({ kind: 'rejected' as const })

/** The single multi-factor-required value. */
export const LOGIN_MFA_REQUIRED: LoginOutcome = Object.freeze({
  kind: 'mfa-required' as const,
})

/**
 * Classifies a failed login attempt (AC12, Req 5 AC1).
 *
 * Every 401 and every 403 collapses to the same {@link LOGIN_REJECTED} value
 * regardless of its `error` key, its `details` or its status, so the two are
 * indistinguishable downstream. The multi-factor case is checked first, because
 * its envelope is itself a 401.
 */
export function classifyLoginFailure(failure: unknown): LoginOutcome {
  if (isApiError(failure) && failure.error === MFA_REQUIRED_ERROR_KEY) {
    return LOGIN_MFA_REQUIRED
  }
  if (isApiError(failure) && NON_DISCLOSING_LOGIN_STATUSES.includes(failure.httpStatus)) {
    return LOGIN_REJECTED
  }
  return { kind: 'failed', failure }
}

/** Whether an outcome is the non-disclosing rejection of AC12. */
export function isLoginRejection(outcome: LoginOutcome | null): boolean {
  return outcome !== null && outcome.kind === 'rejected'
}
