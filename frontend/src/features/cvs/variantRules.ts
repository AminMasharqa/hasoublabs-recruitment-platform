/**
 * The CV_Variant decisions, as pure functions.
 *
 * Requirement 11 states four rules about *what may be done* to a variant list,
 * and every one of them is a predicate over the list rather than a rendering
 * concern:
 *
 * - **AC3** while five active variants exist, creating another is refused, and
 *   the refusal names the limit ({@link canCreateVariant},
 *   {@link createBlockedReason}).
 * - **AC6** while exactly one active variant exists, archiving it is refused
 *   ({@link canArchiveVariant}, {@link archiveBlockedReason}).
 * - **AC7** exactly one variant is rendered as primary at any time
 *   ({@link primaryVariantId}, {@link isRenderedPrimary}, {@link applyPrimary}).
 * - **AC4** an edit submits the changed name or description, and only those
 *   ({@link changedVariantFields}).
 *
 * They live here, free of React, the Api_Client and i18next, so each one is
 * checkable directly from a unit test against a plain array — the screens then
 * only decide how a refusal is *presented*. Nothing here mutates its arguments;
 * {@link applyPrimary} and {@link orderVariantsForDisplay} return new arrays.
 *
 * The 5-variant limit and the 1–100 / ≤300 bounds are not restated here: they are
 * read from `forms/validators.ts`, which mirrors the Pydantic schemas, so this
 * module cannot drift from the Backend_Api on its own.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.6, 11.7.
 */

import type { components } from '../../api/generated/schema'
import {
  BOUNDS,
  SCHEMAS,
  validateSchema,
  type ValidationIssue,
} from '../../forms/validators'
import { textForDisplay } from '../../i18n/formatting'

/** One CV_Variant, exactly as the Backend_Api describes it. */
export type CvVariant = components['schemas']['CvVariantDTO']

/** Body of `POST /me/cv-variants` (AC2). */
export type CreateVariantBody = components['schemas']['CreateVariantRequest']

/** Body of `PATCH /me/cv-variants/{variant_id}` (AC4). */
export type UpdateVariantBody = components['schemas']['UpdateVariantRequest']

/** The maximum number of *active* variants an account may hold (AC3). */
export const MAX_ACTIVE_VARIANTS: number = BOUNDS.cv.maxVariants

/** Inclusive length bounds of the variant name (AC2). */
export const VARIANT_NAME_BOUNDS = BOUNDS.cv.variantName

/** Maximum length of the variant description (AC2). */
export const VARIANT_DESCRIPTION_BOUNDS = BOUNDS.cv.variantDescription

// ── The list ──────────────────────────────────────────────────────────────────

/** Every variant that is not archived. */
export function activeVariants(
  variants: readonly CvVariant[] | null | undefined,
): readonly CvVariant[] {
  return (variants ?? []).filter((variant) => !variant.is_archived)
}

/** How many active variants the account holds — the quantity AC3 and AC6 bound. */
export function countActiveVariants(variants: readonly CvVariant[] | null | undefined): number {
  return activeVariants(variants).length
}

/** The variant with `variantId`, or `null` when the list holds none. */
export function findVariant(
  variants: readonly CvVariant[] | null | undefined,
  variantId: string | null | undefined,
): CvVariant | null {
  if (typeof variantId !== 'string' || variantId === '') {
    return null
  }
  return (variants ?? []).find((variant) => variant.id === variantId) ?? null
}

/**
 * The listing order: active variants first, then by creation instant, oldest
 * first, with the identifier as the tie-break.
 *
 * Archived variants stay in the list — nothing a Candidate uploaded is ever
 * hidden — but they sink below the ones that can still be applied with. The
 * order deliberately does *not* depend on which variant is primary, so making a
 * variant primary marks it in place instead of making the list jump under the
 * pointer that just clicked it.
 */
export function orderVariantsForDisplay(
  variants: readonly CvVariant[] | null | undefined,
): readonly CvVariant[] {
  return [...(variants ?? [])].sort((left, right) => {
    if (left.is_archived !== right.is_archived) {
      return left.is_archived ? 1 : -1
    }
    const byCreation = left.created_at.localeCompare(right.created_at)
    return byCreation === 0 ? left.id.localeCompare(right.id) : byCreation
  })
}

// ── Create (AC2, AC3) ─────────────────────────────────────────────────────────

/** Why a create control is refused. Only one reason exists (AC3). */
export type CreateBlockedReason = 'variant_limit'

/**
 * Whether another variant may be created (AC3).
 *
 * Counts *active* variants only: archiving one frees a slot, which is exactly
 * what the refusal tells the Candidate to do.
 */
export function canCreateVariant(variants: readonly CvVariant[] | null | undefined): boolean {
  return countActiveVariants(variants) < MAX_ACTIVE_VARIANTS
}

/** The reason a create control is disabled, or `null` while it is available (AC3). */
export function createBlockedReason(
  variants: readonly CvVariant[] | null | undefined,
): CreateBlockedReason | null {
  return canCreateVariant(variants) ? null : 'variant_limit'
}

// ── Archive (AC5, AC6) ────────────────────────────────────────────────────────

/** Why an archive control is refused. */
export type ArchiveBlockedReason =
  /** The variant is already archived, so there is nothing to archive. */
  | 'already_archived'
  /** AC6: it is the only active variant left. */
  | 'last_active'

/**
 * The reason a variant's archive control is disabled, or `null` while archiving
 * is available (AC6).
 *
 * `last_active` is decided by the count of active variants, not by the primary
 * designation: the last remaining variant is protected whether or not it is the
 * primary one.
 */
export function archiveBlockedReason(
  variant: CvVariant,
  variants: readonly CvVariant[] | null | undefined,
): ArchiveBlockedReason | null {
  if (variant.is_archived) {
    return 'already_archived'
  }
  return countActiveVariants(variants) <= 1 ? 'last_active' : null
}

/** Whether a variant may be archived (AC6). */
export function canArchiveVariant(
  variant: CvVariant,
  variants: readonly CvVariant[] | null | undefined,
): boolean {
  return archiveBlockedReason(variant, variants) === null
}

// ── Primary designation (AC7) ─────────────────────────────────────────────────

/**
 * The one variant rendered as primary, or `null` when no active variant carries
 * the designation (AC7).
 *
 * The Backend_Api owns the designation and maintains its uniqueness, so in
 * practice at most one variant reports `is_primary`. This function nevertheless
 * resolves the list to a *single* identifier rather than trusting the flag
 * per row, which is what makes "exactly one renders as primary" a property of
 * the rendering instead of a property of the payload: a response that flagged two
 * variants, or that still flagged the previous primary alongside the new one,
 * still renders one badge.
 *
 * An archived variant is never the rendered primary — it cannot be applied with —
 * so the designation is resolved over the active variants, in listing order.
 */
export function primaryVariantId(
  variants: readonly CvVariant[] | null | undefined,
): string | null {
  const flagged = orderVariantsForDisplay(activeVariants(variants)).find(
    (variant) => variant.is_primary,
  )
  return flagged?.id ?? null
}

/** Whether this variant is the one rendered as primary (AC7). */
export function isRenderedPrimary(
  variant: CvVariant,
  variants: readonly CvVariant[] | null | undefined,
): boolean {
  return primaryVariantId(variants) === variant.id
}

/** Whether a "make primary" control applies to this variant (AC7). */
export function canSetPrimary(
  variant: CvVariant,
  variants: readonly CvVariant[] | null | undefined,
): boolean {
  return !variant.is_archived && !isRenderedPrimary(variant, variants)
}

/**
 * The list with `variantId` as the only primary variant (AC7).
 *
 * Applied to the cached list the moment `POST .../primary` returns 200, so the
 * single badge moves on the response rather than on the refetch that follows it.
 * Every other variant is cleared, so the exactly-one invariant holds even if the
 * response omitted the previous primary.
 */
export function applyPrimary(
  variants: readonly CvVariant[] | null | undefined,
  variantId: string,
): readonly CvVariant[] {
  return (variants ?? []).map((variant) =>
    variant.is_primary === (variant.id === variantId)
      ? variant
      : { ...variant, is_primary: variant.id === variantId },
  )
}

/** The list with `updated` replacing the variant of the same identifier. */
export function replaceVariant(
  variants: readonly CvVariant[] | null | undefined,
  updated: CvVariant,
): readonly CvVariant[] {
  const current = variants ?? []
  return current.some((variant) => variant.id === updated.id)
    ? current.map((variant) => (variant.id === updated.id ? updated : variant))
    : [...current, updated]
}

// ── The create/edit draft (AC2, AC4) ──────────────────────────────────────────

/** The two editable members of a variant, as a form holds them. */
export interface VariantDraft {
  readonly name: string
  readonly description: string
}

/** An empty draft, for the create form. */
export const EMPTY_VARIANT_DRAFT: VariantDraft = { name: '', description: '' }

/**
 * The draft an edit form opens with.
 *
 * Both members are read through `textForDisplay`, so an absent description
 * becomes the empty string the input needs and Arabic or Hebrew text is carried
 * across byte-identically (Req 19 AC10).
 */
export function draftFromVariant(variant: CvVariant | null | undefined): VariantDraft {
  if (variant == null) {
    return EMPTY_VARIANT_DRAFT
  }
  return {
    name: textForDisplay(variant.name),
    description: textForDisplay(variant.description),
  }
}

/**
 * The description as the Backend_Api member: the entered text, or `null` when the
 * input was left empty.
 *
 * Not trimmed and not otherwise rewritten — Requirement 19 AC11 requires the
 * submitted value to be byte-identical to the entered one.
 */
function descriptionMember(description: string): string | null {
  return description === '' ? null : description
}

/** Applies the name and description bounds of AC2 to a draft. */
export function validateVariantDraft(draft: VariantDraft): ValidationIssue[] {
  return validateSchema(SCHEMAS.cvVariant, {
    name: draft.name,
    description: descriptionMember(draft.description),
  })
}

/** The `POST /me/cv-variants` body for a draft (AC2). */
export function createBodyFrom(draft: VariantDraft): CreateVariantBody {
  const description = descriptionMember(draft.description)
  return description === null ? { name: draft.name } : { name: draft.name, description }
}

/**
 * The `PATCH /me/cv-variants/{variant_id}` body for an edited draft: the changed
 * name or description, and nothing else (AC4).
 *
 * An unchanged member is omitted rather than sent with its current value, so the
 * request states what the Candidate actually changed. Comparison is exact — no
 * trimming or case folding — because an edit that only adds a space is still an
 * edit the Candidate made.
 */
export function changedVariantFields(variant: CvVariant, draft: VariantDraft): UpdateVariantBody {
  const body: { name?: string; description?: string | null } = {}
  if (draft.name !== textForDisplay(variant.name)) {
    body.name = draft.name
  }
  if (draft.description !== textForDisplay(variant.description)) {
    body.description = descriptionMember(draft.description)
  }
  return body
}

/** Whether an edited draft differs from the variant it was opened from (AC4). */
export function hasVariantChanges(variant: CvVariant, draft: VariantDraft): boolean {
  return Object.keys(changedVariantFields(variant, draft)).length > 0
}
