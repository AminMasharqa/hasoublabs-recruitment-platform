/**
 * Localized text for the two kinds of field-level problem a variant form renders:
 * a client-side {@link ValidationIssue} from the Form_Validator and a server-side
 * {@link FieldViolation} from a 422 Error_Envelope.
 *
 * Both arrive as machine values — a catalogue key with interpolation parameters,
 * or a violation `code` — and neither carries a message, deliberately: the
 * message is a catalogue entry resolved against the active Locale (Req 19 AC2).
 * This module is the single place that resolution happens for the slice, so the
 * two sources render the same way beside the same input and a form component
 * never touches i18next keys itself.
 *
 * Pure: it takes the i18next instance rather than calling a hook, so the mapping
 * is testable without a renderer.
 *
 * Requirements: 19.2, 22.9, 22.10.
 */

import type { i18n as I18nextInstance, TOptions } from 'i18next'

import type { FieldViolation } from '../../api/errors'
import { UNKNOWN_VIOLATION_CODE } from '../../api/errors'
import { ERROR_NAMESPACE, FIELD_VIOLATION_KEY_PREFIX } from '../../i18n'
import type { PlaceableIssue } from '../../forms/violations'
import type { ValidationIssue } from '../../forms/validators'

/**
 * i18next's `t` as a plain string function.
 *
 * The catalogues are not declared to i18next's type system, so its key generics
 * degrade to `string`; the cast is confined here rather than spread over the call
 * sites, mirroring `errors/errorMessages.ts`.
 */
function translate(instance: I18nextInstance, key: string, values?: TOptions): string {
  const entry = instance.t(key, values) as unknown
  return typeof entry === 'string' ? entry : key
}

/**
 * The catalogue key of a {@link ValidationIssue}'s `messageKey`.
 *
 * The Form_Validator emits a dotted key whose first segment names the namespace
 * (`validation.tooLong`), which i18next addresses as `validation:tooLong`.
 */
export function issueCatalogueKey(messageKey: string): string {
  const separator = messageKey.indexOf('.')
  if (separator <= 0) {
    return messageKey
  }
  return `${messageKey.slice(0, separator)}:${messageKey.slice(separator + 1)}`
}

/** The localized message of a client-side validation issue. */
export function validationIssueMessage(
  instance: I18nextInstance,
  issue: ValidationIssue,
): string {
  return translate(instance, issueCatalogueKey(issue.messageKey), issue.params)
}

/**
 * The localized message of a server-reported Field_Violation.
 *
 * Resolved from the `errors:field.<code>` catalogue, falling back to the generic
 * `unknown_violation` entry for a code the catalogue does not carry — so a
 * Backend_Api that starts reporting a new code renders a usable message rather
 * than a raw key.
 */
export function fieldViolationMessage(
  instance: I18nextInstance,
  violation: FieldViolation,
): string {
  const code = typeof violation.code === 'string' && violation.code !== '' ? violation.code : UNKNOWN_VIOLATION_CODE
  const key = `${ERROR_NAMESPACE}:${FIELD_VIOLATION_KEY_PREFIX}.${code}`
  return instance.exists(key)
    ? translate(instance, key)
    : translate(instance, `${ERROR_NAMESPACE}:${FIELD_VIOLATION_KEY_PREFIX}.${UNKNOWN_VIOLATION_CODE}`)
}

/** Whether an issue came from the Form_Validator rather than from the Backend_Api. */
function isValidationIssue(issue: PlaceableIssue): issue is ValidationIssue {
  return typeof (issue as ValidationIssue).messageKey === 'string'
}

/** The localized message of an issue from either source. */
export function issueMessage(instance: I18nextInstance, issue: PlaceableIssue): string {
  return isValidationIssue(issue)
    ? validationIssueMessage(instance, issue)
    : fieldViolationMessage(instance, issue)
}

/** The localized messages of a list of issues, in the order they were reported. */
export function issueMessages(
  instance: I18nextInstance,
  issues: readonly PlaceableIssue[],
): readonly string[] {
  return issues.map((issue) => issueMessage(instance, issue))
}
