/**
 * The registration form's values, validation, request body and input registry —
 * all of it pure (Requirement 6 AC2, AC4, AC5, AC6, AC7, AC14).
 *
 * The form component owns the state and the markup; everything that can be
 * decided without a DOM lives here so it can be pinned by unit tests:
 *
 * - {@link RegistrationFormValues} — what the form collects (AC4), keyed by the
 *   contract member names so a Field_Violation `path` and a rendered input id
 *   address the same thing without a translation table (AC14).
 * - {@link toRegistrationRequest} — the request body, composed from the values
 *   plus the two members the user never sees: the `role` the validated
 *   Registration_Link named and the `link_token` from the address (AC6, AC7).
 * - {@link registrationEndpoint} — which of the two registration operations that
 *   role submits to (AC6, AC7).
 * - {@link renderedRegistrationInputs} — the rendered-input registry the
 *   Field_Violation mapper partitions against (AC14).
 * - {@link validateRegistrationValues} — the Form_Validator bounds, applied to
 *   the *composed* body rather than to the raw values, because the composed body
 *   is what the Backend_Api validates.
 *
 * ## The role is not a form value
 *
 * {@link RegistrationFormValues} has no `role` member and no way to hold one. The
 * role arrives as a separate {@link RegistrationTarget} carrying the
 * {@link SelfRegistrationRole} the link named, and it is that value — not
 * anything the user could type, select or tamper with — that both
 * {@link toRegistrationRequest} and {@link registrationEndpoint} read. A role
 * control is therefore not merely absent from the markup (AC2): there is nowhere
 * for one to put its value.
 */

import type { ResidencyProofType } from '../../api/enums'
import type { components } from '../../api/generated/schema'
import type { RenderedInput } from '../../forms/violations'
import {
  RESIDENCY_PROOF_TYPE_VALUES,
  SCHEMAS,
  validateSchema,
  type ValidationIssue,
} from '../../forms/validators'
import type { Locale } from '../../lib/locale'

import {
  ADDRESS_PROOF_PARTS,
  EMPTY_ADDRESS_PROOF_PARTS,
  isAddressProof,
  residencyProofValue,
  type AddressProofParts,
} from './residencyProof'
import type { SelfRegistrationRole } from './registrationLink'

/** The self-registration request body, exactly as the contract declares it. */
export type RegistrationRequest = components['schemas']['RegistrationRequest']

/** The two registration operations, one per self-registerable role (AC6, AC7). */
export const REGISTRATION_PATHS = Object.freeze({
  CANDIDATE: '/api/v1/register/candidate',
  SENIOR: '/api/v1/register/senior',
} as const)

/** The contract path one role's registration is submitted to. */
export type RegistrationPath = (typeof REGISTRATION_PATHS)[SelfRegistrationRole]

/** What the validated Registration_Link fixes about the submission (AC2). */
export interface RegistrationTarget {
  /** The role the link named; the form offers no way to change it. */
  readonly role: SelfRegistrationRole
  /** The token from the address, submitted as `link_token` (AC6, AC7). */
  readonly token: string
}

/**
 * Everything the form collects (AC4).
 *
 * The Residency_Proof is held twice on purpose: `residency_proof_value` is the
 * single value a `MobilePhone` or `NationalId` proof is typed into, and
 * `residency_address` holds the four parts an `Address` proof is collected in
 * (AC5). Keeping both means switching the type back and forth does not discard
 * what was already entered, which Requirement 6 AC14's "retain every other value"
 * expectation also applies to.
 */
export interface RegistrationFormValues {
  readonly full_name: string
  readonly email: string
  readonly password: string
  readonly language_preference: Locale
  readonly residency_proof_type: ResidencyProofType
  /** The single value of a `MobilePhone` or `NationalId` proof. */
  readonly residency_proof_value: string
  /** The separately collected parts of an `Address` proof (AC5). */
  readonly residency_address: AddressProofParts
}

/** Path prefix the `Address` parts are rendered and addressed under. */
export const ADDRESS_PATH_PREFIX = 'residency_address'

/** The rendered-input path of one collected `Address` part. */
export function addressPartPath(part: keyof AddressProofParts): string {
  return `${ADDRESS_PATH_PREFIX}.${part}`
}

/**
 * The values the form starts with.
 *
 * `language_preference` defaults to the Locale the screen is already being read
 * in — the user is answering in it, so it is the best available guess — and stays
 * editable (AC4). The Residency_Proof type defaults to the first declared member
 * so the type control never starts empty.
 */
export function initialRegistrationValues(locale: Locale): RegistrationFormValues {
  return {
    full_name: '',
    email: '',
    password: '',
    language_preference: locale,
    residency_proof_type: RESIDENCY_PROOF_TYPE_VALUES.values[0] ?? 'MobilePhone',
    residency_proof_value: '',
    residency_address: EMPTY_ADDRESS_PROOF_PARTS,
  }
}

/** The `residency_proof_value` these values submit (AC5). */
export function composedResidencyProofValue(values: RegistrationFormValues): string {
  return residencyProofValue(values.residency_proof_type, {
    value: values.residency_proof_value,
    address: values.residency_address,
  })
}

/**
 * The request body (AC6, AC7).
 *
 * The role and the token come from {@link RegistrationTarget}, the
 * Residency_Proof value is composed, and the free-text fields are trimmed of
 * surrounding whitespace — trimming only, so nothing inside an Arabic or Hebrew
 * value is rewritten (Requirement 19 AC10).
 */
export function toRegistrationRequest(
  values: RegistrationFormValues,
  target: RegistrationTarget,
): RegistrationRequest {
  return {
    role: target.role,
    link_token: target.token,
    full_name: values.full_name.trim(),
    email: values.email.trim(),
    // Not trimmed: leading and trailing whitespace is part of a password.
    password: values.password,
    language_preference: values.language_preference,
    residency_proof_type: values.residency_proof_type,
    residency_proof_value: composedResidencyProofValue(values),
  }
}

/** The contract path a role's registration is submitted to (AC6, AC7). */
export function registrationEndpoint(role: SelfRegistrationRole): RegistrationPath {
  return REGISTRATION_PATHS[role]
}

/**
 * The inputs the form renders, in rendering order (AC14).
 *
 * The order matters twice: the Field_Violation mapper reports affected inputs in
 * it, and focus moves to the first of those (Requirement 20 AC6), so it has to be
 * the order a person actually reads.
 *
 * For an `Address` proof the street input additionally claims
 * `residency_proof_value` as an alias: the Backend_Api validates the one composed
 * string and addresses its violation at that path, and the first of the four
 * parts is where a person starts correcting it.
 */
export function renderedRegistrationInputs(
  type: ResidencyProofType,
): readonly RenderedInput[] {
  const identity: readonly RenderedInput[] = [
    { path: 'full_name' },
    { path: 'email' },
    { path: 'password' },
    { path: 'language_preference' },
    { path: 'residency_proof_type' },
  ]
  if (!isAddressProof(type)) {
    return [...identity, { path: 'residency_proof_value' }]
  }
  return [
    ...identity,
    ...ADDRESS_PROOF_PARTS.map((part, index) => ({
      path: addressPartPath(part),
      // The composed value's violations land on the first part.
      ...(index === 0 ? { aliases: ['residency_proof_value'] } : {}),
    })),
  ]
}

/** The `Address` parts that must carry a value before the form is submitted. */
const REQUIRED_ADDRESS_PARTS: readonly (keyof AddressProofParts)[] = Object.freeze([
  'street',
  'city',
  'country',
])

/**
 * Applies the Backend_Api bounds to the composed body.
 *
 * `SCHEMAS.registration` is the mirror of the Pydantic model, so the rules are
 * the declared ones rather than a second opinion: the `role` and `link_token`
 * members are validated too, and a violation of either addresses no rendered
 * input and is therefore placed in the form-level region (Requirement 22 AC10) —
 * which is the right outcome, since a bad token is a bad link, not a mistyped
 * field.
 *
 * Three `Address` parts are additionally required when that proof type is
 * selected. The Backend_Api only ever sees the composed string, so without this
 * a half-filled address would compose into something that satisfies the declared
 * bound; naming the empty part is more use than reporting the composition.
 * The building number is not required — plenty of addresses have none.
 *
 * The Backend_Api remains the authoritative validator (Requirement 22 AC12):
 * everything that passes here is still submitted and still judged there.
 */
export function validateRegistrationValues(
  values: RegistrationFormValues,
  target: RegistrationTarget,
): readonly ValidationIssue[] {
  const body = toRegistrationRequest(values, target)
  const issues: ValidationIssue[] = [
    ...validateSchema(SCHEMAS.registration, { ...body }),
  ]
  if (isAddressProof(values.residency_proof_type)) {
    for (const part of REQUIRED_ADDRESS_PARTS) {
      if (values.residency_address[part].trim() === '') {
        issues.push({
          path: addressPartPath(part),
          code: 'required',
          messageKey: 'validation.required',
        })
      }
    }
  }
  return issues
}
