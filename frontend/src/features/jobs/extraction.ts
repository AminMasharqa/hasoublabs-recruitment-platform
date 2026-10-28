/**
 * The Job_Description extraction draft, as pure logic
 * (Requirement 13 AC3–AC10).
 *
 * An extraction is asynchronous: `POST /jobs/extract:url` or
 * `POST /jobs/extract:text` answers 202 with a draft, `GET /jobs/extract/{draft_id}`
 * reports that draft until its `status` leaves `pending`, and
 * `POST /jobs/extract/{draft_id}:confirm` turns confirmed values into a real
 * `Draft` Job_Description. Every decision along the way — keep polling or stop,
 * which fields were pre-populated, which need manual entry, whether the form may
 * be submitted at all — is a function here, so the polling surface holds no rules
 * of its own and each rule is testable without a timer.
 *
 * ## Why the draft is decoded rather than trusted
 *
 * The contract declares `extracted_fields` as `Record<string, unknown>`,
 * `skill_candidates` as `unknown[]` and `status` as a bare `string`: the extractor
 * is heuristic and the payload is deliberately free-form. So nothing here assumes a
 * shape. A value that is not usable as the field it claims to be — an
 * `employment_type` outside the contract enumeration, say — is treated as *not
 * extracted*, which routes it into the manual-entry warning of AC8 instead of into
 * a `Select` that would refuse it.
 *
 * ## Why `ready` is not the same as `succeeded`
 *
 * The Backend_Api reports `ready` as soon as `extracted_fields` is non-empty, and a
 * failed URL fetch or a rejected address populates that member with a single
 * `error` key. A client that read `ready` as success would pre-populate a form from
 * an error message. {@link decodeExtractionDraft} therefore classifies such a draft
 * as {@link ExtractionOutcome} `failed` and carries the reported text as
 * {@link ExtractionDraft.failureMessage}, so the surface states what went wrong and
 * offers the manual form instead.
 *
 * ## The confirmation gate (AC7, AC10)
 *
 * AC7 requires every reported skill candidate to be explicitly confirmed or
 * replaced, and AC10 forbids *any* persistence request for an extraction draft
 * before the user confirms the pre-populated form. Both are one predicate,
 * {@link canConfirmExtraction}, which the submit control reads: a candidate left
 * undecided keeps the control disabled, so there is no path from an unreviewed
 * candidate to a request.
 *
 * Requirements: 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10.
 */

import type { EmploymentType, ExperienceLevel, WorkModel } from '../../api/enums'
import type { components } from '../../api/generated/schema'
import {
  EMPLOYMENT_TYPE_VALUES,
  EXPERIENCE_LEVEL_VALUES,
  WORK_MODEL_VALUES,
  type EnumValues,
} from '../../forms/validators'

import { EMPTY_JOB_DRAFT, normalizeSkillTerms, type JobDraft } from './authoringRules'

/** The draft as `GET /api/v1/jobs/extract/{draft_id}` returns it. */
export type ExtractionDraftDTO = components['schemas']['JdExtractionDraftDTO']

/** Requirement 13 AC5: poll at an interval of at most 5 seconds. */
export const EXTRACTION_POLL_INTERVAL_MS = 5_000

/** The `status` member the Backend_Api reports while the worker is still running. */
export const PENDING_EXTRACTION_STATUS = 'pending'

/** The `status` member the Backend_Api reports once the worker has written results. */
export const READY_EXTRACTION_STATUS = 'ready'

/**
 * What a polled draft amounts to.
 *
 * `pending` keeps the poll running (AC5); `ready` pre-populates the form (AC6);
 * `failed` is a `ready` draft carrying an extraction error rather than fields, and
 * an `unknown` status is treated as terminal — a status this build does not
 * understand is not one to poll forever.
 */
export type ExtractionOutcome = 'pending' | 'ready' | 'failed' | 'unknown'

/** One skill the extractor proposed, awaiting confirmation or replacement (AC7). */
export interface SkillCandidate {
  /** The proposed term, exactly as reported. */
  readonly term: string
  /** The taxonomy identifier the extractor matched, when it matched one. */
  readonly skillId: string | null
  /** The extractor's confidence, when it reported one. */
  readonly confidence: number | null
}

/** The fields an extraction may pre-populate (AC6, AC8). */
export interface ExtractedFields {
  readonly title: string | null
  readonly company: string | null
  readonly location: string | null
  readonly workModel: WorkModel | null
  readonly employmentType: EmploymentType | null
  readonly experienceLevel: ExperienceLevel | null
  readonly description: string | null
}

/** No field extracted: every pre-populated input needs manual entry (AC8). */
export const NO_EXTRACTED_FIELDS: ExtractedFields = Object.freeze({
  title: null,
  company: null,
  location: null,
  workModel: null,
  employmentType: null,
  experienceLevel: null,
  description: null,
})

/** A polled extraction draft, decoded. */
export interface ExtractionDraft {
  /** The draft identifier the poll and the confirmation are addressed to. */
  readonly id: string
  /** The `status` member exactly as reported, for display and for diagnostics. */
  readonly reportedStatus: string
  /** What that status amounts to for the surface. */
  readonly outcome: ExtractionOutcome
  /** Whether the draft came from a URL or from pasted text. */
  readonly source: string
  /** The pre-populated values (AC6). */
  readonly fields: ExtractedFields
  /** The skills awaiting confirmation (AC7). */
  readonly skillCandidates: readonly SkillCandidate[]
  /**
   * The extractor's own failure text, when the draft failed.
   *
   * Backend_Api text, carried verbatim — it may be Arabic or Hebrew and must be
   * rendered byte-identically (Requirement 19 AC10).
   */
  readonly failureMessage: string | null
}

// ── Decoding ──────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A non-blank string, or `null`. Preserves the value; only blankness is judged. */
function textMember(source: Record<string, unknown>, member: string): string | null {
  const value = source[member]
  if (typeof value !== 'string' || value.trim() === '') {
    return null
  }
  return value
}

/** A member constrained to a contract enumeration, or `null` when it is not one. */
function enumMember<T extends string>(
  source: Record<string, unknown>,
  member: string,
  members: EnumValues<T>,
): T | null {
  const value = source[member]
  return members.includes(value) ? value : null
}

/** The `error` key the worker writes into `extracted_fields` on a failed run. */
const EXTRACTION_ERROR_MEMBER = 'error'

/** Decodes the `extracted_fields` member of a draft (AC6). */
export function decodeExtractedFields(body: unknown): ExtractedFields {
  if (!isRecord(body)) {
    return NO_EXTRACTED_FIELDS
  }
  return {
    title: textMember(body, 'title'),
    company: textMember(body, 'company'),
    location: textMember(body, 'location'),
    workModel: enumMember(body, 'work_model', WORK_MODEL_VALUES),
    employmentType: enumMember(body, 'employment_type', EMPLOYMENT_TYPE_VALUES),
    experienceLevel: enumMember(body, 'experience_level', EXPERIENCE_LEVEL_VALUES),
    description: textMember(body, 'description'),
  }
}

/**
 * Decodes the `skill_candidates` member of a draft (AC7).
 *
 * An entry with no usable term is dropped: a candidate that cannot be named can be
 * neither confirmed nor replaced, and keeping it would block the submission of
 * AC10 on something the user cannot act on.
 */
export function decodeSkillCandidates(body: unknown): readonly SkillCandidate[] {
  if (!Array.isArray(body)) {
    return []
  }
  const candidates: SkillCandidate[] = []
  for (const entry of body) {
    if (typeof entry === 'string') {
      const term = entry.trim()
      if (term !== '') {
        candidates.push({ term: entry, skillId: null, confidence: null })
      }
      continue
    }
    if (!isRecord(entry)) {
      continue
    }
    const term = textMember(entry, 'term') ?? textMember(entry, 'name')
    if (term === null) {
      continue
    }
    const confidence = entry.confidence
    candidates.push({
      term,
      skillId: textMember(entry, 'skill_id'),
      confidence: typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : null,
    })
  }
  return candidates
}

/** Whether decoded fields carry anything at all (AC6 vs AC8). */
export function hasExtractedValues(fields: ExtractedFields): boolean {
  return Object.values(fields).some((value) => value !== null)
}

/**
 * Decodes a polled draft (AC5–AC8).
 *
 * The outcome is derived rather than taken at face value: a `ready` draft whose
 * `extracted_fields` carries only an `error` member is a failed extraction, and a
 * `ready` draft carrying nothing usable at all is failed too — pre-populating an
 * empty form would present the extraction as having succeeded.
 */
export function decodeExtractionDraft(dto: ExtractionDraftDTO): ExtractionDraft {
  const raw = isRecord(dto.extracted_fields) ? dto.extracted_fields : {}
  const fields = decodeExtractedFields(raw)
  const failureMessage = textMember(raw, EXTRACTION_ERROR_MEMBER)
  const reportedStatus = typeof dto.status === 'string' ? dto.status : ''

  const outcome: ExtractionOutcome =
    reportedStatus === PENDING_EXTRACTION_STATUS
      ? 'pending'
      : reportedStatus === READY_EXTRACTION_STATUS
        ? failureMessage !== null || !hasExtractedValues(fields)
          ? 'failed'
          : 'ready'
        : 'unknown'

  return {
    id: dto.id,
    reportedStatus,
    outcome,
    source: typeof dto.source === 'string' ? dto.source : '',
    fields,
    skillCandidates: decodeSkillCandidates(dto.skill_candidates),
    failureMessage,
  }
}

// ── Polling (AC5) ─────────────────────────────────────────────────────────────

/** Whether the draft is still being produced, i.e. whether the poll continues (AC5). */
export function isExtractionPending(draft: ExtractionDraft | null | undefined): boolean {
  return draft?.outcome === 'pending'
}

/**
 * The delay until the next poll, or `false` once the draft is terminal (AC5).
 *
 * Shaped for TanStack Query's `refetchInterval`, which takes exactly this union.
 * An absent draft polls as well: the 202 that started the extraction reported a
 * non-terminal status, so the first poll has simply not answered yet.
 */
export function extractionPollInterval(
  draft: ExtractionDraft | null | undefined,
): number | false {
  if (draft != null && draft.outcome !== 'pending') {
    return false
  }
  return EXTRACTION_POLL_INTERVAL_MS
}

// ── Pre-population and warnings (AC6, AC8) ────────────────────────────────────

/** The draft fields extraction can fill, in the order the form renders them. */
export const EXTRACTABLE_FIELDS = Object.freeze([
  'title',
  'company',
  'location',
  'workModel',
  'employmentType',
  'experienceLevel',
  'description',
] as const)

/** One field an extraction may pre-populate. */
export type ExtractableField = (typeof EXTRACTABLE_FIELDS)[number]

/**
 * The creation form pre-populated from a ready draft (AC6).
 *
 * Every member the extraction did not supply keeps its empty value, and every one
 * it did supply is written into the draft the form edits — so the values are
 * editable simply because they are the form's own state, which is what AC6's
 * "leave every pre-populated input editable" asks for.
 *
 * `skill_candidates` deliberately do *not* become skill terms here: AC7 requires
 * each to be confirmed or replaced first, and {@link confirmedSkillTerms} is what
 * turns the resolved ones into terms.
 */
export function draftFromExtraction(fields: ExtractedFields, base: JobDraft = EMPTY_JOB_DRAFT): JobDraft {
  return {
    ...base,
    title: fields.title ?? base.title,
    company: fields.company ?? base.company,
    location: fields.location ?? base.location,
    workModel: fields.workModel ?? base.workModel,
    employmentType: fields.employmentType ?? base.employmentType,
    experienceLevel: fields.experienceLevel ?? base.experienceLevel,
    description: fields.description ?? base.description,
  }
}

/**
 * The pre-populated inputs holding no extracted value (AC8).
 *
 * Reported in form order, so the warnings read top to bottom as the user moves
 * through the form.
 */
export function missingExtractedFields(fields: ExtractedFields): readonly ExtractableField[] {
  return EXTRACTABLE_FIELDS.filter((field) => fields[field] === null)
}

// ── Skill-candidate confirmation (AC7, AC10) ──────────────────────────────────

/**
 * What the user decided about one candidate.
 *
 * `pending` is the initial state and the one that blocks submission; `confirmed`
 * keeps the proposed term, `replaced` substitutes the user's own, and `discarded`
 * is the third legitimate decision — a candidate the role does not actually
 * require. All three are decisions, so all three unblock the form; only `pending`
 * does not.
 */
export type SkillDecision = 'pending' | 'confirmed' | 'replaced' | 'discarded'

/** One candidate together with the decision taken about it (AC7). */
export interface SkillResolution {
  /** The term as the extractor proposed it. */
  readonly proposed: string
  /** The term that will be submitted: the proposal, or the replacement. */
  readonly term: string
  readonly decision: SkillDecision
}

/** The initial resolutions of a ready draft: one pending entry per candidate (AC7). */
export function initialSkillResolutions(
  candidates: readonly SkillCandidate[],
): readonly SkillResolution[] {
  return candidates.map((candidate) => ({
    proposed: candidate.term,
    term: candidate.term,
    decision: 'pending',
  }))
}

/**
 * Records a decision about one candidate, leaving the others untouched (AC7).
 *
 * Indexed rather than keyed by term, because an extractor may propose the same term
 * twice and each proposal is confirmed on its own.
 */
export function decideSkillCandidate(
  resolutions: readonly SkillResolution[],
  index: number,
  decision: SkillDecision,
  replacement?: string,
): readonly SkillResolution[] {
  return resolutions.map((resolution, position) => {
    if (position !== index) {
      return resolution
    }
    if (decision === 'replaced') {
      // The replacement is kept exactly as typed, blank included — the user is
      // mid-edit. A blank one simply does not *resolve* the candidate, which
      // {@link isSkillCandidateResolved} decides.
      return { ...resolution, decision: 'replaced', term: replacement ?? '' }
    }
    return { ...resolution, decision, term: resolution.proposed }
  })
}

/**
 * Whether one candidate has been dealt with (AC7).
 *
 * A decision is required, and a replacement additionally needs a term: "replace
 * this" with nothing typed yet would submit no skill while claiming the candidate
 * was handled.
 */
export function isSkillCandidateResolved(resolution: SkillResolution): boolean {
  if (resolution.decision === 'pending') {
    return false
  }
  return resolution.decision !== 'replaced' || resolution.term.trim() !== ''
}

/** Whether every candidate has been confirmed, replaced or discarded (AC7). */
export function allSkillCandidatesResolved(
  resolutions: readonly SkillResolution[],
): boolean {
  return resolutions.every(isSkillCandidateResolved)
}

/** The terms a resolved candidate list contributes to the confirmed body (AC9). */
export function confirmedSkillTerms(
  resolutions: readonly SkillResolution[],
): readonly string[] {
  return normalizeSkillTerms(
    resolutions
      .filter((resolution) => resolution.decision === 'confirmed' || resolution.decision === 'replaced')
      .map((resolution) => resolution.term),
  )
}

/**
 * Whether the confirmation request of AC9 may be issued (AC7, AC10).
 *
 * Three conjuncts, all necessary: there is a draft, it reported `ready`, and every
 * skill candidate has been decided. The submit control reads exactly this, so no
 * Job_Description persistence request exists for an unconfirmed draft — which is
 * what AC10 forbids.
 */
export function canConfirmExtraction(
  draft: ExtractionDraft | null | undefined,
  resolutions: readonly SkillResolution[],
): boolean {
  if (draft == null || draft.outcome !== 'ready') {
    return false
  }
  return allSkillCandidatesResolved(resolutions)
}
