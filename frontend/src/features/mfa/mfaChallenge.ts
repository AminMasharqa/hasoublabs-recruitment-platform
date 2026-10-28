/**
 * The multi-factor code step of `POST /api/v1/auth/login`, as pure logic.
 *
 * Requirement 5:
 * - AC1 the resubmitted login body: the email address, the password, the role and
 *   the collected code ({@link mfaLoginRequestBody}).
 * - AC2 the input is constrained to exactly six digits before submission
 *   ({@link sanitizeMfaCodeInput}, {@link isSubmittableMfaCode},
 *   {@link validateMfaCodeValues}).
 * - AC3 an invalid-code envelope is classified as a *refused code* rather than as
 *   a refused login ({@link classifyMfaSubmission}), which is what lets the
 *   screen retain the step, clear the input and render the localized message.
 *
 * No React, no i18n, no DOM: the step renders what this module decides.
 *
 * ## Why the classification is separate from `classifyLoginFailure`
 *
 * The auth slice collapses **every** 401 and 403 into one memberless rejection,
 * because Requirement 4 AC12 forbids the refusal of a *credential* submission
 * from disclosing whether the address belongs to an account. `invalid_mfa_code`
 * also arrives as a 401, so that collapse would swallow it — and AC3 requires the
 * opposite: retain the step, clear the input, say that the code was wrong.
 *
 * Disclosing that is not a disclosure at all: reaching this step already means a
 * correct email address, a correct password and an enrolled account, so the
 * envelope tells the submitter nothing they did not already supply. Every other
 * 401 or 403 on the resubmission still goes through `classifyLoginFailure`, so the
 * uniform non-disclosing rejection is reused verbatim rather than re-derived here.
 *
 * Requirements: 5.1, 5.2, 5.3, 22.7, 22.12.
 */

import type { Role } from '../../api/enums'
import { isApiError } from '../../errors/errorMessages'
import { BOUNDS, SCHEMAS, validateSchema, type ValidationIssue } from '../../forms/validators'
import type { RenderedInput } from '../../forms/violations'
// Imported from the modules rather than through `features/auth/index.ts`: the login
// screen renders the code step, so a barrel import here would close a cycle
// between the two slices' entry points.
import {
  classifyLoginFailure,
  LOGIN_CONTRACT_PATH,
  loginRequestBody,
  MFA_REQUIRED_ERROR_KEY,
  type LoginCredentials,
  type LoginOutcome,
} from '../auth/loginOutcome'

// ── The endpoint and the request body (AC1) ────────────────────────────────────

/**
 * The path the code step resubmits to (AC1).
 *
 * The same operation the credential submission used — the code is a member of
 * `LoginRequest`, not a second endpoint — so the path is imported from the auth
 * slice rather than respelled, and a contract change lands in one place.
 */
export const MFA_LOGIN_CONTRACT_PATH = LOGIN_CONTRACT_PATH

/** The `LoginRequest` body of the resubmission: the credentials plus the code (AC1). */
export function mfaLoginRequestBody(
  credentials: LoginCredentials,
  code: string,
): {
  readonly email: string
  readonly password: string
  readonly role: Role
  readonly mfa_code: string
} {
  return { ...loginRequestBody(credentials), mfa_code: sanitizeMfaCodeInput(code) }
}

// ── The input (AC2) ───────────────────────────────────────────────────────────

/** Number of digits the code carries (`BOUNDS.code.length`). */
export const MFA_CODE_LENGTH = BOUNDS.code.length

/**
 * The member name of `LoginRequest` the code is submitted as.
 *
 * Also the path a Field_Violation about the code is addressed to, which is what
 * lets `forms/violations.ts` place it on the input with no per-form table.
 */
export const MFA_CODE_PATH = 'mfa_code'

/** DOM `id` of the code input. */
export const MFA_CODE_INPUT_ID = 'mfa-code'

/** The single input the step renders (Requirement 20 AC6). */
export const MFA_CODE_INPUTS: readonly RenderedInput[] = Object.freeze([
  Object.freeze({ path: MFA_CODE_PATH, id: MFA_CODE_INPUT_ID }),
])

/** The form state of the step. */
export interface MfaCodeValues {
  readonly mfa_code: string
}

/** The empty step: no code entered. */
export const EMPTY_MFA_CODE_VALUES: MfaCodeValues = Object.freeze({ mfa_code: '' })

/** Code points that are digits in a script the Web_Client renders (Req 19 AC1). */
const LOCALIZED_DIGIT_BLOCKS: readonly (readonly [number, number])[] = Object.freeze([
  // Arabic-Indic ٠–٩ and Extended Arabic-Indic ۰–۹, which an Arabic or Persian
  // keyboard layout produces for the same keys.
  [0x0660, 0x0669],
  [0x06f0, 0x06f9],
])

/** The ASCII digit a code point denotes, or `null` when it denotes none. */
function asciiDigit(codePoint: number): string | null {
  if (codePoint >= 0x30 && codePoint <= 0x39) {
    return String.fromCharCode(codePoint)
  }
  for (const [first, last] of LOCALIZED_DIGIT_BLOCKS) {
    if (codePoint >= first && codePoint <= last) {
      return String.fromCharCode(0x30 + (codePoint - first))
    }
  }
  return null
}

/**
 * Constrains an entered value to at most {@link MFA_CODE_LENGTH} ASCII digits
 * (AC2).
 *
 * Everything that is not a digit is dropped — spaces and separators a person
 * copying a code out of an authenticator app routinely brings along — and the
 * result is truncated to the code length, so the input cannot hold a value the
 * Backend_Api would reject on shape alone.
 *
 * Arabic-Indic and Extended Arabic-Indic digits are folded to their ASCII
 * counterparts rather than discarded: the same physical keys produce them under
 * an Arabic keyboard layout, and `validateSixDigitCode` accepts ASCII digits
 * only, so discarding them would leave an Arabic-locale user typing into an input
 * that stays empty. The *value* of the code is unchanged by the fold — it is the
 * same six digits — which is why this is not the content rewriting Requirement 19
 * AC10 forbids for Backend_Api text.
 */
export function sanitizeMfaCodeInput(raw: unknown): string {
  if (typeof raw !== 'string') {
    return ''
  }
  let digits = ''
  for (const character of raw) {
    if (digits.length >= MFA_CODE_LENGTH) {
      break
    }
    const digit = asciiDigit(character.codePointAt(0) ?? 0)
    if (digit !== null) {
      digits += digit
    }
  }
  return digits
}

/** Whether the entered value is a complete code, i.e. may be submitted (AC2). */
export function isSubmittableMfaCode(value: unknown): boolean {
  return sanitizeMfaCodeInput(value).length === MFA_CODE_LENGTH
}

/**
 * Applies the six-digit rule to the entered value (AC2).
 *
 * Returns every issue rather than the first, the way the login form does, so the
 * step can render them simultaneously (Requirement 22 AC9). The rule itself is
 * `SCHEMAS.mfaChallenge` in `forms/validators.ts`; nothing is restated here.
 */
export function validateMfaCodeValues(values: MfaCodeValues): readonly ValidationIssue[] {
  return validateSchema(SCHEMAS.mfaChallenge, { ...values })
}

// ── Classification (AC3) ──────────────────────────────────────────────────────

/** The `error` member of an incorrect multi-factor code (AC3). */
export const MFA_INVALID_CODE_ERROR_KEY = 'invalid_mfa_code'

/**
 * The `error` members that mean "the code was not accepted" (AC3).
 *
 * `mfa_required` is included because the Backend_Api answers with it when the
 * submitted code is absent or unusable on its side as well; both outcomes leave
 * the user exactly where AC3 puts them — on the step, with an empty input.
 */
export const MFA_CODE_REFUSED_ERROR_KEYS: readonly string[] = Object.freeze([
  MFA_INVALID_CODE_ERROR_KEY,
  MFA_REQUIRED_ERROR_KEY,
])

/**
 * What a resubmitted login resolved to.
 *
 * `code-refused` is the AC3 outcome and carries the envelope's own `error` key, so
 * the step renders the localized entry of the key the Backend_Api actually sent
 * rather than one message for two causes. Everything else is a {@link LoginOutcome}
 * produced by the auth slice's own classifier, unchanged — except its
 * `mfa-required` member, which {@link classifyMfaSubmission} has already absorbed
 * into `code-refused` and which therefore cannot occur here.
 */
export type MfaSubmissionOutcome =
  | { readonly kind: 'code-refused'; readonly errorKey: string }
  | Exclude<LoginOutcome, { readonly kind: 'mfa-required' }>

/**
 * Classifies a failed resubmission (AC3, Requirement 4 AC12).
 *
 * An invalid-code envelope becomes {@link MfaSubmissionOutcome} `code-refused`;
 * every other 401 or 403 is delegated to `classifyLoginFailure` and so collapses
 * to the uniform rejection that discloses nothing; anything else — a 422, a 429, a
 * 5xx, a timeout, a transport failure — comes back as `failed` for the ordinary
 * Error_Presenter surface.
 */
export function classifyMfaSubmission(failure: unknown): MfaSubmissionOutcome {
  if (isApiError(failure) && MFA_CODE_REFUSED_ERROR_KEYS.includes(failure.error)) {
    return { kind: 'code-refused', errorKey: failure.error }
  }
  const classified = classifyLoginFailure(failure)
  // Absorbed above; narrowed rather than cast so the union stays honest.
  return classified.kind === 'mfa-required'
    ? { kind: 'code-refused', errorKey: MFA_REQUIRED_ERROR_KEY }
    : classified
}

/** Whether an outcome keeps the user on the code step (AC3). */
export function retainsCodeStep(outcome: MfaSubmissionOutcome | null): boolean {
  return outcome !== null && (outcome.kind === 'code-refused' || outcome.kind === 'failed')
}
