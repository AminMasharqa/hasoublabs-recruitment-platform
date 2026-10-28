/**
 * The two Verification_Code operations and the one classification the screen
 * branches on (Requirement 6 AC9, AC10, AC11, AC12).
 *
 * | criterion | here |
 * | --- | --- |
 * | AC9 submit the retained account identifier with the collected code | {@link submitVerificationCode}, {@link verifyCodeBody} |
 * | AC11 `code_entry_locked` locks the input | {@link isCodeEntryLocked} |
 * | AC12 the resend control | {@link resendVerificationCode} |
 *
 * ## Why neither call carries a credential
 *
 * The Verification_Code screen is one of the three public routes: a registrant
 * enters the code before they have ever signed in, so there is no session to
 * authenticate with and the account identifier in the body is the whole of what
 * either endpoint is given. `accessToken: null` therefore keeps any Access_Token
 * a previous session left in memory off the wire, and `allowAuthRefresh: false`
 * keeps a refusal from driving a Refresh_Token exchange — a 401 here says the
 * code is wrong, not that a session needs renewing. This mirrors the
 * Registration_Link validation and the registration submission.
 *
 * Nothing here logs. A Verification_Code is secret material for as long as it is
 * live (Requirement 3 AC13, Requirement 23 AC7), and the `ApiFailure` a rejection
 * carries holds no request body.
 *
 * Pure apart from the two requests: no React, no DOM, no i18n. The screen decides
 * what is rendered; this module decides what is sent and how one outcome is
 * recognized.
 */

import type { ApiClient } from '../../api/client'
import type { components } from '../../api/generated/schema'
import { errorKeyOf } from '../../errors/errorMessages'
import type { RenderedInput } from '../../forms/violations'
import { validateVerificationCode, type ValidationIssue } from '../../forms/validators'

import type { RegisteredAccount } from './verificationHandoff'

/** The code-submission body, exactly as the contract declares it (AC9). */
export type VerifyCodeRequest = components['schemas']['VerifyCodeRequest']

/** The resend body, exactly as the contract declares it (AC12). */
export type ResendCodeRequest = components['schemas']['ResendCodeRequest']

/** The contract path the collected code is submitted to (AC9). */
export const VERIFY_CODE_PATH = '/api/v1/verify/code' as const

/** The contract path the resend control calls (AC12). */
export const VERIFY_RESEND_PATH = '/api/v1/verify/resend' as const

/**
 * The rendered-input path of the code field.
 *
 * Spelled `code` because that is the contract member name, so a Field_Violation
 * addressed at `code` lands on the input without a translation table — the same
 * arrangement the registration form uses.
 */
export const VERIFICATION_CODE_PATH = 'code'

/**
 * The inputs the screen renders, in rendering order (Requirement 22 AC9, AC10).
 *
 * Exactly one: `account_id` is retained rather than collected, so a violation
 * addressed at it reaches no input and is placed in the form-level region — which
 * is the right outcome, since a bad account identifier is a bad handoff, not a
 * mistyped field.
 */
export const VERIFICATION_INPUTS: readonly RenderedInput[] = Object.freeze([
  { path: VERIFICATION_CODE_PATH },
])

/** The `error` member that locks code entry (AC11). */
export const CODE_ENTRY_LOCKED_ERROR_KEY = 'code_entry_locked'

/**
 * Whether a failed submission is the locked-entry outcome of AC11.
 *
 * Read off the `error` member only, and deliberately not off the status code: the
 * requirement names the envelope member, and the Backend_Api is free to carry it
 * on whichever 4xx it chooses.
 */
export function isCodeEntryLocked(error: unknown): boolean {
  return errorKeyOf(error) === CODE_ENTRY_LOCKED_ERROR_KEY
}

/**
 * The submitted body: the retained identifier plus the collected code (AC9).
 *
 * The code is trimmed of surrounding whitespace, which a paste from an email
 * routinely carries. Nothing inside it is rewritten — the six ASCII digits
 * {@link validateVerificationCode} admits are the only accepted shape anyway.
 */
export function verifyCodeBody(accountId: string, code: string): VerifyCodeRequest {
  return { account_id: accountId, code: code.trim() }
}

/** The resend body: the retained identifier alone (AC12). */
export function resendCodeBody(accountId: string): ResendCodeRequest {
  return { account_id: accountId }
}

/**
 * Applies the Form_Validator rule to the entered code (AC9, Requirement 22 AC7).
 *
 * Exactly six ASCII digits, judged on the trimmed value so the rule and the
 * submitted body agree. An aid only: the Backend_Api remains the authoritative
 * validator (Requirement 22 AC12).
 */
export function validateVerificationValues(code: string): readonly ValidationIssue[] {
  const issue = validateVerificationCode(code.trim())
  return issue === null ? [] : [issue]
}

/**
 * Submits the retained identifier and the collected code (AC9).
 *
 * Resolves with the updated `AccountDTO` on 200, which is what tells the screen
 * to navigate to the Status_Notice (AC10). Rejects with the decoded `ApiFailure`
 * for every refusal — `code_entry_locked` (AC11), a wrong or expired code, or a
 * 422 carrying Field_Violations.
 */
export async function submitVerificationCode(
  api: ApiClient,
  accountId: string,
  code: string,
): Promise<RegisteredAccount> {
  const { data } = await api.request('post', VERIFY_CODE_PATH, {
    body: verifyCodeBody(accountId, code),
    accessToken: null,
    allowAuthRefresh: false,
  })
  return data
}

/**
 * Requests a new Verification_Code for the retained account (AC12).
 *
 * Resolves on the contract's 204, which is what re-enables the input and clears
 * the previously entered code. Rejects with the decoded `ApiFailure` otherwise,
 * so a refused resend leaves the screen exactly as it was.
 */
export async function resendVerificationCode(api: ApiClient, accountId: string): Promise<void> {
  await api.request('post', VERIFY_RESEND_PATH, {
    body: resendCodeBody(accountId),
    accessToken: null,
    allowAuthRefresh: false,
  })
}
