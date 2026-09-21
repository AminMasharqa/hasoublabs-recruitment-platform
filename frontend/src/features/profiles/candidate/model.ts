/**
 * The Candidate profile form model: the values the editor holds, how they map to
 * and from the Backend_Api representation, and the rules applied before a save.
 *
 * Requirement 9 AC2–AC6 fix what is editable — six core fields plus four
 * repeatable collections with their bounds — and AC8 fixes what is sent: every
 * edited field and every sub-collection present in the form. AC11 fixes what must
 * survive a rejection: everything the user typed.
 *
 * ## Why every scalar in the form is a string
 *
 * A year input holding `number | null` cannot represent "the user has typed `19`
 * so far", and a `start_year` that silently becomes `19` — or worse, `null` —
 * while being typed is exactly how entered values get lost. So the form holds
 * text, {@link toUpdateRequest} performs the one conversion to the request shape,
 * and {@link validateCandidateProfileForm} validates *that* shape. The
 * consequence is the one AC11 wants: a 422 changes no form value, because the
 * values were never derived from the request in the first place.
 *
 * ## Why the rendered-input registry is derived from the values
 *
 * The 422 mapper places a violation on an input by path, and the indexed paths
 * that exist depend on how many entries the user currently has
 * ({@link renderedInputs}). Deriving the registry from the values means an
 * indexed violation — `education[2].start_date` — can only fail to find its input
 * if entry 2 genuinely is not rendered, in which case AC10 of Requirement 22 puts
 * it in the form-level region rather than dropping it.
 *
 * Pure: no React, no i18n, no I/O.
 */

import type { components } from '../../../api/generated/schema'
import type { EnrolmentStatus } from '../../../api/enums'
import type { RenderedInput } from '../../../forms/violations'
import {
  BOUNDS,
  PROFICIENCY_VALUES,
  SCHEMAS,
  validateCandidateProfile,
  validateSchema,
  type ValidationIssue,
} from '../../../forms/validators'

// ── Contract shapes ───────────────────────────────────────────────────────────

/** `GET /api/v1/me/profile` and the Admin view (Req 9 AC1, AC14). */
export type CandidateProfile = components['schemas']['CandidateProfileDTO']

/** `PUT /api/v1/me/profile` request body (Req 9 AC8). */
export type CandidateProfileUpdate = components['schemas']['CandidateProfileUpdateRequest']

/** Language proficiency, as the Backend_Api constant declares it (Req 9 AC6). */
export type Proficiency = (typeof PROFICIENCY_VALUES.values)[number]

// ── Form values ───────────────────────────────────────────────────────────────

/** One education row as the editor holds it (AC3). */
export interface EducationFormEntry {
  readonly institution: string
  readonly degree: string
  readonly field_of_study: string
  readonly enrolment_status: EnrolmentStatus
  readonly start_year: string
  readonly end_year: string
}

/** One work-experience row as the editor holds it (AC4). */
export interface WorkFormEntry {
  readonly company: string
  readonly title: string
  readonly start_date: string
  readonly end_date: string
  readonly description: string
}

/** One skill row as the editor holds it (AC5). */
export interface SkillFormEntry {
  readonly term: string
  readonly years_experience: string
}

/** One language row as the editor holds it (AC6). */
export interface LanguageFormEntry {
  readonly language_code: string
  readonly proficiency: Proficiency
}

/** Everything the editor holds (AC2–AC6). */
export interface CandidateProfileFormValues {
  readonly full_name: string
  readonly email: string
  readonly phone: string
  readonly city: string
  readonly summary: string
  readonly linkedin_url: string
  readonly education: readonly EducationFormEntry[]
  readonly work_experience: readonly WorkFormEntry[]
  readonly skills: readonly SkillFormEntry[]
  readonly languages: readonly LanguageFormEntry[]
}

/** The collections the editor repeats, and the bound each one carries. */
export const COLLECTION_LIMITS = Object.freeze({
  education: BOUNDS.candidateProfile.education.maxItems,
  work_experience: BOUNDS.candidateProfile.workExperience.maxItems,
  skills: BOUNDS.candidateProfile.skills.maxItems,
  languages: BOUNDS.candidateProfile.languages.maxItems,
})

/** Name of one repeatable collection. */
export type CollectionName = keyof typeof COLLECTION_LIMITS

/** The default enrolment status of a freshly added education row. */
export const DEFAULT_ENROLMENT_STATUS: EnrolmentStatus = 'Enrolled'

/** The default proficiency of a freshly added language row. */
export const DEFAULT_PROFICIENCY: Proficiency = 'Professional'

/** A blank education row. */
export function emptyEducationEntry(): EducationFormEntry {
  return {
    institution: '',
    degree: '',
    field_of_study: '',
    enrolment_status: DEFAULT_ENROLMENT_STATUS,
    start_year: '',
    end_year: '',
  }
}

/** A blank work-experience row. */
export function emptyWorkEntry(): WorkFormEntry {
  return { company: '', title: '', start_date: '', end_date: '', description: '' }
}

/** A blank skill row. */
export function emptySkillEntry(): SkillFormEntry {
  return { term: '', years_experience: '' }
}

/** A blank language row. */
export function emptyLanguageEntry(): LanguageFormEntry {
  return { language_code: '', proficiency: DEFAULT_PROFICIENCY }
}

/** An empty form, for the profile the Backend_Api has not created yet. */
export function emptyFormValues(): CandidateProfileFormValues {
  return {
    full_name: '',
    email: '',
    phone: '',
    city: '',
    summary: '',
    linkedin_url: '',
    education: [],
    work_experience: [],
    skills: [],
    languages: [],
  }
}

function text(value: string | null | undefined): string {
  return value ?? ''
}

function numberText(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value)
}

function toProficiency(value: string): Proficiency {
  return PROFICIENCY_VALUES.includes(value) ? value : DEFAULT_PROFICIENCY
}

/**
 * Loads a Backend_Api profile into the form (AC1).
 *
 * Every value is carried across verbatim — no trimming, no case folding, no
 * normalization — so a profile that round-trips through the editor unchanged
 * submits the same bytes it arrived as (Req 19 AC10, AC11).
 */
export function toFormValues(profile: CandidateProfile | null | undefined): CandidateProfileFormValues {
  if (profile == null) {
    return emptyFormValues()
  }
  return {
    full_name: text(profile.full_name),
    email: text(profile.email),
    phone: text(profile.phone),
    city: text(profile.city),
    summary: text(profile.summary),
    linkedin_url: text(profile.linkedin_url),
    education: profile.education.map((entry) => ({
      institution: text(entry.institution),
      degree: text(entry.degree),
      field_of_study: text(entry.field_of_study),
      enrolment_status: entry.enrolment_status,
      start_year: numberText(entry.start_year),
      end_year: numberText(entry.end_year),
    })),
    work_experience: profile.work_experience.map((entry) => ({
      company: text(entry.company),
      title: text(entry.title),
      start_date: text(entry.start_date),
      end_date: text(entry.end_date),
      description: text(entry.description),
    })),
    skills: profile.skills.map((entry) => ({
      term: text(entry.name),
      years_experience: numberText(entry.years_experience),
    })),
    languages: profile.languages.map((entry) => ({
      language_code: text(entry.language_code),
      proficiency: toProficiency(entry.proficiency),
    })),
  }
}

// ── Form values → request body ────────────────────────────────────────────────

/** A blank optional scalar is sent as `null`, which is how the field is cleared. */
function optionalText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Parses an integer input.
 *
 * `null` for a blank value — the field is simply not filled in — and `NaN` for a
 * value that is not an integer at all, which the validator reports rather than
 * this function silently discarding it.
 */
export function parseIntegerInput(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') {
    return null
  }
  return /^[+-]?\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN
}

/**
 * Builds the `PUT /api/v1/me/profile` body (AC8).
 *
 * Every core field and every sub-collection present in the form is sent, which is
 * what AC8 asks for and what makes a removed entry actually disappear: the
 * Backend_Api replaces each collection wholesale, so omitting `education` would
 * mean "leave it alone" rather than "it is now empty".
 */
export function toUpdateRequest(values: CandidateProfileFormValues): CandidateProfileUpdate {
  return {
    full_name: optionalText(values.full_name),
    email: optionalText(values.email),
    phone: optionalText(values.phone),
    city: optionalText(values.city),
    summary: optionalText(values.summary),
    linkedin_url: optionalText(values.linkedin_url),
    education: values.education.map((entry) => ({
      institution: entry.institution.trim(),
      degree: entry.degree.trim(),
      field_of_study: optionalText(entry.field_of_study),
      enrolment_status: entry.enrolment_status,
      start_year: parseIntegerInput(entry.start_year) as number,
      end_year: parseIntegerInput(entry.end_year),
    })),
    work_experience: values.work_experience.map((entry) => ({
      company: entry.company.trim(),
      title: entry.title.trim(),
      start_date: entry.start_date.trim(),
      end_date: optionalText(entry.end_date),
      description: optionalText(entry.description),
    })),
    skills: values.skills.map((entry) => ({
      term: entry.term.trim(),
      years_experience: parseIntegerInput(entry.years_experience),
    })),
    languages: values.languages.map((entry) => ({
      language_code: entry.language_code.trim(),
      proficiency: entry.proficiency,
    })),
  }
}

// ── Client-side rules ─────────────────────────────────────────────────────────

/**
 * Applies every Form_Validator rule that bears on this form (Req 22 AC1–AC6).
 *
 * Runs against the *request* shape, so the paths it reports are the paths the
 * Backend_Api would report for the same body — `education.2.end_year`,
 * `skills.0.term` — and one rendering path places issues from either side
 * (Req 9 AC11).
 *
 * `validateCandidateProfile` covers the scalars, the education and
 * work-experience entries and their end-not-before-start rule; the skill and
 * language entry schemas are applied here because the shared composite does not
 * descend into them.
 */
export function validateCandidateProfileForm(
  values: CandidateProfileFormValues,
): readonly ValidationIssue[] {
  const request = toUpdateRequest(values)
  const issues: ValidationIssue[] = [
    ...validateCandidateProfile({
      ...request,
      education: request.education ?? [],
      work_experience: request.work_experience ?? [],
    }),
  ]
  ;(request.skills ?? []).forEach((entry, index) => {
    issues.push(...validateSchema(SCHEMAS.skillEntry, { ...entry }, `skills.${index}`))
  })
  ;(request.languages ?? []).forEach((entry, index) => {
    issues.push(...validateSchema(SCHEMAS.languageEntry, { ...entry }, `languages.${index}`))
  })
  return issues
}

// ── Rendered-input registry ───────────────────────────────────────────────────

/** Core-field paths, in the order the editor renders them. */
export const CORE_FIELD_PATHS = Object.freeze([
  'full_name',
  'email',
  'phone',
  'city',
  'summary',
  'linkedin_url',
] as const)

/** Member paths of one education row, in rendering order. */
export const EDUCATION_FIELD_PATHS = Object.freeze([
  'institution',
  'degree',
  'field_of_study',
  'enrolment_status',
  'start_year',
  'end_year',
] as const)

/** Member paths of one work-experience row, in rendering order. */
export const WORK_FIELD_PATHS = Object.freeze([
  'company',
  'title',
  'start_date',
  'end_date',
  'description',
] as const)

/** Member paths of one skill row, in rendering order. */
export const SKILL_FIELD_PATHS = Object.freeze(['term', 'years_experience'] as const)

/** Member paths of one language row, in rendering order. */
export const LANGUAGE_FIELD_PATHS = Object.freeze(['language_code', 'proficiency'] as const)

function entryInputs(
  collection: CollectionName,
  count: number,
  members: readonly string[],
): RenderedInput[] {
  const inputs: RenderedInput[] = []
  for (let index = 0; index < count; index += 1) {
    for (const [position, member] of members.entries()) {
      const path = `${collection}.${index}.${member}`
      // The collection itself is claimed by the first member of its first row, so
      // a violation reported against the bare `education` path lands on an input
      // the user can see rather than in the form-level region. An empty
      // collection claims nothing, which is where that region is the right place.
      inputs.push(
        index === 0 && position === 0 ? { path, aliases: [collection] } : { path },
      )
    }
  }
  return inputs
}

/**
 * The inputs the editor currently renders, in rendering order (Req 22 AC9, AC10).
 *
 * Rendering order is what makes "the first affected input" of Req 20 AC6 the
 * first one a person reaches: core fields, then each education row's members in
 * order, then work, skills and languages.
 *
 * Each collection's first row also claims the bare collection path as an alias,
 * so a size or shape violation reported against `education` rather than against
 * an entry still lands on an input the user can see.
 */
export function renderedInputs(values: CandidateProfileFormValues): readonly RenderedInput[] {
  const inputs: RenderedInput[] = CORE_FIELD_PATHS.map((path) => ({ path }))
  inputs.push(...entryInputs('education', values.education.length, EDUCATION_FIELD_PATHS))
  inputs.push(...entryInputs('work_experience', values.work_experience.length, WORK_FIELD_PATHS))
  inputs.push(...entryInputs('skills', values.skills.length, SKILL_FIELD_PATHS))
  inputs.push(...entryInputs('languages', values.languages.length, LANGUAGE_FIELD_PATHS))
  return inputs
}

/** Whether another entry may be added to a collection (AC3–AC6). */
export function canAddEntry(values: CandidateProfileFormValues, collection: CollectionName): boolean {
  return values[collection].length < COLLECTION_LIMITS[collection]
}

// ── Editing the collections ───────────────────────────────────────────────────

/**
 * A copy of `list` with the entry at `index` replaced.
 *
 * Returns the list unchanged when `index` addresses nothing, so a stale callback
 * from a row that has just been removed cannot resurrect it.
 */
export function replaceAt<T>(list: readonly T[], index: number, next: T): readonly T[] {
  if (index < 0 || index >= list.length) {
    return list
  }
  return list.map((entry, position) => (position === index ? next : entry))
}

/** A copy of `list` without the entry at `index`. */
export function removeAt<T>(list: readonly T[], index: number): readonly T[] {
  if (index < 0 || index >= list.length) {
    return list
  }
  return list.filter((_entry, position) => position !== index)
}

/**
 * Appends a blank entry to a collection (AC3–AC6).
 *
 * At the bound the values are returned unchanged: the add control is already
 * disabled there, and silently exceeding the bound would only produce a row the
 * Backend_Api refuses. The switch is exhaustive over {@link CollectionName}, so
 * adding a fifth collection is a typecheck failure here rather than a row that
 * cannot be added.
 */
export function addEntry(
  values: CandidateProfileFormValues,
  collection: CollectionName,
): CandidateProfileFormValues {
  if (!canAddEntry(values, collection)) {
    return values
  }
  switch (collection) {
    case 'education':
      return { ...values, education: [...values.education, emptyEducationEntry()] }
    case 'work_experience':
      return { ...values, work_experience: [...values.work_experience, emptyWorkEntry()] }
    case 'skills':
      return { ...values, skills: [...values.skills, emptySkillEntry()] }
    case 'languages':
      return { ...values, languages: [...values.languages, emptyLanguageEntry()] }
  }
}

/** Drops one entry from a collection, keeping every other entered value. */
export function removeEntry(
  values: CandidateProfileFormValues,
  collection: CollectionName,
  index: number,
): CandidateProfileFormValues {
  switch (collection) {
    case 'education':
      return { ...values, education: removeAt(values.education, index) }
    case 'work_experience':
      return { ...values, work_experience: removeAt(values.work_experience, index) }
    case 'skills':
      return { ...values, skills: removeAt(values.skills, index) }
    case 'languages':
      return { ...values, languages: removeAt(values.languages, index) }
  }
}

/** The canonical path of one member of one collection entry. */
export function entryFieldPath(
  collection: CollectionName,
  index: number,
  member: string,
): string {
  return `${collection}.${index}.${member}`
}
