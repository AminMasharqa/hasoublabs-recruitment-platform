/**
 * The login form's pure half: the values it holds, the inputs it renders, the
 * client-side rules it applies and the catalogue key each reported issue resolves
 * to.
 *
 * Requirement 4 AC1 fixes the three collected values — email address, password and
 * a role of `ADMIN`, `CANDIDATE` or `SENIOR`. The rules themselves are not
 * restated here: `SCHEMAS.login` in `forms/validators.ts` already mirrors the
 * Backend_Api `LoginRequest` bounds, including the deliberately permissive
 * login-password rule (the Backend_Api declares `min_length=1` there so an account
 * created under an earlier policy can still authenticate).
 *
 * Client validation is an aid only; every submission still goes to the
 * Backend_Api for authoritative validation (Requirement 22 AC12), and a reported
 * violation is placed back onto these inputs by `forms/violations.ts`
 * (Requirement 22 AC9–AC11).
 *
 * Separate from `LoginScreen.tsx` because `react/only-export-components` keeps
 * non-component exports out of a component module, and because everything here is
 * assertable without rendering.
 *
 * Requirements: 4.1, 22.9, 22.10, 22.11, 22.12.
 */

import type { Role } from '../../api/enums'
import type { RenderedInput } from '../../forms/violations'
import { ROLE_VALUES, SCHEMAS, validateSchema, type ValidationIssue } from '../../forms/validators'
import { UNKNOWN_VIOLATION_CODE } from '../../api/errors'
import { FIELD_VIOLATION_KEY_PREFIX } from '../../i18n'

// ── Values ────────────────────────────────────────────────────────────────────

/**
 * The form state.
 *
 * `role` is a plain `string` rather than a `Role` because that is what a `select`
 * holds before anything is chosen; {@link loginRole} narrows it at the submission
 * boundary, and the schema reports the unset case as a field violation.
 */
export interface LoginFormValues {
  readonly email: string
  readonly password: string
  readonly role: string
}

/** The initial, empty form state. */
export const EMPTY_LOGIN_VALUES: LoginFormValues = Object.freeze({
  email: '',
  password: '',
  role: '',
})

/** The roles Requirement 4 AC1 offers, in the contract's own order. */
export const LOGIN_ROLES: readonly Role[] = ROLE_VALUES.values

/** The selected role, or `null` when the selection is not a declared Role. */
export function loginRole(values: LoginFormValues): Role | null {
  return ROLE_VALUES.includes(values.role) ? values.role : null
}

// ── Rendered inputs ───────────────────────────────────────────────────────────

/** DOM `id` prefix shared by the three inputs, so ids cannot collide with a screen. */
export const LOGIN_INPUT_ID_PREFIX = 'login-'

/**
 * The inputs the form renders, in rendering order (Requirement 20 AC6).
 *
 * The `path` of each is the member name of the `LoginRequest` body, so a
 * Field_Violation the Backend_Api addresses to `email` lands on the email input
 * without any per-form translation table.
 */
export const LOGIN_INPUTS: readonly RenderedInput[] = Object.freeze([
  Object.freeze({ path: 'email', id: `${LOGIN_INPUT_ID_PREFIX}email` }),
  Object.freeze({ path: 'password', id: `${LOGIN_INPUT_ID_PREFIX}password` }),
  Object.freeze({ path: 'role', id: `${LOGIN_INPUT_ID_PREFIX}role` }),
])

// ── Client-side rules ─────────────────────────────────────────────────────────

/**
 * Applies the `LoginRequest` bounds to the entered values.
 *
 * Returns *every* issue rather than the first, so the form can render them
 * simultaneously the way Requirement 22 AC9 requires of the server's own
 * violations.
 */
export function validateLoginValues(values: LoginFormValues): readonly ValidationIssue[] {
  return validateSchema(SCHEMAS.login, { ...values })
}

// ── Message resolution ────────────────────────────────────────────────────────

/**
 * The catalogue key a {@link ValidationIssue} `messageKey` addresses.
 *
 * The Form_Validator emits `validation.<entry>`, while the catalogue holds those
 * entries flat in the `validation` *namespace*. i18next reads `:` as the namespace
 * separator and `.` as the key separator, so the first segment is promoted to a
 * namespace — `validation.required` becomes `validation:required`. A key that is
 * already namespaced, or carries no separator, is returned untouched.
 */
export function validationCatalogueKey(messageKey: string): string {
  if (messageKey.includes(':')) {
    return messageKey
  }
  const separator = messageKey.indexOf('.')
  if (separator <= 0) {
    return messageKey
  }
  return `${messageKey.slice(0, separator)}:${messageKey.slice(separator + 1)}`
}

/** The catalogue key a server Field_Violation `code` is looked up under. */
export function fieldViolationCatalogueKey(code: string | null | undefined): string {
  const trimmed = typeof code === 'string' ? code.trim() : ''
  const safe = /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : UNKNOWN_VIOLATION_CODE
  return `errors:${FIELD_VIOLATION_KEY_PREFIX}.${safe}`
}

/** An issue from either source that the form renders a message for. */
export interface RenderableIssue {
  readonly path: string
  /** Present on a client-side {@link ValidationIssue}. */
  readonly messageKey?: string
  /** Present on a server Field_Violation. */
  readonly code?: string
  readonly params?: Readonly<Record<string, string | number>>
}

/**
 * A catalogue lookup, as a plain string function.
 *
 * The catalogues are not declared to i18next's type system, so its key generics
 * degrade to `string`; narrowing at this one seam keeps the rest of the module free
 * of casts, the same way `errors/errorMessages.ts` does.
 */
export type Translate = (key: string, values?: Readonly<Record<string, unknown>>) => string

/**
 * Whether a resolved entry is i18next's echo of a missing key rather than a
 * message.
 *
 * `parseMissingKeyHandler` echoes the key it was asked for, but i18next hands it
 * the key *after* the `namespace:` prefix has been consumed — a missing
 * `errors:field.unheard_of` comes back as `field.unheard_of`. Comparing against
 * the requested key alone therefore accepts the echo and renders a catalogue key
 * to the user, which Requirement 19 AC2 forbids; both forms are treated as
 * missing. An entry that is blank or whitespace-only is no message either.
 *
 * `errors/errorMessages.ts` reaches the same conclusion through
 * `i18next.exists`, which needs the instance; this module is given a plain
 * lookup function, so the decision is made from the returned value.
 */
function isMissingEntry(key: string, entry: string): boolean {
  if (entry.trim().length === 0 || entry === key) {
    return true
  }
  const separator = key.indexOf(':')
  return separator >= 0 && entry === key.slice(separator + 1)
}

/**
 * The localized message of one reported issue, from either source.
 *
 * A client-side issue resolves its own `messageKey` with the bounds it carries as
 * interpolation values; a server violation resolves `errors:field.<code>`, falling
 * back to the generic field entry for a code the catalogue does not know.
 */
export function issueMessage(translate: Translate, issue: RenderableIssue): string {
  if (typeof issue.messageKey === 'string' && issue.messageKey.length > 0) {
    return translate(validationCatalogueKey(issue.messageKey), { ...issue.params })
  }
  const key = fieldViolationCatalogueKey(issue.code)
  const entry = translate(key)
  return isMissingEntry(key, entry) ? translate(fieldViolationCatalogueKey(null)) : entry
}
