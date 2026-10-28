/**
 * Residency_Proof value composition (Requirement 6 AC4, AC5).
 *
 * The Backend_Api takes one `residency_proof_value` string whatever the
 * Residency_Proof type is. For `MobilePhone` and `NationalId` that is the single
 * value the user typed. For `Address`, Requirement 6 AC5 requires the street,
 * the house or building number, the city and the country to be *collected as
 * separate inputs*, which leaves the Web_Client to decide how the four parts
 * become the one string the contract declares.
 *
 * ## The composition format
 *
 * ```
 * «street» «number», «city», «country»
 * ```
 *
 * - the street and the number form one line, separated by a single space, because
 *   that is how a street line reads in every locale this application ships;
 * - the line, the city and the country are separated by `", "`, a separator that
 *   is direction-neutral and survives an Arabic or Hebrew address unchanged;
 * - every part is trimmed of surrounding whitespace and a part left blank is
 *   omitted together with its separator, so a missing building number never
 *   produces a dangling `", ,"`.
 *
 * Nothing else is done to the parts: no transliteration, no Unicode
 * normalization, no reordering (Requirement 19 AC10, AC11). The characters the
 * user typed are the characters submitted, which is why this is a plain join
 * rather than a formatter.
 *
 * The whole module is pure, so the format is pinned by unit tests rather than by
 * a screen, and the form only ever calls {@link residencyProofValue}.
 */

import type { ResidencyProofType } from '../../api/enums'

/** The Residency_Proof type whose value is collected as separate parts (AC5). */
export const ADDRESS_PROOF_TYPE: ResidencyProofType = 'Address'

/** The four inputs an `Address` Residency_Proof is collected in (AC5). */
export interface AddressProofParts {
  /** Street name. */
  readonly street: string
  /** House or building number. */
  readonly number: string
  readonly city: string
  readonly country: string
}

/** The parts in the order they are rendered and composed in. */
export const ADDRESS_PROOF_PARTS: readonly (keyof AddressProofParts)[] = Object.freeze([
  'street',
  'number',
  'city',
  'country',
])

/** One collected part of an `Address` Residency_Proof. */
export type AddressProofPart = keyof AddressProofParts

/** An unfilled address, the value the form starts with. */
export const EMPTY_ADDRESS_PROOF_PARTS: AddressProofParts = Object.freeze({
  street: '',
  number: '',
  city: '',
  country: '',
})

/** Separator between the street line, the city and the country. */
const PART_SEPARATOR = ', '

/** Separator between the street name and the building number. */
const STREET_LINE_SEPARATOR = ' '

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Joins the parts that carry a value, dropping the separator of a blank one. */
function join(separator: string, parts: readonly string[]): string {
  return parts.filter((part) => part !== '').join(separator)
}

/**
 * Whether a Residency_Proof type is the one collected as separate parts (AC5).
 *
 * Used by the form to decide which inputs to render, so the decision is made in
 * one place rather than compared against a literal at each call site.
 */
export function isAddressProof(type: unknown): boolean {
  return type === ADDRESS_PROOF_TYPE
}

/**
 * Composes the four collected parts into the single `residency_proof_value` the
 * contract declares (AC5).
 *
 * Yields `''` when every part is blank, which the Form_Validator then reports as
 * the required-value violation of `residency_proof_value` — the composed value is
 * the thing the Backend_Api validates, so it is also the thing the client checks.
 */
export function composeAddressProofValue(parts: AddressProofParts): string {
  const streetLine = join(STREET_LINE_SEPARATOR, [trimmed(parts.street), trimmed(parts.number)])
  return join(PART_SEPARATOR, [streetLine, trimmed(parts.city), trimmed(parts.country)])
}

/**
 * The `residency_proof_value` to submit for a selected Residency_Proof type
 * (AC4, AC5).
 *
 * `Address` composes the collected parts; every other type submits the single
 * value the user typed, trimmed of surrounding whitespace only.
 */
export function residencyProofValue(
  type: ResidencyProofType,
  values: { readonly value: string; readonly address: AddressProofParts },
): string {
  return isAddressProof(type) ? composeAddressProofValue(values.address) : trimmed(values.value)
}
