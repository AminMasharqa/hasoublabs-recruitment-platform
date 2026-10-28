/**
 * Localizing the issues a profile form has to render, and indexing them by the
 * input they belong to.
 *
 * Requirement 9 AC11 (and Requirement 10, which shares the machinery) asks for
 * two things from a failed save: every Field_Violation lands on the input its
 * `path` addresses — *including* an indexed path into the education, work,
 * skill or language collections — and every value the user entered survives.
 *
 * The placement itself is already solved by `forms/violations.ts`, which is
 * index-spelling agnostic and never touches a form value. What is left, and what
 * lives here, is the step between a placement and rendered text:
 *
 * - a server {@link FieldViolation} renders the message the Backend_Api supplied
 *   when it supplied one — it is already localized per `Accept-Language` — and
 *   otherwise the `errors:field.<code>` catalogue entry for its machine code;
 * - a client {@link ValidationIssue} renders its own `messageKey` from the
 *   `validation` catalogue with its bounds interpolated.
 *
 * Both are indexed the same way by {@link buildFieldMessageIndex}, so a form
 * renders one message list per input without caring which side produced it. That
 * matters for AC11 specifically: the client-side pass and the 422 pass address
 * the same indexed paths, so the same rendering code places both, and there is no
 * second placement implementation to drift.
 *
 * Pure: no React, no DOM. The i18next instance is passed in.
 */

import type { i18n as I18nextInstance } from 'i18next'

import type { FieldViolation } from '../../../api/errors'
import { UNKNOWN_VIOLATION_CODE } from '../../../api/errors'
import type { ValidationIssue } from '../../../forms/validators'
import {
  normalizePath,
  partitionViolations,
  type RenderedInput,
  type ViolationPartition,
} from '../../../forms/violations'

/** An issue a profile form renders, from either side of the wire. */
export type ProfileIssue = FieldViolation | ValidationIssue

/** The partition of profile issues over the inputs a profile form renders. */
export type ProfileIssuePartition = ViolationPartition<ProfileIssue, RenderedInput>

/** Whether an issue came from the client-side Form_Validator. */
export function isValidationIssue(issue: ProfileIssue): issue is ValidationIssue {
  return typeof (issue as ValidationIssue).messageKey === 'string'
}

/**
 * Catalogue key of a Field_Violation machine code.
 *
 * An absent or blank code resolves to the shared unknown-violation entry, so a
 * violation the Backend_Api reports without a code still renders a sentence.
 */
export function fieldViolationCatalogueKey(code: string | null | undefined): string {
  const trimmed = typeof code === 'string' ? code.trim() : ''
  return `errors:field.${trimmed === '' ? UNKNOWN_VIOLATION_CODE : trimmed}`
}

/**
 * Catalogue key of a {@link ValidationIssue} message key.
 *
 * The Form_Validator emits a dotted `validation.tooLong`; the catalogues are
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
 * validator (Req 22 AC12) and its message is already resolved against the
 * `Accept-Language` the Api_Client sent, so paraphrasing it locally would be both
 * redundant and potentially wrong about the rule that actually failed.
 */
export function localizeProfileIssue(instance: I18nextInstance, issue: ProfileIssue): string {
  if (isValidationIssue(issue)) {
    const key = validationIssueCatalogueKey(issue.messageKey)
    return instance.t(key, { ...(issue.params ?? {}) })
  }
  const supplied = typeof issue.message === 'string' ? issue.message.trim() : ''
  if (supplied !== '') {
    return issue.message as string
  }
  return instance.t(fieldViolationCatalogueKey(issue.code))
}

/** Localized messages, looked up by the path of the input they belong to. */
export interface FieldMessageIndex {
  /** Messages for one input, in the order they were reported; empty when none. */
  messagesFor(path: string): readonly string[]
  /** Messages addressing no rendered input (Req 22 AC10). */
  readonly formLevel: readonly string[]
  /** Total number of messages placed, field-level and form-level together. */
  readonly total: number
}

/** An index over nothing: no field message, no form-level message. */
export const EMPTY_FIELD_MESSAGE_INDEX: FieldMessageIndex = {
  messagesFor: () => [],
  formLevel: [],
  total: 0,
}

/**
 * Localizes a partition into messages addressable by input path.
 *
 * Every placement the partition made is carried over, so the index is exactly as
 * total as the partition is: nothing is dropped and nothing is duplicated.
 */
export function buildFieldMessageIndex(
  instance: I18nextInstance,
  partition: ProfileIssuePartition | null | undefined,
): FieldMessageIndex {
  if (partition == null || partition.placedCount === 0) {
    return EMPTY_FIELD_MESSAGE_INDEX
  }
  const byPath = new Map<string, string[]>()
  for (const placement of partition.fields) {
    const messages = placement.violations.map((issue) => localizeProfileIssue(instance, issue))
    // The placement path is already canonical, but normalizing again is free and
    // keeps the lookup symmetric with `messagesFor`.
    byPath.set(normalizePath(placement.path), messages)
  }
  const formLevel = partition.formLevel.map((issue) => localizeProfileIssue(instance, issue))
  return {
    messagesFor: (path: string) => byPath.get(normalizePath(path)) ?? [],
    formLevel,
    total: partition.placedCount,
  }
}

/**
 * Partitions profile issues over the rendered inputs.
 *
 * A thin alias over `partitionViolations` bound to {@link ProfileIssue}, so both
 * profile slices reach the same entry point whether the issues came from the
 * Form_Validator or from a 422.
 */
export function partitionProfileIssues(
  issues: readonly ProfileIssue[] | null | undefined,
  inputs: readonly RenderedInput[] | null | undefined,
): ProfileIssuePartition {
  return partitionViolations<ProfileIssue, RenderedInput>(issues, inputs)
}
