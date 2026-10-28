/**
 * Localized text for the two kinds of field-level problem the Admin forms render:
 * a client-side {@link ValidationIssue} from the Form_Validator, and a server-side
 * Field_Violation from a 422 Error_Envelope.
 *
 * Both arrive as machine values — a catalogue key with interpolation parameters, or
 * a violation `code` — and neither carries a message of its own, deliberately: the
 * message is a catalogue entry resolved against the active Locale (Req 19 AC2).
 * This module is the single place that resolution happens for the slice, so a
 * reason input renders both sources the same way and no form component touches an
 * i18next key itself.
 *
 * Pure: it takes the i18next instance rather than calling a hook, so the mapping is
 * testable without a renderer.
 *
 * Requirements: 19.2, 22.9, 22.10.
 */

import type { i18n as I18nextInstance } from 'i18next'

import { UNKNOWN_VIOLATION_CODE } from '../../api/errors'
import type { ValidationIssue } from '../../forms/validators'
import type { PlaceableIssue } from '../../forms/violations'
import { ERROR_NAMESPACE, FIELD_VIOLATION_KEY_PREFIX } from '../../i18n'

/** Whether an issue came from the Form_Validator rather than from the Backend_Api. */
export function isValidationIssue(issue: PlaceableIssue): issue is ValidationIssue {
  return typeof (issue as ValidationIssue).messageKey === 'string'
}

/**
 * The catalogue key of a {@link ValidationIssue}'s `messageKey`.
 *
 * The Form_Validator emits a dotted key whose first segment names the namespace
 * (`validation.tooShort`), which i18next addresses as `validation:tooShort`.
 */
export function issueCatalogueKey(messageKey: string): string {
  const separator = messageKey.indexOf('.')
  return separator <= 0
    ? messageKey
    : `${messageKey.slice(0, separator)}:${messageKey.slice(separator + 1)}`
}

/**
 * The localized message of one issue.
 *
 * A server-supplied `message` wins: the Backend_Api is the authoritative validator
 * (Req 22 AC12) and its message is already resolved against the `Accept-Language`
 * the Api_Client sent, so paraphrasing it locally would risk naming a different
 * rule than the one that actually failed. Otherwise a violation resolves from the
 * `errors:field.<code>` catalogue, falling back to the shared unknown-violation
 * entry so a newly reported code still renders a sentence.
 */
export function issueText(instance: I18nextInstance, issue: PlaceableIssue): string {
  if (isValidationIssue(issue)) {
    return String(instance.t(issueCatalogueKey(issue.messageKey), { ...(issue.params ?? {}) }))
  }
  const supplied = typeof issue.message === 'string' ? issue.message.trim() : ''
  if (supplied !== '') {
    return supplied
  }
  const code = typeof issue.code === 'string' && issue.code.trim() !== '' ? issue.code.trim() : UNKNOWN_VIOLATION_CODE
  const key = `${ERROR_NAMESPACE}:${FIELD_VIOLATION_KEY_PREFIX}.${code}`
  return instance.exists(key)
    ? String(instance.t(key))
    : String(instance.t(`${ERROR_NAMESPACE}:${FIELD_VIOLATION_KEY_PREFIX}.${UNKNOWN_VIOLATION_CODE}`))
}

/** The localized messages of a list of issues, in the order they were reported. */
export function issueTexts(
  instance: I18nextInstance,
  issues: readonly PlaceableIssue[],
): readonly string[] {
  return issues.map((issue) => issueText(instance, issue))
}
