/**
 * Localized text for the machine values the Application surfaces render: an
 * Application status, a routed Application_Channel and one unmet condition of a
 * `precondition_unmet` refusal.
 *
 * All three arrive as codes rather than as sentences, deliberately: the rendered
 * message is a catalogue entry resolved against the active Locale (Requirement 19
 * AC2), not text a server response chose. This module is the single place that
 * resolution happens for the slice, so a status renders identically on the
 * Candidate list, the Application detail and the Applicant_Card.
 *
 * A code the catalogue does not name still renders a sentence rather than a blank:
 * `ApplicationDTO.status` and `routed_channel` are declared as free strings by the
 * contract, and `details.unmet` is an open list, so an unrecognized value is a
 * possibility the Web_Client has to survive (Requirement 21 AC2 takes the same
 * position for an unrecognized `error` key).
 *
 * Pure: it takes the i18next instance rather than calling a hook, so the mapping is
 * testable without a renderer.
 *
 * Requirements: 14.6, 14.9, 14.11, 14.12, 19.2.
 */

import type { i18n as I18nextInstance } from 'i18next'

import { UNKNOWN_VIOLATION_CODE, type FieldViolation } from '../../api/errors'
import type { ValidationIssue } from '../../forms/validators'
import type { PlaceableIssue } from '../../forms/violations'
import { ERROR_NAMESPACE, FIELD_VIOLATION_KEY_PREFIX } from '../../i18n'

import type { UnmetCondition } from './applicationRules'

/** The catalogue namespace this slice resolves against. */
export const APPLICATIONS_NAMESPACE = 'applications'

/** Catalogue prefix of the Application statuses. */
const STATUS_PREFIX = `${APPLICATIONS_NAMESPACE}:status`

/** Catalogue prefix of the routed Application_Channels. */
const CHANNEL_PREFIX = `${APPLICATIONS_NAMESPACE}:channel`

/** Catalogue prefix of the unmet conditions of AC6. */
const UNMET_PREFIX = `${APPLICATIONS_NAMESPACE}:apply.unmet`

/**
 * The shape a value must have to be looked up as a catalogue key.
 *
 * i18next reads `.` as a key separator and `:` as a namespace separator, so a value
 * carrying either would address something other than the intended entry. Spaces are
 * allowed because the contract's statuses carry them (`Under Review`).
 */
const LOOKUPABLE_CODE = /^[A-Za-z0-9 _-]+$/

/**
 * The entry a prefix and a machine code resolve to, or `null` when the catalogue
 * holds none.
 *
 * The code is validated *before* it is appended to the prefix, so a value carrying a
 * `.` or a `:` cannot traverse the catalogue into an unrelated entry.
 */
function lookup(instance: I18nextInstance, prefix: string, code: string): string | null {
  if (!LOOKUPABLE_CODE.test(code)) {
    return null
  }
  const key = `${prefix}.${code}`
  if (!instance.exists(key)) {
    return null
  }
  const entry = instance.t(key)
  return typeof entry === 'string' && entry !== key && entry.trim() !== '' ? entry : null
}

/**
 * The localized name of an Application status (AC9, AC11, AC12).
 *
 * An unrecognized status renders as the value the Backend_Api reported, which is
 * information, rather than as a blank cell, which is a defect the user cannot tell
 * from a missing status.
 */
export function applicationStatusLabel(instance: I18nextInstance, status: string): string {
  return lookup(instance, STATUS_PREFIX, status) ?? status
}

/** The localized name of the Application_Channel an Application was routed through. */
export function applicationChannelLabel(instance: I18nextInstance, channel: string): string {
  return lookup(instance, CHANNEL_PREFIX, channel) ?? channel
}

/**
 * The localized text of one unmet condition (AC6).
 *
 * Resolution order: the catalogue entry for the reported code, then the text the
 * envelope supplied — which the Backend_Api already localized against the
 * `Accept-Language` the Api_Client sent — and finally the generic entry naming the
 * code, so every reported condition renders as its own sentence.
 */
export function unmetConditionText(
  instance: I18nextInstance,
  condition: UnmetCondition,
): string {
  const fromCatalogue =
    condition.code === null ? null : lookup(instance, UNMET_PREFIX, condition.code)
  if (fromCatalogue !== null) {
    return fromCatalogue
  }
  if (condition.text.trim() !== '') {
    return condition.text
  }
  return String(instance.t(`${UNMET_PREFIX}.fallback`, { value: condition.code ?? '' }))
}

/** The localized texts of every unmet condition, in the reported order (AC6). */
export function unmetConditionTexts(
  instance: I18nextInstance,
  conditions: readonly UnmetCondition[],
): readonly string[] {
  return conditions.map((condition) => unmetConditionText(instance, condition))
}

// ── Field-level problems on the status control (AC13) ─────────────────────────

/**
 * The localized message of a field-level problem beside the reason input: a
 * client-side {@link ValidationIssue} from the Form_Validator, or a server-side
 * Field_Violation from a 422 Error_Envelope (Requirement 22 AC9, AC10).
 *
 * The Form_Validator emits a dotted catalogue key whose first segment names the
 * namespace (`validation.tooLong`), which i18next addresses as `validation:tooLong`.
 * A violation resolves from the `errors:field.<code>` catalogue, behind the message
 * the Backend_Api supplied — it is the authoritative validator (Req 22 AC12) and its
 * message is already resolved against the `Accept-Language` the Api_Client sent.
 *
 * The CV and Admin-account slices carry the same mapper for their own forms; it stays
 * per-slice so a form never has to reach into another slice for its field text.
 */
export function fieldIssueText(instance: I18nextInstance, issue: PlaceableIssue): string {
  const messageKey = (issue as ValidationIssue).messageKey
  if (typeof messageKey === 'string') {
    const separator = messageKey.indexOf('.')
    const key =
      separator <= 0
        ? messageKey
        : `${messageKey.slice(0, separator)}:${messageKey.slice(separator + 1)}`
    return String(instance.t(key, { ...((issue as ValidationIssue).params ?? {}) }))
  }
  const supplied = (issue as FieldViolation).message
  if (typeof supplied === 'string' && supplied.trim() !== '') {
    return supplied
  }
  const reported = (issue as FieldViolation).code
  const code = typeof reported === 'string' && reported.trim() !== '' ? reported.trim() : UNKNOWN_VIOLATION_CODE
  const key = `${ERROR_NAMESPACE}:${FIELD_VIOLATION_KEY_PREFIX}.${code}`
  return String(
    instance.t(
      instance.exists(key)
        ? key
        : `${ERROR_NAMESPACE}:${FIELD_VIOLATION_KEY_PREFIX}.${UNKNOWN_VIOLATION_CODE}`,
    ),
  )
}

/** The localized messages of a list of field-level problems, in reported order. */
export function fieldIssueTexts(
  instance: I18nextInstance,
  issues: readonly PlaceableIssue[],
): readonly string[] {
  return issues.map((issue) => fieldIssueText(instance, issue))
}
