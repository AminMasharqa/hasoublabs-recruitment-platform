/**
 * The Senior profile form model: the values the editor holds, how they map to and
 * from the Backend_Api representation, and the rules applied before a save.
 *
 * Requirement 10 fixes all of it — AC2 the three editable scalars, AC3 the
 * Contact_Channel_Preference set, AC4/AC5 when the Contact_Scope_Preference
 * control exists and when its member is sent at all, AC6/AC7 the two conditional
 * requirements, AC8 the 1–10 expertise editor and AC9 what a save carries.
 *
 * ## Why the scope preference is nullable in the form and conditional in the body
 *
 * AC5 is a statement about the *request*: while the channel is `None` the member
 * is omitted, not sent as `null`. So the form holds `contact_scope_pref: null` for
 * "nothing chosen yet" and {@link toSeniorUpdateRequest} decides — from the
 * channel alone — whether the member appears. The control's visibility
 * ({@link showsContactScope}) is driven by the same predicate, so a hidden control
 * and an omitted member cannot disagree.
 *
 * ## Why a blank optional scalar is sent as an empty string, not as `null`
 *
 * `PUT /api/v1/me/senior-profile` treats an absent or `null` member as "leave this
 * alone" — it only applies members it actually received. Sending `null` for a
 * company affiliation the Senior just cleared would therefore silently keep the
 * old value. An empty string *is* received, so it clears. `full_name` is the
 * exception: the contract declares it `min_length=1`, so a blank name is reported
 * as a client-side violation and no request is issued.
 *
 * ## Why an empty expertise list is omitted
 *
 * The Backend_Api accepts between 1 and 10 expertise skills whenever the member is
 * present — an empty list is refused, not read as "remove them all". AC8 describes
 * the same 1-to-10 editor. So an empty editor omits the member rather than
 * sending a list the Backend_Api would reject, and the saved skills stay as they
 * were.
 *
 * Pure: no React, no i18n, no I/O.
 */

import type { ContactChannelPref, ContactScopePref } from '../../../api/enums'
import type { components } from '../../../api/generated/schema'
import type { RenderedInput } from '../../../forms/violations'
import {
  BOUNDS,
  CONTACT_CHANNEL_PREF_VALUES,
  CONTACT_SCOPE_PREF_VALUES,
  SCHEMAS,
  validateSchema,
  type FieldSchema,
  type ValidationIssue,
} from '../../../forms/validators'

// ── Contract shapes ───────────────────────────────────────────────────────────

/** `GET /api/v1/me/senior-profile` and the Admin view (Req 10 AC1, AC12). */
export type SeniorProfile = components['schemas']['SeniorProfileDTO']

/** `PUT /api/v1/me/senior-profile` request body (Req 10 AC9). */
export type SeniorProfileUpdate = components['schemas']['SeniorProfileUpdateRequest']

// ── Form values ───────────────────────────────────────────────────────────────

/** Everything the editor holds (AC2–AC4, AC8). */
export interface SeniorProfileFormValues {
  readonly full_name: string
  readonly company_affiliation: string
  readonly job_title: string
  /** AC3: exactly one of `Chat`, `Email`, `Both`, `None`. */
  readonly contact_channel_pref: ContactChannelPref
  /**
   * AC4: required while the channel is not `None`; `null` means nothing has been
   * chosen yet, which is a reportable violation rather than a silent default.
   */
  readonly contact_scope_pref: ContactScopePref | null
  /** AC8: 1 to 10 expertise skill terms, held verbatim as typed. */
  readonly expertise_skills: readonly string[]
}

/** The Contact_Channel_Preference that means "do not contact me" (AC5). */
export const NO_CONTACT_CHANNEL: ContactChannelPref = 'None'

/** The preference a profile the Backend_Api has not filled in yet reports. */
export const DEFAULT_CONTACT_CHANNEL_PREF: ContactChannelPref = NO_CONTACT_CHANNEL

/** Bounds of the expertise editor (AC8). */
export const EXPERTISE_LIMITS = Object.freeze({
  minItems: BOUNDS.seniorProfile.expertiseSkills.minItems,
  maxItems: BOUNDS.seniorProfile.expertiseSkills.maxItems,
})

/** The collection member name, as both sides of the wire spell it. */
export const EXPERTISE_COLLECTION = 'expertise_skills'

/** An empty form, for a profile that carries nothing yet. */
export function emptySeniorFormValues(): SeniorProfileFormValues {
  return {
    full_name: '',
    company_affiliation: '',
    job_title: '',
    contact_channel_pref: DEFAULT_CONTACT_CHANNEL_PREF,
    contact_scope_pref: null,
    expertise_skills: [],
  }
}

function text(value: string | null | undefined): string {
  return value ?? ''
}

function toChannelPref(value: unknown): ContactChannelPref {
  return CONTACT_CHANNEL_PREF_VALUES.includes(value) ? value : DEFAULT_CONTACT_CHANNEL_PREF
}

function toScopePref(value: unknown): ContactScopePref | null {
  return CONTACT_SCOPE_PREF_VALUES.includes(value) ? value : null
}

/**
 * Loads a Backend_Api profile into the form (AC1).
 *
 * Every value is carried across verbatim — no trimming, no case folding, no
 * normalization — so a profile that round-trips through the editor unchanged
 * submits the same bytes it arrived as (Req 19 AC10, AC11).
 */
export function toSeniorFormValues(
  profile: SeniorProfile | null | undefined,
): SeniorProfileFormValues {
  if (profile == null) {
    return emptySeniorFormValues()
  }
  return {
    full_name: text(profile.full_name),
    company_affiliation: text(profile.company_affiliation),
    job_title: text(profile.job_title),
    contact_channel_pref: toChannelPref(profile.contact_channel_pref),
    contact_scope_pref: toScopePref(profile.contact_scope_pref),
    expertise_skills: profile.expertise_skills.map((term) => text(term)),
  }
}

// ── What the preference implies ───────────────────────────────────────────────

/** Whether the Contact_Scope_Preference control is presented (AC4, AC5). */
export function showsContactScope(channel: ContactChannelPref): boolean {
  return channel !== NO_CONTACT_CHANNEL
}

/**
 * Whether a non-empty company affiliation is required before a save (AC6).
 *
 * Scoped to `SameCompany`, which is what AC6 states. The Backend_Api applies a
 * broader rule — it requires a company affiliation for *any* contactable channel —
 * and that rule stays where it is: it arrives as a Field_Violation on
 * `company_affiliation` and is placed on the input like any other (Req 22 AC12).
 */
export function requiresCompanyAffiliation(values: SeniorProfileFormValues): boolean {
  return showsContactScope(values.contact_channel_pref) && values.contact_scope_pref === 'SameCompany'
}

/** Whether at least one expertise skill is required before a save (AC7). */
export function requiresExpertiseSkill(values: SeniorProfileFormValues): boolean {
  return (
    showsContactScope(values.contact_channel_pref) &&
    values.contact_scope_pref === 'FieldOfExpertise'
  )
}

/** Whether the account email address is presented as the contact address (AC10). */
export function showsEmailContact(channel: ContactChannelPref): boolean {
  return channel === 'Email' || channel === 'Both'
}

/** Whether the "chat contact not yet available" text takes the place of a chat action (AC11). */
export function showsChatPlaceholder(channel: ContactChannelPref): boolean {
  return channel === 'Chat' || channel === 'Both'
}

// ── Form values → request body ────────────────────────────────────────────────

function trimmed(value: string): string {
  return value.trim()
}

/**
 * Builds the `PUT /api/v1/me/senior-profile` body (AC9).
 *
 * Carries every edited field, with two contract-driven exceptions documented at
 * the top of this module: the Contact_Scope_Preference member is omitted while the
 * channel is `None` (AC5), and an empty expertise list is omitted rather than sent
 * as `[]`.
 */
export function toSeniorUpdateRequest(values: SeniorProfileFormValues): SeniorProfileUpdate {
  const fullName = trimmed(values.full_name)
  const skills = values.expertise_skills.map(trimmed)
  return {
    // `min_length=1` in the contract: a blank name is "unchanged", and the
    // client-side rule below stops the save before it gets here.
    full_name: fullName === '' ? null : fullName,
    // An empty string is received and therefore clears; `null` would not.
    company_affiliation: trimmed(values.company_affiliation),
    job_title: trimmed(values.job_title),
    contact_channel_pref: values.contact_channel_pref,
    // AC5: omitted entirely while the channel is `None`.
    ...(showsContactScope(values.contact_channel_pref) && values.contact_scope_pref !== null
      ? { contact_scope_pref: values.contact_scope_pref }
      : {}),
    ...(skills.length === 0 ? {} : { expertise_skills: skills }),
  }
}

// ── Client-side rules ─────────────────────────────────────────────────────────

/** Path of the Contact_Scope_Preference input, as both sides spell it (AC4). */
export const CONTACT_SCOPE_PATH = 'contact_scope_pref'

/** Path of the company-affiliation input, as both sides spell it (AC6). */
export const COMPANY_AFFILIATION_PATH = 'company_affiliation'

/**
 * The Form_Validator schema of this body.
 *
 * The shared schema with `full_name` promoted to required: the contract declares
 * it `min_length=1`, so a blank name is a violation rather than a member the
 * Backend_Api would quietly ignore.
 */
const SENIOR_PROFILE_SCHEMA: FieldSchema = {
  ...SCHEMAS.seniorProfile,
  full_name: { ...SCHEMAS.seniorProfile.full_name, required: true },
}

/**
 * Applies every rule that bears on this form (Req 10 AC4, AC6, AC7, Req 22 AC1).
 *
 * Runs against the *request* shape, so the paths it reports are the paths the
 * Backend_Api reports for the same body — `contact_scope_pref`,
 * `company_affiliation`, `expertise_skills.0` — and one rendering path places
 * issues from either side.
 *
 * The three conditional rules are expressed here rather than in the schema
 * because each one depends on another field's value: the scope requirement on the
 * channel (AC4), the company requirement and the expertise requirement on the
 * chosen scope (AC6, AC7).
 */
export function validateSeniorProfileForm(
  values: SeniorProfileFormValues,
): readonly ValidationIssue[] {
  const request = toSeniorUpdateRequest(values)
  const issues: ValidationIssue[] = [
    ...validateSchema(SENIOR_PROFILE_SCHEMA, { ...request }),
  ]

  // AC4: a contactable channel requires a scope.
  if (showsContactScope(values.contact_channel_pref) && values.contact_scope_pref === null) {
    issues.push({
      path: CONTACT_SCOPE_PATH,
      code: 'required',
      messageKey: 'validation.required',
    })
  }

  // AC6: `SameCompany` requires a company affiliation.
  if (requiresCompanyAffiliation(values) && trimmed(values.company_affiliation) === '') {
    issues.push({
      path: COMPANY_AFFILIATION_PATH,
      code: 'required',
      messageKey: 'validation.required',
    })
  }

  // AC7: `FieldOfExpertise` requires at least one expertise skill.
  const skills = values.expertise_skills.filter((term) => trimmed(term) !== '')
  if (requiresExpertiseSkill(values) && skills.length < EXPERTISE_LIMITS.minItems) {
    issues.push({
      path: EXPERTISE_COLLECTION,
      code: 'too_few_items',
      messageKey: 'validation.tooFewItems',
      params: { minItems: EXPERTISE_LIMITS.minItems, actual: skills.length },
    })
  }

  return issues
}

// ── Rendered-input registry ───────────────────────────────────────────────────

/** Core-field paths, in the order the editor renders them (AC2). */
export const SENIOR_CORE_FIELD_PATHS = Object.freeze([
  'full_name',
  COMPANY_AFFILIATION_PATH,
  'job_title',
] as const)

/** Path of the Contact_Channel_Preference control (AC3). */
export const CONTACT_CHANNEL_PATH = 'contact_channel_pref'

/** Canonical path of one expertise-skill input. */
export function expertiseFieldPath(index: number): string {
  return `${EXPERTISE_COLLECTION}.${index}`
}

/**
 * The inputs the editor currently renders, in rendering order (Req 22 AC9, AC10).
 *
 * Two facts about this list carry requirements of their own:
 *
 * - the Contact_Scope_Preference input is registered only while it is *presented*
 *   (AC5), so a violation reported against it while the channel is `None` goes to
 *   the form-level region rather than onto a control the Senior cannot see;
 * - the first expertise input also claims the bare `expertise_skills` path, so the
 *   count violation of AC7 — reported against the collection, not an entry — lands
 *   on a visible input whenever there is one.
 */
export function renderedSeniorInputs(
  values: SeniorProfileFormValues,
): readonly RenderedInput[] {
  const inputs: RenderedInput[] = SENIOR_CORE_FIELD_PATHS.map((path) => ({ path }))
  inputs.push({ path: CONTACT_CHANNEL_PATH })
  if (showsContactScope(values.contact_channel_pref)) {
    inputs.push({ path: CONTACT_SCOPE_PATH })
  }
  values.expertise_skills.forEach((_term, index) => {
    const path = expertiseFieldPath(index)
    inputs.push(index === 0 ? { path, aliases: [EXPERTISE_COLLECTION] } : { path })
  })
  return inputs
}

// ── Editing the expertise collection ──────────────────────────────────────────

/** Whether another expertise skill may be added (AC8). */
export function canAddExpertiseSkill(values: SeniorProfileFormValues): boolean {
  return values.expertise_skills.length < EXPERTISE_LIMITS.maxItems
}

/**
 * Appends a blank expertise skill (AC8).
 *
 * At the bound the values are returned unchanged: the add control is already
 * disabled there, and a row past the bound is one the Backend_Api refuses.
 */
export function addExpertiseSkill(values: SeniorProfileFormValues): SeniorProfileFormValues {
  if (!canAddExpertiseSkill(values)) {
    return values
  }
  return { ...values, expertise_skills: [...values.expertise_skills, ''] }
}

/** Replaces one expertise term, keeping every other entered value. */
export function replaceExpertiseSkill(
  values: SeniorProfileFormValues,
  index: number,
  term: string,
): SeniorProfileFormValues {
  if (index < 0 || index >= values.expertise_skills.length) {
    return values
  }
  return {
    ...values,
    expertise_skills: values.expertise_skills.map((current, position) =>
      position === index ? term : current,
    ),
  }
}

/** Drops one expertise term, keeping every other entered value. */
export function removeExpertiseSkill(
  values: SeniorProfileFormValues,
  index: number,
): SeniorProfileFormValues {
  if (index < 0 || index >= values.expertise_skills.length) {
    return values
  }
  return {
    ...values,
    expertise_skills: values.expertise_skills.filter((_term, position) => position !== index),
  }
}
