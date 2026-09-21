/**
 * The CV_Variant selection the apply control presents (Requirement 14 AC2).
 *
 * AC2 asks for a selection that *defaults to the primary CV_Variant*, and both
 * halves of that already exist in the CV slice: `activeVariants` knows which
 * variants can still be applied with, and `primaryVariantId` resolves the list to
 * the single variant rendered as primary (Requirement 11 AC7). This module composes
 * the two into the option list and the default the dialog opens with, so the apply
 * flow restates neither rule.
 *
 * Imported from `features/cvs/variantRules` directly rather than through the slice's
 * barrel: the only thing the apply flow needs from the CV slice is these two pure
 * predicates, and reaching for the barrel would also pull the upload, download and
 * scan-polling machinery into the dialog's module graph.
 *
 * Pure: no React, no Api_Client.
 *
 * Requirements: 14.2.
 */

import {
  activeVariants,
  orderVariantsForDisplay,
  primaryVariantId,
  type CvVariant,
} from '../cvs/variantRules'

/** One selectable CV_Variant. */
export interface VariantChoice {
  readonly id: string
  readonly name: string
  /** Whether this is the primary variant, i.e. the default of AC2. */
  readonly isPrimary: boolean
}

/**
 * The selectable CV_Variants, in the CV screen's listing order (AC2).
 *
 * Archived variants are excluded: they cannot be applied with, and offering one
 * would produce a submission the Backend_Api refuses. The order is the one the CV
 * screen uses, so the Candidate recognizes the list they curated.
 */
export function variantChoices(
  variants: readonly CvVariant[] | null | undefined,
): readonly VariantChoice[] {
  const primary = primaryVariantId(variants)
  return orderVariantsForDisplay(activeVariants(variants)).map((variant) => ({
    id: variant.id,
    name: variant.name,
    isPrimary: variant.id === primary,
  }))
}

/**
 * The CV_Variant the selection opens on: the primary one (AC2).
 *
 * Falls back to the first selectable variant when no active variant carries the
 * primary designation, and to `null` when there is nothing to select — the dialog
 * then says so rather than submitting a variant that does not exist. A `null`
 * selection is also a legitimate submission: the contract resolves the primary
 * variant itself when the body names none, which is the same variant this default
 * would have named.
 */
export function defaultVariantChoice(
  variants: readonly CvVariant[] | null | undefined,
): string | null {
  const choices = variantChoices(variants)
  const primary = choices.find((choice) => choice.isPrimary)
  return primary?.id ?? choices[0]?.id ?? null
}

/**
 * Keeps a selection valid against the loaded list.
 *
 * Returns the selection when it still names a selectable variant, and the default
 * otherwise — which covers the variant list arriving after the dialog opened, and a
 * variant being archived in another tab between two reads.
 */
export function resolveVariantSelection(
  variants: readonly CvVariant[] | null | undefined,
  selected: string | null,
): string | null {
  if (selected !== null && variantChoices(variants).some((choice) => choice.id === selected)) {
    return selected
  }
  return defaultVariantChoice(variants)
}
