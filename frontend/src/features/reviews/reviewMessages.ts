/**
 * Localizing the field-level problems a review form renders, from either side of
 * the wire.
 *
 * Requirement 15 AC3 asks for two things from a 422: every Field_Violation lands
 * on the input its `path` addresses, and every value the user entered survives.
 * The placement is `forms/violations.ts`' job and the retention is the form's
 * (nothing in the failure path writes to the draft). What is left, and what lives
 * here, is the step from a placement to rendered text:
 *
 * - a server `FieldViolation` renders the message the Backend_Api supplied
 *   when it supplied one — it is already resolved against the `Accept-Language`
 *   the Api_Client sent, so paraphrasing it locally would be redundant and
 *   possibly wrong about which rule failed — and otherwise the
 *   `errors:field.<code>` catalogue entry for its machine code;
 * - a client {@link ValidationIssue} renders its own `messageKey` from the
 *   `validation` catalogue with its bounds interpolated.
 *
 * Pure: the i18next instance is passed in rather than taken from a hook, so the
 * mapping is testable without a renderer.
 *
 * Requirements: 15.3, 19.2, 22.9, 22.10.
 */

import type { i18n as I18nextInstance } from 'i18next'

import { UNKNOWN_VIOLATION_CODE } from '../../api/errors'
import type { ValidationIssue } from '../../forms/validators'
import {
  partitionViolations,
  violationsForPath,
  type PlaceableIssue,
  type RenderedInput,
  type ViolationPartition,
} from '../../forms/violations'

/** The partition of review-form issues over the inputs the form renders. */
export type ReviewIssuePartition = ViolationPartition<PlaceableIssue, RenderedInput>

/** Whether an issue came from the client-side Form_Validator. */
function isValidationIssue(issue: PlaceableIssue): issue is ValidationIssue {
  return typeof (issue as ValidationIssue).messageKey === 'string'
}

/**
 * Catalogue key of a Field_Violation machine code.
 *
 * An absent or blank code resolves to the shared unknown-violation entry, so a
 * violation reported without a code still renders a sentence rather than a raw
 * key.
 */
export function fieldViolationCatalogueKey(code: string | null | undefined): string {
  const trimmed = typeof code === 'string' ? code.trim() : ''
  return `errors:field.${trimmed === '' ? UNKNOWN_VIOLATION_CODE : trimmed}`
}

/**
 * Catalogue key of a {@link ValidationIssue} message key.
 *
 * The Form_Validator emits a dotted `validation.ratingRange`; the catalogues are
 * per-namespace and flat, so the first separator becomes the namespace colon.
 */
export function validationIssueCatalogueKey(messageKey: string): string {
  const separator = messageKey.indexOf('.')
  return separator === -1
    ? `validation:${messageKey}`
    : `validation:${messageKey.slice(separator + 1)}`
}

/** The text one issue renders as. */
export function localizeReviewIssue(instance: I18nextInstance, issue: PlaceableIssue): string {
  if (isValidationIssue(issue)) {
    const entry = instance.t(validationIssueCatalogueKey(issue.messageKey), {
      ...(issue.params ?? {}),
    }) as unknown
    return typeof entry === 'string' ? entry : issue.messageKey
  }
  const supplied = typeof issue.message === 'string' ? issue.message.trim() : ''
  if (supplied !== '') {
    return issue.message as string
  }
  const entry = instance.t(fieldViolationCatalogueKey(issue.code)) as unknown
  return typeof entry === 'string' ? entry : fieldViolationCatalogueKey(issue.code)
}

/** The localized messages of a list of issues, in the order they were reported. */
export function localizeReviewIssues(
  instance: I18nextInstance,
  issues: readonly PlaceableIssue[],
): readonly string[] {
  return issues.map((issue) => localizeReviewIssue(instance, issue))
}

/**
 * Partitions review-form issues over the rendered inputs.
 *
 * A thin alias over `partitionViolations` bound to this slice's issue type, so the
 * client-side pass and the 422 pass reach the same entry point.
 */
export function partitionReviewIssues(
  issues: readonly PlaceableIssue[] | null | undefined,
  inputs: readonly RenderedInput[] | null | undefined,
): ReviewIssuePartition {
  return partitionViolations<PlaceableIssue, RenderedInput>(issues, inputs)
}

/** The messages every partition placed on one input, in report order. */
export function messagesForPath(
  instance: I18nextInstance,
  partitions: readonly ReviewIssuePartition[],
  path: string,
): readonly string[] {
  return partitions.flatMap((partition) =>
    localizeReviewIssues(instance, violationsForPath(partition, path)),
  )
}
