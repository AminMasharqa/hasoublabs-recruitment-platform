/**
 * Turning the issues a registration submission produces into rendered text
 * (Requirement 6 AC13, AC14; Requirement 19 AC2; Requirement 22 AC9, AC10).
 *
 * Placement is already solved by `forms/violations.ts` and is not repeated here.
 * What is left is the step between a placement and a sentence, and the one
 * registration-specific judgement Requirement 6 AC13 asks for.
 *
 * ## The email conflict (AC13)
 *
 * A registration refused with `conflicting_state` (or the taxonomy's narrower
 * `duplicate_email`) means an account already exists for the submitted address.
 * AC13 asks for a localized message that identifies *that* — and no other account
 * detail. The Error_Envelope's own `message` and `details` are not usable for it:
 * they are written by the Backend_Api and may name the existing account's role,
 * status or identifier, which is exactly what must not be rendered to someone who
 * has just proved only that they know an email address. So
 * {@link isEmailConflict} diverts those two keys to a fixed catalogue entry, and
 * every other failure goes to the Error_Presenter unchanged.
 *
 * Pure: no React, no DOM. The i18next instance is passed in.
 */

import type { i18n as I18nextInstance } from 'i18next'

import { UNKNOWN_VIOLATION_CODE, type FieldViolation } from '../../api/errors'
import { errorKeyOf } from '../../errors/errorMessages'
import type { ValidationIssue } from '../../forms/validators'
import {
  normalizePath,
  partitionViolations,
  type RenderedInput,
  type ViolationPartition,
} from '../../forms/violations'

/** An issue the registration form renders, from either side of the wire. */
export type RegistrationIssue = FieldViolation | ValidationIssue

/** The partition of registration issues over the inputs the form renders. */
export type RegistrationIssuePartition = ViolationPartition<RegistrationIssue, RenderedInput>

/** A partition of nothing, the state the form starts in. */
export const NO_ISSUES: RegistrationIssuePartition = Object.freeze({
  fields: [],
  formLevel: [],
  placedCount: 0,
})

/** Whether an issue came from the client-side Form_Validator. */
export function isValidationIssue(issue: RegistrationIssue): issue is ValidationIssue {
  return typeof (issue as ValidationIssue).messageKey === 'string'
}

/** Catalogue key of a Field_Violation machine code; a blank code falls back. */
export function fieldViolationCatalogueKey(code: string | null | undefined): string {
  const trimmed = typeof code === 'string' ? code.trim() : ''
  return `errors:field.${trimmed === '' ? UNKNOWN_VIOLATION_CODE : trimmed}`
}

/**
 * Catalogue key of a {@link ValidationIssue} message key.
 *
 * The Form_Validator emits a dotted `validation.tooLong` while the catalogues are
 * per-namespace and flat, so the first separator becomes the namespace colon.
 */
export function validationIssueCatalogueKey(messageKey: string): string {
  const separator = messageKey.indexOf('.')
  return separator === -1
    ? `validation:${messageKey}`
    : `validation:${messageKey.slice(separator + 1)}`
}

/**
 * The text one issue renders as.
 *
 * A server-supplied `message` wins: the Backend_Api is the authoritative
 * validator (Req 22 AC12) and its message was already resolved against the
 * `Accept-Language` the Api_Client sent, so restating it locally would risk
 * naming a different rule than the one that actually failed.
 */
export function localizeRegistrationIssue(
  instance: I18nextInstance,
  issue: RegistrationIssue,
): string {
  if (isValidationIssue(issue)) {
    return instance.t(validationIssueCatalogueKey(issue.messageKey), { ...(issue.params ?? {}) })
  }
  const supplied = typeof issue.message === 'string' ? issue.message.trim() : ''
  return supplied === '' ? instance.t(fieldViolationCatalogueKey(issue.code)) : supplied
}

/** Localized messages, looked up by the path of the input they belong to. */
export interface FieldMessages {
  /** Messages for one input, in the order they were reported; empty when none. */
  for(path: string): readonly string[]
  /** Messages addressing no rendered input (Req 22 AC10). */
  readonly formLevel: readonly string[]
  /** Total number of messages placed, field-level and form-level together. */
  readonly total: number
}

/** Localizes a partition into messages addressable by input path (AC14). */
export function localizeIssuePartition(
  instance: I18nextInstance,
  partition: RegistrationIssuePartition,
): FieldMessages {
  const byPath = new Map<string, readonly string[]>()
  for (const placement of partition.fields) {
    byPath.set(
      normalizePath(placement.path),
      placement.violations.map((issue) => localizeRegistrationIssue(instance, issue)),
    )
  }
  return {
    for: (path: string) => byPath.get(normalizePath(path)) ?? [],
    formLevel: partition.formLevel.map((issue) => localizeRegistrationIssue(instance, issue)),
    total: partition.placedCount,
  }
}

/** Partitions registration issues over the rendered inputs (AC14). */
export function partitionRegistrationIssues(
  issues: readonly RegistrationIssue[] | null | undefined,
  inputs: readonly RenderedInput[] | null | undefined,
): RegistrationIssuePartition {
  return partitionViolations<RegistrationIssue, RenderedInput>(issues, inputs)
}

/** Error_Envelope keys that mean an account already exists for the address (AC13). */
export const EMAIL_CONFLICT_ERROR_KEYS: readonly string[] = Object.freeze([
  'conflicting_state',
  'duplicate_email',
])

/**
 * Whether a failed registration is the email-address conflict of AC13.
 *
 * Read off the `error` member only. Neither the envelope `message` nor its
 * `details` is consulted, and neither is ever rendered for this outcome.
 */
export function isEmailConflict(error: unknown): boolean {
  const key = errorKeyOf(error)
  return key !== null && EMAIL_CONFLICT_ERROR_KEYS.includes(key)
}
