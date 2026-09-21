/**
 * Form_Validator — client-side mirrors of the Backend_Api Pydantic bounds.
 *
 * Requirement 22:
 * - AC1  every bound the Backend_Api declares per request body: min/max lengths,
 *        numeric ranges, collection sizes and enumerated value sets ({@link BOUNDS},
 *        {@link SCHEMAS}, the `*_VALUES` enum sets).
 * - AC2  password of at least 10 and at least up to 64 code points ({@link validatePassword}).
 * - AC3  password length counted in Unicode code points ({@link countCodePoints}).
 * - AC4  email per the RFC 5322 addr-spec form ({@link isAddrSpec}, {@link validateEmail}).
 * - AC5  LinkedIn URL: HTTPS, at most 200 characters ({@link validateLinkedInUrl}).
 * - AC6  education/work entry whose end precedes its start, naming the entry index
 *        ({@link validateDateOrder}, {@link validateEducationEntries},
 *        {@link validateWorkExperienceEntries}).
 * - AC7  Verification_Code and multi-factor code: exactly 6 digits ({@link validateSixDigitCode}).
 * - AC8  rating: integer 1–5 inclusive ({@link validateRating}).
 * - AC12 every rule here is an aid only — callers still submit to the Backend_Api,
 *        which remains the authoritative validator. Nothing in this module short-circuits
 *        a submission on its own.
 *
 * Every export is pure: no I/O, no locale lookup, no DOM. A rule reports a
 * {@link ValidationIssue} carrying a stable `code` plus an i18n `messageKey` and
 * `params`; the rendering layer resolves the catalogue entry so no user-visible
 * literal is embedded here (Requirement 19 AC2).
 *
 * Bounds are mirrored from the backend Pydantic schemas
 * (each module's `schemas.py`, `app/platform/security/password.py`,
 * `app/platform/db/enums.py`, `app/config.py`). The enum sets are keyed on the
 * unions re-exported from `src/api/enums.ts`, which are themselves projections of
 * the generated contract, so a contract change that renames, adds or drops a
 * member fails the typecheck here rather than at runtime.
 */

import type {
  ApplicationChannel,
  ApplicationStatus,
  ContactChannelPref,
  ContactScopePref,
  EmploymentType,
  EnrolmentStatus,
  ExperienceLevel,
  JdStatus,
  ResidencyProofType,
  Role,
  WorkModel,
} from '../api/enums'

// ── Issue shape ───────────────────────────────────────────────────────────────

/**
 * One failed client-side rule.
 *
 * `path` uses the same dotted/indexed form the Backend_Api uses for a
 * Field_Violation `path`, so client and server issues address the same input.
 */
export interface ValidationIssue {
  /** Dotted path of the offending input, e.g. `education.2.end_year`. */
  readonly path: string
  /** Stable machine code, mirroring the Backend_Api violation codes where one exists. */
  readonly code: string
  /** i18n catalogue key; the rendering layer resolves it against the active Locale. */
  readonly messageKey: string
  /** Interpolation values for the catalogue entry (bounds, entry index, …). */
  readonly params?: Readonly<Record<string, string | number>>
}

function issue(
  path: string,
  code: string,
  messageKey: string,
  params?: Readonly<Record<string, string | number>>,
): ValidationIssue {
  return params === undefined ? { path, code, messageKey } : { path, code, messageKey, params }
}

// ── Enumerated value sets (AC1) ───────────────────────────────────────────────

/** An enumerated value set with its declaration order preserved for select controls. */
export interface EnumValues<T extends string> {
  readonly values: readonly T[]
  /** Narrowing membership test. */
  includes(value: unknown): value is T
}

/**
 * Builds an {@link EnumValues} from an exhaustive member record.
 *
 * `Record<T, true>` forces every union member to be listed and rejects any member
 * the union does not contain, so drift against the generated contract is a
 * typecheck failure.
 */
export function enumValues<T extends string>(members: Record<T, true>): EnumValues<T> {
  const values = Object.keys(members) as T[]
  const set = new Set<string>(values)
  return {
    values,
    includes(value: unknown): value is T {
      return typeof value === 'string' && set.has(value)
    },
  }
}

/** Platform roles (R1 AC1). */
export const ROLE_VALUES = enumValues<Role>({
  ADMIN: true,
  CANDIDATE: true,
  SENIOR: true,
})

/**
 * Roles a registration link may carry (`RegistrationRequest.role`).
 *
 * The Backend_Api declares this field as a free string restricted to the two
 * self-registerable roles, so there is no named contract schema for the subset.
 * Deriving it as `Exclude<Role, 'ADMIN'>` still keys the set off the contract: a
 * renamed or dropped `Role` member changes what `Exclude` yields and the record
 * below stops being exhaustive.
 */
export const SELF_REGISTRATION_ROLE_VALUES = enumValues<Exclude<Role, 'ADMIN'>>({
  CANDIDATE: true,
  SENIOR: true,
})

/** Active role context of a dual-role account (`SwitchContextRequest.context`). */
export const ROLE_CONTEXT_VALUES = SELF_REGISTRATION_ROLE_VALUES

/**
 * Supported Locales (`RegistrationRequest.language_preference`).
 *
 * Declared as a bounded string by the Backend_Api rather than an enumeration, so
 * the contract carries no union to key off; the set is fixed by Requirement 19 AC1.
 */
export const LOCALE_VALUES = enumValues<'ar' | 'he' | 'en'>({ ar: true, he: true, en: true })

/** Residency proof kinds (`RegistrationRequest.residency_proof_type`, R2 AC2). */
export const RESIDENCY_PROOF_TYPE_VALUES = enumValues<ResidencyProofType>({
  MobilePhone: true,
  NationalId: true,
  Address: true,
})

/** Education enrolment status. */
export const ENROLMENT_STATUS_VALUES = enumValues<EnrolmentStatus>({
  Enrolled: true,
  Graduated: true,
})

/**
 * Language proficiency levels.
 *
 * `profiles.VALID_PROFICIENCIES` is a Backend_Api constant rather than an
 * enumeration, so the contract declares the field as a plain string and there is
 * no union to key off.
 */
export const PROFICIENCY_VALUES = enumValues<
  'Native' | 'Fluent' | 'Professional' | 'Conversational' | 'Basic'
>({ Native: true, Fluent: true, Professional: true, Conversational: true, Basic: true })

/** Senior contact-channel preference. */
export const CONTACT_CHANNEL_PREF_VALUES = enumValues<ContactChannelPref>({
  Chat: true,
  Email: true,
  Both: true,
  None: true,
})

/** Senior contact-scope preference. */
export const CONTACT_SCOPE_PREF_VALUES = enumValues<ContactScopePref>({
  OwnPostingsOnly: true,
  SameCompany: true,
  FieldOfExpertise: true,
})

/** Job_Description work model. */
export const WORK_MODEL_VALUES = enumValues<WorkModel>({
  Onsite: true,
  Hybrid: true,
  Remote: true,
})

/** Job_Description employment type. */
export const EMPLOYMENT_TYPE_VALUES = enumValues<EmploymentType>({
  'Full-time': true,
  'Part-time': true,
  Contract: true,
  Freelance: true,
  Internship: true,
})

/** Job_Description experience band. */
export const EXPERIENCE_LEVEL_VALUES = enumValues<ExperienceLevel>({
  'Junior-level': true,
  'Mid-level': true,
  'Senior-level': true,
  Lead: true,
})

/** Job_Description lifecycle status. */
export const JD_STATUS_VALUES = enumValues<JdStatus>({
  Draft: true,
  Open: true,
  Closed: true,
})

/** Application_Channel configured on a Job_Description. */
export const APPLICATION_CHANNEL_VALUES = enumValues<ApplicationChannel>({
  Senior_Dashboard: true,
  Admin_Dashboard: true,
  External_Careers_URL: true,
})

/** Application status. */
export const APPLICATION_STATUS_VALUES = enumValues<ApplicationStatus>({
  Submitted: true,
  'Under Review': true,
  'Forwarded to Recruiter': true,
  Closed: true,
})

/** Media types the CV upload input accepts (Req 11 AC8). */
export const CV_UPLOAD_MEDIA_TYPES: readonly string[] = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

// ── Bounds mirrored from the Pydantic schemas (AC1) ───────────────────────────

/** Inclusive length bounds counted in Unicode code points. */
export interface LengthBound {
  readonly minLength?: number
  readonly maxLength?: number
}

/** Inclusive numeric range. */
export interface RangeBound {
  readonly min?: number
  readonly max?: number
}

/** Inclusive collection-size bounds. */
export interface SizeBound {
  readonly minItems?: number
  readonly maxItems?: number
}

/**
 * The bounds the Backend_Api declares, grouped by request body.
 *
 * Kept as data so the schema layer, the feature forms and the property tests all
 * read the same numbers.
 */
export const BOUNDS = {
  /** `app/platform/security/password.py` + `settings.password_max_length`. */
  password: { minCodePoints: 10, maxCodePoints: 128 },
  /** A Verification_Code and a multi-factor code are both exactly six ASCII digits. */
  code: { length: 6 },
  /** `SubmitReviewRequest.rating_*`. */
  rating: { min: 1, max: 5 },
  /** Every keyset-paged list endpoint declares the same page-size range. */
  pageLimit: { min: 1, max: 100 },
  email: { maxLength: 255 },
  linkedinUrl: { maxLength: 200 },
  externalUrl: { maxLength: 500 },
  registration: {
    fullName: { minLength: 1, maxLength: 100 },
    languagePreference: { minLength: 2, maxLength: 5 },
    residencyProofValue: { minLength: 1, maxLength: 1000 },
    linkToken: { minLength: 1 },
  },
  admin: {
    /** Reject, suspend and deactivate all declare the same reason bounds. */
    reason: { minLength: 1, maxLength: 500 },
    roles: { minItems: 1 },
  },
  candidateProfile: {
    fullName: { minLength: 1, maxLength: 100 },
    phone: { maxLength: 30 },
    city: { maxLength: 100 },
    summary: { maxLength: 1000 },
    education: { maxItems: 20 },
    workExperience: { maxItems: 20 },
    skills: { maxItems: 20 },
    languages: { maxItems: 10 },
  },
  education: {
    institution: { minLength: 1, maxLength: 200 },
    degree: { minLength: 1, maxLength: 100 },
    fieldOfStudy: { maxLength: 100 },
    year: { min: 1900, max: 2100 },
  },
  workExperience: {
    company: { minLength: 1, maxLength: 200 },
    title: { minLength: 1, maxLength: 100 },
    description: { maxLength: 2000 },
  },
  skill: {
    term: { minLength: 1, maxLength: 100 },
    yearsExperience: { min: 0, max: 50 },
  },
  language: {
    languageCode: { minLength: 2, maxLength: 10 },
  },
  seniorProfile: {
    fullName: { minLength: 1, maxLength: 100 },
    companyAffiliation: { maxLength: 200 },
    jobTitle: { maxLength: 100 },
    /** At least one expertise skill is required once a Contact_Channel_Preference is set. */
    expertiseSkills: { minItems: 1, maxItems: 10 },
  },
  cv: {
    variantName: { minLength: 1, maxLength: 100 },
    variantDescription: { maxLength: 300 },
    maxVariants: 5,
    maxUploadBytes: 10 * 1024 * 1024,
  },
  job: {
    title: { minLength: 1, maxLength: 200 },
    company: { minLength: 1, maxLength: 200 },
    location: { maxLength: 200 },
    description: { maxLength: 10_000 },
    requiredSkillTerms: { maxItems: 20 },
    extractUrl: { maxLength: 500 },
    extractText: { minLength: 1, maxLength: 10_000 },
  },
  review: {
    assessment: { minLength: 1, maxLength: 2000 },
  },
} as const

// ── Primitives ────────────────────────────────────────────────────────────────

/**
 * Number of Unicode code points in `value` (AC3).
 *
 * The string iterator yields whole code points, so an astral character such as
 * `"\u{1F600}"` counts as one rather than as its two UTF-16 code units.
 */
export function countCodePoints(value: string): number {
  // Array.from uses the string iterator, which yields whole code points.
  return Array.from(value).length
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
}

// ── Password (AC2, AC3) ───────────────────────────────────────────────────────

/**
 * Whether `value` clears the minimum password length, counted in code points.
 *
 * This is exactly the acceptance predicate of Requirement 22 AC2/AC3:
 * `countCodePoints(value) >= BOUNDS.password.minCodePoints`.
 */
export function isPasswordLongEnough(value: string): boolean {
  return countCodePoints(value) >= BOUNDS.password.minCodePoints
}

/**
 * Applies the password policy: at least 10 and at most 128 code points.
 *
 * A value of up to 64 code points is always accepted, as AC2 requires.
 */
export function validatePassword(value: unknown, path = 'password'): ValidationIssue | null {
  if (typeof value !== 'string' || value === '') {
    return issue(path, 'required', 'validation.required')
  }
  const length = countCodePoints(value)
  if (length < BOUNDS.password.minCodePoints) {
    return issue(path, 'password_policy', 'validation.passwordTooShort', {
      minLength: BOUNDS.password.minCodePoints,
      actual: length,
    })
  }
  if (length > BOUNDS.password.maxCodePoints) {
    return issue(path, 'password_policy', 'validation.passwordTooLong', {
      maxLength: BOUNDS.password.maxCodePoints,
      actual: length,
    })
  }
  return null
}

/**
 * Login only requires a non-empty password — the Backend_Api declares
 * `min_length=1` there so an account created under an earlier policy can still
 * authenticate.
 */
export function validateLoginPassword(value: unknown, path = 'password'): ValidationIssue | null {
  return isBlank(value) || value === '' ? issue(path, 'required', 'validation.required') : null
}

// ── Email (AC4) ───────────────────────────────────────────────────────────────

const ATEXT = "[A-Za-z0-9!#$%&'*+\\-/=?^_`{|}~]"
const DOT_ATOM = `${ATEXT}+(?:\\.${ATEXT}+)*`
// qtext excludes DQUOTE and backslash; quoted-pair escapes any VCHAR or WSP.
const QUOTED_CONTENT = '(?:[\\x21\\x23-\\x5B\\x5D-\\x7E]|\\\\[\\x21-\\x7E \\t])'
const FWS = '[ \\t]*'
const QUOTED_STRING = `"(?:${FWS}${QUOTED_CONTENT})*${FWS}"`
// dtext excludes "[", "]" and backslash.
const DTEXT = '[\\x21-\\x5A\\x5E-\\x7E]'
const DOMAIN_LITERAL = `\\[(?:${FWS}${DTEXT})*${FWS}\\]`
const ADDR_SPEC = new RegExp(
  `^(?:${DOT_ATOM}|${QUOTED_STRING})@(?:${DOT_ATOM}|${DOMAIN_LITERAL})$`,
)

/**
 * Whether `value` is a well-formed address in the RFC 5322 addr-spec form:
 * `local-part "@" domain`, where the local part is a dot-atom or a quoted string
 * and the domain is a dot-atom or a domain-literal.
 *
 * Folding whitespace is accepted inside a quoted string and a domain literal;
 * the obsolete productions and comments are not accepted. No length limit is
 * applied — that is a separate bound, see {@link validateEmail}.
 */
export function isAddrSpec(value: unknown): value is string {
  return typeof value === 'string' && ADDR_SPEC.test(value)
}

/** Rejects a malformed address, and one longer than the declared field bound. */
export function validateEmail(
  value: unknown,
  options: { readonly path?: string; readonly required?: boolean; readonly maxLength?: number } = {},
): ValidationIssue | null {
  const path = options.path ?? 'email'
  const maxLength = options.maxLength ?? BOUNDS.email.maxLength
  if (isBlank(value)) {
    return options.required === true ? issue(path, 'required', 'validation.required') : null
  }
  if (!isAddrSpec(value)) {
    return issue(path, 'malformed_email', 'validation.emailMalformed')
  }
  const length = countCodePoints(value)
  return length > maxLength
    ? issue(path, 'too_long', 'validation.tooLong', { maxLength, actual: length })
    : null
}

// ── URLs (AC5, Req 13 AC13) ───────────────────────────────────────────────────

function hasForbiddenUrlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    // Whitespace, C0 controls and DEL may not appear literally in a URL.
    if (codePoint <= 0x20 || codePoint === 0x7f) {
      return true
    }
  }
  return false
}

/**
 * Whether `value` is a well-formed absolute HTTPS URL: an `https://` scheme, a
 * non-empty host, and no literal whitespace or control character.
 */
export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !/^https:\/\//i.test(value) || hasForbiddenUrlCharacter(value)) {
    return false
  }
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && parsed.hostname !== ''
  } catch {
    return false
  }
}

/** Rejects a value that is not a well-formed HTTPS URL within `maxLength` characters. */
export function validateHttpsUrl(
  value: unknown,
  options: { readonly path: string; readonly maxLength: number; readonly required?: boolean },
): ValidationIssue | null {
  const { path, maxLength } = options
  if (isBlank(value)) {
    return options.required === true ? issue(path, 'required', 'validation.required') : null
  }
  if (!isHttpsUrl(value)) {
    return issue(path, 'invalid_url', 'validation.httpsUrlInvalid', { maxLength })
  }
  const length = countCodePoints(value)
  return length > maxLength
    ? issue(path, 'invalid_url', 'validation.httpsUrlInvalid', { maxLength, actual: length })
    : null
}

/**
 * Whether `value` is acceptable as a LinkedIn URL: a well-formed HTTPS URL of at
 * most 200 characters (AC5). This is the acceptance predicate — the exact
 * biconditional the requirement states.
 */
export function isValidLinkedInUrl(value: unknown): boolean {
  return isHttpsUrl(value) && countCodePoints(value) <= BOUNDS.linkedinUrl.maxLength
}

/** Field-level LinkedIn URL rule; an absent value is allowed, the field is optional. */
export function validateLinkedInUrl(
  value: unknown,
  path = 'linkedin_url',
): ValidationIssue | null {
  if (isBlank(value)) {
    return null
  }
  return isValidLinkedInUrl(value)
    ? null
    : issue(path, 'invalid_url', 'validation.linkedinUrlInvalid', {
        maxLength: BOUNDS.linkedinUrl.maxLength,
      })
}

/**
 * External careers URL rule — required, HTTPS and at most 500 characters, applied
 * when the selected Application_Channel is `External_Careers_URL` (Req 13 AC13).
 */
export function validateExternalCareersUrl(
  value: unknown,
  path = 'external_url',
): ValidationIssue | null {
  return validateHttpsUrl(value, {
    path,
    maxLength: BOUNDS.externalUrl.maxLength,
    required: true,
  })
}

// ── Fixed-format codes (AC7) ──────────────────────────────────────────────────

const SIX_ASCII_DIGITS = /^[0-9]{6}$/

/**
 * Whether `value` is exactly six ASCII digits.
 *
 * Only ASCII digits count: a localized digit shape such as `"١٢٣٤٥٦"` is not a
 * Verification_Code the Backend_Api accepts.
 */
export function isSixDigitCode(value: unknown): boolean {
  return typeof value === 'string' && SIX_ASCII_DIGITS.test(value)
}

/** Restricts a Verification_Code or multi-factor code input to exactly six digits. */
export function validateSixDigitCode(value: unknown, path = 'code'): ValidationIssue | null {
  if (isBlank(value)) {
    return issue(path, 'required', 'validation.required')
  }
  return isSixDigitCode(value)
    ? null
    : issue(path, 'invalid_code_format', 'validation.codeSixDigits', {
        length: BOUNDS.code.length,
      })
}

/** The Verification_Code entered on the email-verification screen. */
export function validateVerificationCode(value: unknown): ValidationIssue | null {
  return validateSixDigitCode(value, 'code')
}

/** The multi-factor code entered on the MFA step. */
export function validateMfaCode(value: unknown, path = 'mfa_code'): ValidationIssue | null {
  return validateSixDigitCode(value, path)
}

// ── Ratings (AC8) ─────────────────────────────────────────────────────────────

/**
 * Whether `value` is an integer between 1 and 5 inclusive.
 *
 * Numbers only: a form adapter coerces its input before validating, so a numeric
 * string is not silently accepted here.
 */
export function isValidRating(value: unknown): boolean {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= BOUNDS.rating.min &&
    value <= BOUNDS.rating.max
  )
}

/** Restricts a rating input to an integer between 1 and 5 inclusive. */
export function validateRating(value: unknown, path = 'rating'): ValidationIssue | null {
  if (value === null || value === undefined || value === '') {
    return issue(path, 'required', 'validation.required')
  }
  return isValidRating(value)
    ? null
    : issue(path, 'out_of_range', 'validation.ratingRange', {
        min: BOUNDS.rating.min,
        max: BOUNDS.rating.max,
      })
}

// ── Date-range ordering with index reporting (AC6) ─────────────────────────────

type Comparable = { readonly kind: 'ordinal' | 'instant'; readonly at: number }

const INTEGER_TEXT = /^[+-]?\d+$/

function toComparable(value: unknown): Comparable | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { kind: 'ordinal', at: value } : null
  }
  if (value instanceof Date) {
    const at = value.getTime()
    return Number.isNaN(at) ? null : { kind: 'instant', at }
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') {
      return null
    }
    if (INTEGER_TEXT.test(trimmed)) {
      return { kind: 'ordinal', at: Number(trimmed) }
    }
    const at = Date.parse(trimmed)
    return Number.isNaN(at) ? null : { kind: 'instant', at }
  }
  return null
}

/** One education or work-experience entry to check for end-before-start. */
export interface DateOrderEntry {
  /** Start year, start date or `Date`. */
  readonly start: unknown
  /** End value; absent means "still ongoing" and is always accepted. */
  readonly end: unknown
  /** Zero-based position of the entry in its collection; named in the message. */
  readonly index: number
  /** Collection path, e.g. `education` or `work_experience`. */
  readonly collection?: string
  /** Member holding the end value, e.g. `end_year` or `end_date`. */
  readonly endField?: string
}

/**
 * Rejects an entry whose end value precedes its start value, naming the affected
 * entry index (AC6).
 *
 * The index is reported twice so a catalogue entry can phrase it either way:
 * `params.index` is the zero-based position the caller supplied, and
 * `params.entryNumber` is the one-based position a person reads. The issue `path`
 * also carries the index, e.g. `education.2.end_year`.
 *
 * A missing, empty or uninterpretable start or end value yields no issue — that
 * is a separate required/format rule — and neither do values of different kinds
 * (a year compared against a calendar date), which are not ordered relative to
 * each other.
 */
export function validateDateOrder(entry: DateOrderEntry): ValidationIssue | null {
  const collection = entry.collection ?? 'entries'
  const endField = entry.endField ?? 'end'
  const start = toComparable(entry.start)
  const end = toComparable(entry.end)
  if (start === null || end === null || start.kind !== end.kind) {
    return null
  }
  if (end.at >= start.at) {
    return null
  }
  return issue(
    `${collection}.${entry.index}.${endField}`,
    'end_before_start',
    'validation.dateRangeOrder',
    { index: entry.index, entryNumber: entry.index + 1, collection },
  )
}

/** One education entry as the form holds it. */
export interface EducationEntryInput {
  readonly institution?: unknown
  readonly degree?: unknown
  readonly field_of_study?: unknown
  readonly enrolment_status?: unknown
  readonly start_year?: unknown
  readonly end_year?: unknown
}

/** One work-experience entry as the form holds it. */
export interface WorkExperienceEntryInput {
  readonly company?: unknown
  readonly title?: unknown
  readonly start_date?: unknown
  readonly end_date?: unknown
  readonly description?: unknown
}

/** Applies the education-entry bounds and the end-not-before-start rule to every entry. */
export function validateEducationEntries(
  entries: readonly EducationEntryInput[],
  collection = 'education',
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  issues.push(
    ...collectSizeIssues(entries, {
      path: collection,
      ...BOUNDS.candidateProfile.education,
    }),
  )
  entries.forEach((entry, index) => {
    const at = `${collection}.${index}`
    issues.push(
      ...validateSchema(EDUCATION_ENTRY_SCHEMA, entry as Record<string, unknown>, at),
    )
    const order = validateDateOrder({
      start: entry.start_year,
      end: entry.end_year,
      index,
      collection,
      endField: 'end_year',
    })
    if (order !== null) {
      issues.push(order)
    }
  })
  return issues
}

/** Applies the work-experience bounds and the end-not-before-start rule to every entry. */
export function validateWorkExperienceEntries(
  entries: readonly WorkExperienceEntryInput[],
  collection = 'work_experience',
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  issues.push(
    ...collectSizeIssues(entries, {
      path: collection,
      ...BOUNDS.candidateProfile.workExperience,
    }),
  )
  entries.forEach((entry, index) => {
    const at = `${collection}.${index}`
    issues.push(
      ...validateSchema(WORK_EXPERIENCE_ENTRY_SCHEMA, entry as Record<string, unknown>, at),
    )
    const order = validateDateOrder({
      start: entry.start_date,
      end: entry.end_date,
      index,
      collection,
      endField: 'end_date',
    })
    if (order !== null) {
      issues.push(order)
    }
  })
  return issues
}

// ── Generic field rules (AC1) ─────────────────────────────────────────────────

/** A text field with length bounds counted in code points. */
export interface TextRule extends LengthBound {
  readonly kind: 'text'
  readonly required?: boolean
}

/** An integer field with an inclusive range. */
export interface IntegerRule extends RangeBound {
  readonly kind: 'integer'
  readonly required?: boolean
}

/** A field restricted to an enumerated value set. */
export interface EnumRule {
  readonly kind: 'enum'
  readonly required?: boolean
  readonly values: EnumValues<string>
}

/** A collection field with size bounds. */
export interface ListRule extends SizeBound {
  readonly kind: 'list'
  readonly required?: boolean
  /** Rule applied to every element, if the elements are scalars. */
  readonly item?: FieldRule
}

/** A field whose rule is one of the dedicated validators above. */
export interface CustomRule {
  readonly kind: 'custom'
  readonly validate: (value: unknown, path: string) => ValidationIssue | null
}

export type FieldRule = TextRule | IntegerRule | EnumRule | ListRule | CustomRule

/** A request body's field rules, keyed by the member name the Backend_Api declares. */
export type FieldSchema = Readonly<Record<string, FieldRule>>

/** Applies the text length bounds; an absent optional value yields no issue. */
export function validateText(
  value: unknown,
  options: TextRule & { readonly path: string },
): ValidationIssue | null {
  const { path, minLength, maxLength } = options
  if (isBlank(value)) {
    return options.required === true ? issue(path, 'required', 'validation.required') : null
  }
  if (typeof value !== 'string') {
    return issue(path, 'invalid_type', 'validation.invalidType')
  }
  const length = countCodePoints(value)
  if (minLength !== undefined && length < minLength) {
    return issue(path, 'too_short', 'validation.tooShort', { minLength, actual: length })
  }
  if (maxLength !== undefined && length > maxLength) {
    return issue(path, 'too_long', 'validation.tooLong', { maxLength, actual: length })
  }
  return null
}

/** Applies the integer range bounds; an absent optional value yields no issue. */
export function validateInteger(
  value: unknown,
  options: IntegerRule & { readonly path: string },
): ValidationIssue | null {
  const { path, min, max } = options
  if (value === null || value === undefined || value === '') {
    return options.required === true ? issue(path, 'required', 'validation.required') : null
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return issue(path, 'not_integer', 'validation.notInteger')
  }
  if (min !== undefined && value < min) {
    return issue(path, 'out_of_range', 'validation.numberRange', { min, max: max ?? '', actual: value })
  }
  if (max !== undefined && value > max) {
    return issue(path, 'out_of_range', 'validation.numberRange', { min: min ?? '', max, actual: value })
  }
  return null
}

/** Restricts a value to an enumerated set. */
export function validateEnum(
  value: unknown,
  options: EnumRule & { readonly path: string },
): ValidationIssue | null {
  const { path, values } = options
  if (isBlank(value)) {
    return options.required === true ? issue(path, 'required', 'validation.required') : null
  }
  return values.includes(value)
    ? null
    : issue(path, 'invalid_enum', 'validation.enumInvalid', { allowed: values.values.join(', ') })
}

function collectSizeIssues(
  value: unknown,
  options: SizeBound & { readonly path: string; readonly required?: boolean },
): ValidationIssue[] {
  const { path, minItems, maxItems } = options
  if (value === null || value === undefined) {
    return options.required === true ? [issue(path, 'required', 'validation.required')] : []
  }
  if (!Array.isArray(value)) {
    return [issue(path, 'invalid_type', 'validation.invalidType')]
  }
  const issues: ValidationIssue[] = []
  if (minItems !== undefined && value.length < minItems) {
    issues.push(
      issue(path, 'too_few_items', 'validation.tooFewItems', { minItems, actual: value.length }),
    )
  }
  if (maxItems !== undefined && value.length > maxItems) {
    issues.push(
      issue(path, 'too_many_items', 'validation.tooManyItems', { maxItems, actual: value.length }),
    )
  }
  return issues
}

/** Applies the collection size bounds, and the element rule to every element. */
export function validateList(
  value: unknown,
  options: ListRule & { readonly path: string },
): ValidationIssue[] {
  const issues = collectSizeIssues(value, options)
  const item = options.item
  if (item === undefined || !Array.isArray(value)) {
    return issues
  }
  value.forEach((element, index) => {
    issues.push(...applyRule(item, element, `${options.path}.${index}`))
  })
  return issues
}

function applyRule(rule: FieldRule, value: unknown, path: string): ValidationIssue[] {
  switch (rule.kind) {
    case 'text': {
      const found = validateText(value, { ...rule, path })
      return found === null ? [] : [found]
    }
    case 'integer': {
      const found = validateInteger(value, { ...rule, path })
      return found === null ? [] : [found]
    }
    case 'enum': {
      const found = validateEnum(value, { ...rule, path })
      return found === null ? [] : [found]
    }
    case 'list':
      return validateList(value, { ...rule, path })
    case 'custom': {
      const found = rule.validate(value, path)
      return found === null ? [] : [found]
    }
  }
}

/**
 * Applies a {@link FieldSchema} to a set of form values.
 *
 * Every field is checked, so all issues surface at once rather than only the
 * first. A member absent from `values` is validated as absent, which the
 * optional rules accept; `pathPrefix` scopes the reported paths to a nested
 * entry, e.g. `education.2`.
 */
export function validateSchema(
  schema: FieldSchema,
  values: Readonly<Record<string, unknown>>,
  pathPrefix = '',
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const [field, rule] of Object.entries(schema)) {
    const path = pathPrefix === '' ? field : `${pathPrefix}.${field}`
    issues.push(...applyRule(rule, values[field], path))
  }
  return issues
}

// ── Request-body schemas mirroring the Pydantic models (AC1) ──────────────────

const password: CustomRule = { kind: 'custom', validate: validatePassword }
const requiredEmail: CustomRule = {
  kind: 'custom',
  validate: (value, path) => validateEmail(value, { path, required: true }),
}
const optionalEmail: CustomRule = {
  kind: 'custom',
  validate: (value, path) => validateEmail(value, { path }),
}
const sixDigitCode: CustomRule = { kind: 'custom', validate: validateSixDigitCode }
const ratingRule: CustomRule = { kind: 'custom', validate: validateRating }
const linkedinUrl: CustomRule = { kind: 'custom', validate: validateLinkedInUrl }

const EDUCATION_ENTRY_SCHEMA: FieldSchema = {
  institution: { kind: 'text', required: true, ...BOUNDS.education.institution },
  degree: { kind: 'text', required: true, ...BOUNDS.education.degree },
  field_of_study: { kind: 'text', ...BOUNDS.education.fieldOfStudy },
  enrolment_status: { kind: 'enum', required: true, values: ENROLMENT_STATUS_VALUES },
  start_year: { kind: 'integer', required: true, ...BOUNDS.education.year },
  end_year: { kind: 'integer', ...BOUNDS.education.year },
}

const WORK_EXPERIENCE_ENTRY_SCHEMA: FieldSchema = {
  company: { kind: 'text', required: true, ...BOUNDS.workExperience.company },
  title: { kind: 'text', required: true, ...BOUNDS.workExperience.title },
  start_date: { kind: 'text', required: true },
  end_date: { kind: 'text' },
  description: { kind: 'text', ...BOUNDS.workExperience.description },
}

const SKILL_ENTRY_SCHEMA: FieldSchema = {
  term: { kind: 'text', required: true, ...BOUNDS.skill.term },
  years_experience: { kind: 'integer', ...BOUNDS.skill.yearsExperience },
}

const LANGUAGE_ENTRY_SCHEMA: FieldSchema = {
  language_code: { kind: 'text', required: true, ...BOUNDS.language.languageCode },
  proficiency: { kind: 'enum', required: true, values: PROFICIENCY_VALUES },
}

/**
 * The bounds each Backend_Api request body declares, as schemas a form can run
 * directly. Entry collections additionally carry the end-not-before-start rule,
 * applied by {@link validateEducationEntries} and
 * {@link validateWorkExperienceEntries}.
 */
export const SCHEMAS = {
  /** `POST /auth/register` */
  registration: {
    role: { kind: 'enum', required: true, values: SELF_REGISTRATION_ROLE_VALUES },
    email: requiredEmail,
    password,
    full_name: { kind: 'text', required: true, ...BOUNDS.registration.fullName },
    language_preference: { kind: 'enum', required: true, values: LOCALE_VALUES },
    residency_proof_type: { kind: 'enum', required: true, values: RESIDENCY_PROOF_TYPE_VALUES },
    residency_proof_value: {
      kind: 'text',
      required: true,
      ...BOUNDS.registration.residencyProofValue,
    },
    link_token: { kind: 'text', required: true, ...BOUNDS.registration.linkToken },
  },
  /** `POST /auth/verify-code` */
  verifyCode: { code: sixDigitCode },
  /** `POST /auth/login` */
  login: {
    email: requiredEmail,
    password: { kind: 'custom', validate: validateLoginPassword },
    role: { kind: 'enum', required: true, values: ROLE_VALUES },
  },
  /** The MFA step of `POST /auth/login`. */
  mfaChallenge: { mfa_code: sixDigitCode },
  /** `POST /auth/switch-context` */
  switchContext: {
    context: { kind: 'enum', required: true, values: ROLE_CONTEXT_VALUES },
  },
  /** `POST /admin/accounts/{id}:reject`, `:suspend` and `:deactivate`. */
  adminReason: {
    reason: { kind: 'text', required: true, ...BOUNDS.admin.reason },
  },
  /** `PUT /admin/accounts/{id}/roles` */
  adminRoles: {
    roles: {
      kind: 'list',
      required: true,
      ...BOUNDS.admin.roles,
      item: { kind: 'enum', required: true, values: ROLE_VALUES },
    },
  },
  /** `POST /admin/registration-links` */
  registrationLink: {
    role: { kind: 'enum', required: true, values: SELF_REGISTRATION_ROLE_VALUES },
  },
  /** `PUT /me/profile` — every member is optional, only edited fields are sent. */
  candidateProfile: {
    full_name: { kind: 'text', ...BOUNDS.candidateProfile.fullName },
    email: optionalEmail,
    phone: { kind: 'text', ...BOUNDS.candidateProfile.phone },
    city: { kind: 'text', ...BOUNDS.candidateProfile.city },
    summary: { kind: 'text', ...BOUNDS.candidateProfile.summary },
    linkedin_url: linkedinUrl,
    skills: { kind: 'list', ...BOUNDS.candidateProfile.skills },
    languages: { kind: 'list', ...BOUNDS.candidateProfile.languages },
  },
  educationEntry: EDUCATION_ENTRY_SCHEMA,
  workExperienceEntry: WORK_EXPERIENCE_ENTRY_SCHEMA,
  skillEntry: SKILL_ENTRY_SCHEMA,
  languageEntry: LANGUAGE_ENTRY_SCHEMA,
  /** `PUT /me/senior-profile` */
  seniorProfile: {
    full_name: { kind: 'text', ...BOUNDS.seniorProfile.fullName },
    company_affiliation: { kind: 'text', ...BOUNDS.seniorProfile.companyAffiliation },
    job_title: { kind: 'text', ...BOUNDS.seniorProfile.jobTitle },
    contact_channel_pref: { kind: 'enum', values: CONTACT_CHANNEL_PREF_VALUES },
    contact_scope_pref: { kind: 'enum', values: CONTACT_SCOPE_PREF_VALUES },
    expertise_skills: {
      kind: 'list',
      maxItems: BOUNDS.seniorProfile.expertiseSkills.maxItems,
      item: { kind: 'text', required: true, ...BOUNDS.skill.term },
    },
  },
  /** `POST /me/cv-variants` and `PATCH /me/cv-variants/{id}` */
  cvVariant: {
    name: { kind: 'text', required: true, ...BOUNDS.cv.variantName },
    description: { kind: 'text', ...BOUNDS.cv.variantDescription },
  },
  /** `POST /jobs` */
  jobCreate: {
    title: { kind: 'text', required: true, ...BOUNDS.job.title },
    company: { kind: 'text', required: true, ...BOUNDS.job.company },
    location: { kind: 'text', ...BOUNDS.job.location },
    work_model: { kind: 'enum', values: WORK_MODEL_VALUES },
    employment_type: { kind: 'enum', values: EMPLOYMENT_TYPE_VALUES },
    experience_level: { kind: 'enum', values: EXPERIENCE_LEVEL_VALUES },
    description: { kind: 'text', ...BOUNDS.job.description },
    external_url: {
      kind: 'custom',
      validate: (value, path) =>
        validateHttpsUrl(value, { path, maxLength: BOUNDS.externalUrl.maxLength }),
    },
    application_channel: { kind: 'enum', values: APPLICATION_CHANNEL_VALUES },
    required_skill_terms: {
      kind: 'list',
      ...BOUNDS.job.requiredSkillTerms,
      item: { kind: 'text', required: true, ...BOUNDS.skill.term },
    },
  },
  /** `POST /jobs/extract:url` */
  jobExtractUrl: {
    url: {
      kind: 'custom',
      validate: (value, path) =>
        validateHttpsUrl(value, {
          path,
          maxLength: BOUNDS.job.extractUrl.maxLength,
          required: true,
        }),
    },
  },
  /** `POST /jobs/extract:text` */
  jobExtractText: {
    raw_text: { kind: 'text', required: true, ...BOUNDS.job.extractText },
  },
  /** `POST /candidates/{id}/reviews` */
  review: {
    rating_technical: ratingRule,
    rating_communication: ratingRule,
    rating_culture_fit: ratingRule,
    rating_overall: ratingRule,
    assessment: { kind: 'text', required: true, ...BOUNDS.review.assessment },
  },
} as const satisfies Readonly<Record<string, FieldSchema>>

// ── Composite rules ───────────────────────────────────────────────────────────

/** A candidate profile as the form holds it. */
export interface CandidateProfileInput extends Readonly<Record<string, unknown>> {
  readonly education?: readonly EducationEntryInput[]
  readonly work_experience?: readonly WorkExperienceEntryInput[]
}

/**
 * Runs every candidate-profile rule: the scalar bounds, the entry-collection
 * sizes, each entry's own bounds and the end-not-before-start rule per entry.
 *
 * All issues are returned together so the form can render them simultaneously.
 */
export function validateCandidateProfile(values: CandidateProfileInput): ValidationIssue[] {
  const issues = validateSchema(SCHEMAS.candidateProfile, values)
  if (values.education !== undefined) {
    issues.push(...validateEducationEntries(values.education))
  }
  if (values.work_experience !== undefined) {
    issues.push(...validateWorkExperienceEntries(values.work_experience))
  }
  return issues
}

/**
 * Whether a selected file is within the upload size bound (Req 11 AC9).
 */
export function isWithinUploadSize(sizeBytes: number): boolean {
  return sizeBytes <= BOUNDS.cv.maxUploadBytes
}

/** Rejects a selected CV file larger than the declared upload bound (Req 11 AC9). */
export function validateCvUploadSize(sizeBytes: number, path = 'file'): ValidationIssue | null {
  return isWithinUploadSize(sizeBytes)
    ? null
    : issue(path, 'file_too_large', 'validation.fileTooLarge', {
        maxBytes: BOUNDS.cv.maxUploadBytes,
        actual: sizeBytes,
      })
}
