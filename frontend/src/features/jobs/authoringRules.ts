/**
 * The Job_Description authoring rules, as pure logic (Requirement 13).
 *
 * Everything the authoring surfaces decide *about* a Job_Description lives here
 * rather than in a component: what the form holds, what request body a submission
 * produces, which fields a `PATCH` may carry, which lifecycle controls a status
 * admits, and what an `illegal_transition` envelope names. No React, no
 * Api_Client, no i18n — so each rule is assertable without rendering anything.
 *
 * | rule | requirement |
 * | --- | --- |
 * | the fields the creation form collects | AC1 |
 * | the `POST /jobs` body | AC2 |
 * | the `PATCH /jobs/{jd_id}` body — changed fields only | AC11 |
 * | which controls a status admits | AC11, AC12, AC14, AC15, AC16 |
 * | the HTTPS external URL a publish requires | AC13 |
 * | the `from`/`to` of an `illegal_transition` | AC18 |
 *
 * ## Why the draft is not the request body
 *
 * A form input holds text: an emptied optional field is `''`, while the contract
 * spells "no value" as `null`, and `PATCH` distinguishes "not supplied" from
 * "cleared". Keeping {@link JobDraft} in the input vocabulary and converting at
 * the boundary ({@link createJobBody}, {@link changedJobFields}) is what lets AC11
 * send *only* what changed without the form having to track dirty state itself.
 *
 * ## Why required skills round-trip through terms
 *
 * `JdCreateRequest` and `JdUpdateRequest` accept `required_skill_terms` — free
 * text the Backend_Api resolves against the Skill_Taxonomy — while
 * `JobDescriptionDTO` returns `required_skill_ids`. There is no
 * lookup-by-identifier endpoint (requirements Assumption 4), so an edit form
 * pre-fills its terms from the names `skills.ts` could resolve and
 * {@link changedJobFields} compares the submitted terms against exactly those
 * names. An identifier the taxonomy did not name is therefore *not* silently
 * dropped: {@link unresolvedSkillTerms} reports it so the surface can say that the
 * skill list cannot be edited safely until it resolves.
 *
 * Requirements: 13.1, 13.2, 13.11, 13.12, 13.13, 13.14, 13.15, 13.16, 13.18.
 */

import type {
  ApplicationChannel,
  EmploymentType,
  ExperienceLevel,
  JdStatus,
  WorkModel,
} from '../../api/enums'
import type { components } from '../../api/generated/schema'
import {
  APPLICATION_CHANNEL_VALUES,
  BOUNDS,
  SCHEMAS,
  validateExternalCareersUrl,
  validateSchema,
  type ValidationIssue,
} from '../../forms/validators'

import type { JobDescription } from './jobsApi'
import type { ResolvedSkill } from './skills'

/** The `POST /api/v1/jobs` body, and the body a draft confirmation carries (AC2, AC9). */
export type JobCreateBody = components['schemas']['JdCreateRequest']

/** The `PATCH /api/v1/jobs/{jd_id}` body: every member optional (AC11). */
export type JobUpdateBody = components['schemas']['JdUpdateRequest']

/** The `PUT /api/v1/jobs/{jd_id}/application-channel` body (AC16). */
export type ApplicationChannelBody = components['schemas']['SetApplicationChannelRequest']

// ── The draft the form holds (AC1) ────────────────────────────────────────────

/**
 * The Job_Description as the creation and edit forms hold it (AC1).
 *
 * Text members are always strings — never `null` — because that is what an input
 * element holds; the enumerated members are `null` while unselected, because a
 * `Select` has no value then and "unselected" is a state the contract accepts.
 */
export interface JobDraft {
  readonly title: string
  readonly company: string
  readonly location: string
  readonly workModel: WorkModel | null
  readonly employmentType: EmploymentType | null
  readonly experienceLevel: ExperienceLevel | null
  readonly description: string
  readonly applicationChannel: ApplicationChannel | null
  readonly externalUrl: string
  /** Free-text skill terms the Backend_Api resolves against the Skill_Taxonomy. */
  readonly skillTerms: readonly string[]
}

/** An empty creation form. */
export const EMPTY_JOB_DRAFT: JobDraft = Object.freeze({
  title: '',
  company: '',
  location: '',
  workModel: null,
  employmentType: null,
  experienceLevel: null,
  description: '',
  applicationChannel: null,
  externalUrl: '',
  skillTerms: Object.freeze([]) as readonly string[],
})

/**
 * The contract member each draft field is addressed by.
 *
 * The same spelling the Backend_Api uses in a Field_Violation `path`, so a 422
 * lands on the input that produced it (Requirement 22 AC9, AC10) without a
 * translation table in the form.
 */
export const JOB_FIELD = {
  title: 'title',
  company: 'company',
  location: 'location',
  workModel: 'work_model',
  employmentType: 'employment_type',
  experienceLevel: 'experience_level',
  description: 'description',
  applicationChannel: 'application_channel',
  externalUrl: 'external_url',
  skillTerms: 'required_skill_terms',
} as const

/** One addressable field of the authoring form. */
export type JobField = keyof typeof JOB_FIELD

/** The collection path the Backend_Api addresses the skill-term rows by. */
export const SKILL_TERMS_PATH: string = JOB_FIELD.skillTerms

/**
 * The canonical path of one skill-term row.
 *
 * The dotted/indexed spelling `forms/violations.ts` normalizes a server
 * `required_skill_terms[0]` into, so placing a 422 message on a row and focusing that
 * row are one lookup.
 */
export function skillTermPath(index: number): string {
  return `${SKILL_TERMS_PATH}.${index}`
}

/** The most skill terms a Job_Description may carry, mirrored from the Pydantic bound. */
export const MAX_SKILL_TERMS: number = BOUNDS.job.requiredSkillTerms.maxItems

// ── Terms ─────────────────────────────────────────────────────────────────────

/**
 * Skill terms as they are submitted: trimmed, blanks dropped, duplicates dropped,
 * order preserved.
 *
 * The Backend_Api resolves a term to a taxonomy entry, so two spellings that
 * differ only in surrounding whitespace are one skill and sending both would ask
 * for the same skill twice.
 */
export function normalizeSkillTerms(terms: readonly (string | null | undefined)[]): readonly string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const raw of terms) {
    if (typeof raw !== 'string') {
      continue
    }
    const term = raw.trim()
    if (term === '' || seen.has(term)) {
      continue
    }
    seen.add(term)
    normalized.push(term)
  }
  return normalized
}

function sameTerms(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((term, index) => term === right[index])
}

/** `null` for a blank text value, the trimmed text otherwise. */
function optionalText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

// ── Pre-filling an edit form (AC11) ───────────────────────────────────────────

/**
 * The draft that edits a loaded Job_Description (AC11).
 *
 * `skills` are the required skills as `skills.ts` resolved them; an identifier the
 * taxonomy did not name contributes *no* term, and {@link unresolvedSkillTerms}
 * reports it separately — see the module note.
 */
export function jobDraftFrom(
  job: JobDescription,
  skills: readonly ResolvedSkill[] = [],
): JobDraft {
  return {
    title: job.title,
    company: job.company,
    location: job.location ?? '',
    workModel: job.work_model,
    employmentType: job.employment_type,
    experienceLevel: job.experience_level,
    description: job.description ?? '',
    applicationChannel: job.application_channel,
    externalUrl: job.external_url ?? '',
    skillTerms: normalizeSkillTerms(skills.map((skill) => skill.name)),
  }
}

/**
 * The required skills of a Job_Description the taxonomy could not name (AC11).
 *
 * A `PATCH` replaces the whole term list, so editing skills while an identifier is
 * unresolved would drop that skill from the role. The surface states this and
 * leaves the skill editor read-only instead.
 */
export function unresolvedSkillTerms(skills: readonly ResolvedSkill[]): readonly string[] {
  return skills.filter((skill) => skill.name === null).map((skill) => skill.id)
}

// ── Request bodies ────────────────────────────────────────────────────────────

/**
 * The `POST /api/v1/jobs` body of a submitted creation form (AC2), and the body
 * `POST /jobs/extract/{draft_id}:confirm` carries (AC9).
 *
 * Both endpoints declare the same schema, which is why one function builds both:
 * confirming an extraction draft *is* creating a Job_Description from the values
 * the user confirmed.
 */
export function createJobBody(draft: JobDraft): JobCreateBody {
  return {
    title: draft.title.trim(),
    company: draft.company.trim(),
    location: optionalText(draft.location),
    work_model: draft.workModel,
    employment_type: draft.employmentType,
    experience_level: draft.experienceLevel,
    description: optionalText(draft.description),
    application_channel: draft.applicationChannel,
    external_url: optionalText(draft.externalUrl),
    required_skill_terms: [...normalizeSkillTerms(draft.skillTerms)],
  }
}

/**
 * The `PATCH /api/v1/jobs/{jd_id}` body: the changed fields and nothing else
 * (AC11).
 *
 * A field the user did not touch is absent from the body rather than resent with
 * its current value, so an edit cannot overwrite a concurrent change to a field
 * this form never showed. `current` is the Job_Description as loaded, and
 * `currentSkills` the required skills as resolved — the same pair
 * {@link jobDraftFrom} pre-filled from, so "changed" means changed against what
 * the user was shown.
 */
export function changedJobFields(
  current: JobDescription,
  draft: JobDraft,
  currentSkills: readonly ResolvedSkill[] = [],
): JobUpdateBody {
  const body: Record<string, unknown> = {}
  const before = jobDraftFrom(current, currentSkills)

  if (draft.title.trim() !== before.title.trim()) {
    body[JOB_FIELD.title] = draft.title.trim()
  }
  if (draft.company.trim() !== before.company.trim()) {
    body[JOB_FIELD.company] = draft.company.trim()
  }
  if (optionalText(draft.location) !== optionalText(before.location)) {
    body[JOB_FIELD.location] = optionalText(draft.location)
  }
  if (draft.workModel !== before.workModel) {
    body[JOB_FIELD.workModel] = draft.workModel
  }
  if (draft.employmentType !== before.employmentType) {
    body[JOB_FIELD.employmentType] = draft.employmentType
  }
  if (draft.experienceLevel !== before.experienceLevel) {
    body[JOB_FIELD.experienceLevel] = draft.experienceLevel
  }
  if (optionalText(draft.description) !== optionalText(before.description)) {
    body[JOB_FIELD.description] = optionalText(draft.description)
  }
  if (draft.applicationChannel !== before.applicationChannel) {
    body[JOB_FIELD.applicationChannel] = draft.applicationChannel
  }
  if (optionalText(draft.externalUrl) !== optionalText(before.externalUrl)) {
    body[JOB_FIELD.externalUrl] = optionalText(draft.externalUrl)
  }
  const terms = normalizeSkillTerms(draft.skillTerms)
  if (!sameTerms(terms, before.skillTerms)) {
    body[JOB_FIELD.skillTerms] = [...terms]
  }

  return body as JobUpdateBody
}

/** Whether an edit changed anything at all, i.e. whether there is a `PATCH` to issue. */
export function hasJobChanges(body: JobUpdateBody): boolean {
  return Object.keys(body).length > 0
}

/** The `PUT .../application-channel` body (AC16). */
export function applicationChannelBody(channel: ApplicationChannel): ApplicationChannelBody {
  return { channel }
}

// ── Validation (AC1, AC13) ────────────────────────────────────────────────────

/**
 * The client-side bounds of a creation or edit submission.
 *
 * Runs the Form_Validator's `POST /jobs` schema over the body the submission would
 * send, so the rules are the mirrored Pydantic bounds rather than a second set
 * spelled out here (Requirement 22 AC1). The Backend_Api stays the authority: a
 * 422 it reports is placed on the same inputs by `forms/violations.ts`
 * (Requirement 22 AC12).
 */
export function validateJobDraft(draft: JobDraft): readonly ValidationIssue[] {
  return validateSchema(SCHEMAS.jobCreate, createJobBody(draft) as Record<string, unknown>)
}

/**
 * Whether a channel makes the external URL mandatory (AC13).
 *
 * `External_Careers_URL` is the channel that sends an applicant off the platform,
 * so without a URL the published Job_Description would offer no way to apply.
 */
export function requiresExternalUrl(channel: ApplicationChannel | null | undefined): boolean {
  return channel === 'External_Careers_URL'
}

/**
 * The publish precondition of AC13: while the selected Application_Channel is
 * `External_Careers_URL`, a well-formed HTTPS URL of at most 500 characters is
 * required *before* the publish request is issued.
 *
 * Returns the issue to render, or `null` when the publish may proceed. Applied to
 * the loaded Job_Description rather than to a form draft, because publishing is
 * available from the authoring surface whether or not the form was edited.
 */
export function validatePublishPrecondition(
  job: Pick<JobDescription, 'application_channel' | 'external_url'>,
): ValidationIssue | null {
  if (!requiresExternalUrl(job.application_channel)) {
    return null
  }
  return validateExternalCareersUrl(job.external_url, JOB_FIELD.externalUrl)
}

/** The external-URL bound AC13 states, for the hint beside the input. */
export const EXTERNAL_URL_MAX_LENGTH: number = BOUNDS.externalUrl.maxLength

/** Every Application_Channel the control offers (AC16). */
export const APPLICATION_CHANNELS: readonly ApplicationChannel[] = APPLICATION_CHANNEL_VALUES.values

// ── Lifecycle controls (AC11, AC12, AC14, AC15, AC16) ─────────────────────────

/**
 * One control the authoring surface may present.
 *
 * `reopen` is deliberately absent from this union: AC15 forbids it and the
 * lifecycle is one-way, so there is no value a component could ask for.
 */
export type JobAuthoringAction = 'edit' | 'publish' | 'close' | 'channel'

const ACTIONS_BY_STATUS: Readonly<Record<JdStatus, readonly JobAuthoringAction[]>> = Object.freeze({
  // AC11, AC12, AC16.
  Draft: Object.freeze(['edit', 'publish', 'channel'] as const),
  // AC11, AC14, AC16.
  Open: Object.freeze(['edit', 'close', 'channel'] as const),
  // AC15: no edit, no publish, no reopen — and no channel change either, since
  // AC16 offers that control for `Draft` and `Open` only.
  Closed: Object.freeze([] as const),
})

const NO_ACTIONS: readonly JobAuthoringAction[] = Object.freeze([])

/**
 * The controls a status admits (AC11, AC12, AC14, AC15, AC16).
 *
 * One table, read by every surface, so the four conditions cannot drift apart. A
 * status the contract does not declare admits nothing: a lifecycle state this
 * build does not understand must not offer transitions the Backend_Api would
 * refuse.
 */
export function jobAuthoringActions(
  status: JdStatus | null | undefined,
): readonly JobAuthoringAction[] {
  if (status == null) {
    return NO_ACTIONS
  }
  return ACTIONS_BY_STATUS[status] ?? NO_ACTIONS
}

/** Whether a status admits one particular control. */
export function admitsJobAction(
  status: JdStatus | null | undefined,
  action: JobAuthoringAction,
): boolean {
  return jobAuthoringActions(status).includes(action)
}

/** AC11: an edit control for a `Draft` or `Open` Job_Description. */
export function canEditJob(status: JdStatus | null | undefined): boolean {
  return admitsJobAction(status, 'edit')
}

/** AC12: a publish control for a `Draft` Job_Description. */
export function canPublishJob(status: JdStatus | null | undefined): boolean {
  return admitsJobAction(status, 'publish')
}

/** AC14: a close control for an `Open` Job_Description. */
export function canCloseJob(status: JdStatus | null | undefined): boolean {
  return admitsJobAction(status, 'close')
}

/** AC16: an Application_Channel control for a `Draft` or `Open` Job_Description. */
export function canSetApplicationChannel(status: JdStatus | null | undefined): boolean {
  return admitsJobAction(status, 'channel')
}

// ── illegal_transition (AC18) ─────────────────────────────────────────────────

/** The `error` member AC18 names. */
export const ILLEGAL_TRANSITION_ERROR = 'illegal_transition'

/** The transition an `illegal_transition` envelope reported (AC18). */
export interface IllegalTransition {
  /** `details.from`, or `null` when the envelope carried none. */
  readonly from: string | null
  /** `details.to`, or `null` when the envelope carried none. */
  readonly to: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function detailsMember(details: unknown, member: string): string | null {
  if (!isRecord(details)) {
    return null
  }
  const value = details[member]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * The `from`/`to` of an `illegal_transition` failure, or `null` for any other
 * failure (AC18).
 *
 * Reading it here rather than in the component is what makes the two obligations
 * of AC18 — name the two states, *and* refresh the displayed Job_Description —
 * one decision taken in one place: a non-`null` result is both the message
 * context and the signal to refetch.
 *
 * A member the envelope omitted is `null` rather than a fabricated state name, and
 * the surface says "unknown" for it: inventing a plausible status would misreport
 * what the Backend_Api refused.
 */
export function illegalTransitionOf(error: unknown): IllegalTransition | null {
  if (!isRecord(error) || error.error !== ILLEGAL_TRANSITION_ERROR) {
    return null
  }
  return {
    from: detailsMember(error.details, 'from'),
    to: detailsMember(error.details, 'to'),
  }
}

/** Whether a failure is the `illegal_transition` of AC18. */
export function isIllegalTransition(error: unknown): boolean {
  return illegalTransitionOf(error) !== null
}
