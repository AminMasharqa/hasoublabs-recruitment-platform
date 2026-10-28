/**
 * The pure logic of the Review slice: the draft a form holds, the request body it
 * becomes, the ascending order a timeline is rendered in, the correction links
 * between Reviews and the keyset cursor of a page.
 *
 * No React, no Api_Client, no i18next — so every rule Requirement 15 states about
 * a Review can be asserted without a renderer, and so the two timeline screens
 * (Admin and Senior) share one implementation of each rule rather than two.
 *
 * Requirement 15:
 * - AC1  four integer 1–5 ratings, a 1–2000 character assessment and an optional
 *        Job_Description association ({@link REVIEW_RATING_PATHS},
 *        {@link validateReviewDraft}).
 * - AC2  the collected values as the `POST /candidates/{candidate_id}/reviews`
 *        body ({@link submitReviewBody}).
 * - AC4  a correction opens the form pre-filled with the prior values and submits
 *        the prior identifier in `corrects_review_id` ({@link draftFromReview},
 *        {@link submitReviewBody}).
 * - AC5  nothing here produces an update or a delete body: the only request shape
 *        this module can build is an append.
 * - AC6  {@link correctionLinks} pairs a correcting Review with the one it
 *        corrects, in both directions, so either can render the indicator.
 * - AC7  {@link orderTimelineAscending} renders ascending creation order
 *        regardless of the order a page arrived in.
 * - AC11 {@link nextReviewPage} derives the keyset cursor from the last returned
 *        `seq` ({@link REVIEW_PAGE_SIZE} rows per page).
 *
 * ## Why the draft holds text rather than numbers
 *
 * A rating held as `number | null` cannot represent "the field is empty" and "the
 * user typed something that is not a rating" as different states — both collapse
 * to `null`, and the entered value is lost on the way to a 422 that Requirement 15
 * AC3 says must retain it. So the draft holds exactly what the controls hold,
 * {@link reviewDraftValues} performs the one conversion, and the Form_Validator
 * reports a non-integer rather than this module discarding it. Same reasoning as
 * the profile editor's year inputs.
 */

import type { components } from '../../api/generated/schema'
import { BOUNDS, SCHEMAS, validateSchema, type ValidationIssue } from '../../forms/validators'
import { DEFAULT_PAGE_SIZE, deriveLastIdCursor, type NextPage } from '../../lib/cursor'

// ── Contract types ────────────────────────────────────────────────────────────

/** A Review, exactly as every review endpoint returns it. */
export type Review = components['schemas']['ReviewDTO']

/** The `POST /candidates/{candidate_id}/reviews` body. */
export type SubmitReviewBody = components['schemas']['SubmitReviewRequest']

// ── Bounds and field paths ────────────────────────────────────────────────────

/** Requirement 15 AC11: at most 20 Reviews per page. */
export const REVIEW_PAGE_SIZE = DEFAULT_PAGE_SIZE

/** Inclusive rating bounds, mirrored from `SubmitReviewRequest` (AC1). */
export const RATING_BOUNDS = BOUNDS.rating

/** Inclusive assessment length bounds, mirrored from the contract (AC1). */
export const ASSESSMENT_BOUNDS = BOUNDS.review.assessment

/**
 * The four rating members, in the order Requirement 15 AC1 names them and in the
 * order the form renders them.
 *
 * Rendering order matters: `forms/violations.ts` reports the *first* affected
 * input in registration order, and that is where focus lands on a 422 (Req 20
 * AC6), so it has to be the first one a person reaches.
 */
export const REVIEW_RATING_PATHS = Object.freeze([
  'rating_technical',
  'rating_communication',
  'rating_culture_fit',
  'rating_overall',
] as const)

/** One of the four rating members. */
export type ReviewRatingPath = (typeof REVIEW_RATING_PATHS)[number]

/** Path of the free-text assessment input. */
export const ASSESSMENT_PATH = 'assessment'

/** Path of the optional Job_Description association. */
export const JD_PATH = 'jd_id'

// ── The draft ─────────────────────────────────────────────────────────────────

/**
 * The review form's values: exactly what the controls hold, all text.
 *
 * `jdId` carries the optional Job_Description association of AC1; blank means "no
 * association", which is sent as an omitted member rather than as an explicit
 * `null` so the Backend_Api sees the same body a form without the field would
 * send.
 */
export interface ReviewDraft {
  readonly rating_technical: string
  readonly rating_communication: string
  readonly rating_culture_fit: string
  readonly rating_overall: string
  readonly assessment: string
  readonly jd_id: string
}

/** An untouched review form. */
export const EMPTY_REVIEW_DRAFT: ReviewDraft = Object.freeze({
  rating_technical: '',
  rating_communication: '',
  rating_culture_fit: '',
  rating_overall: '',
  assessment: '',
  jd_id: '',
})

/** The text a rating renders as, blank for an absent or non-finite value. */
function ratingText(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

/** The text an optional string member renders as. */
function optionalText(value: string | null | undefined): string {
  return typeof value === 'string' ? value : ''
}

/**
 * The draft a correction opens with: the prior Review's values (AC4).
 *
 * Every collected member is carried over — the four ratings, the assessment and
 * the Job_Description association — because a correction restates the whole
 * Review; the Backend_Api appends a new one rather than patching the old.
 * `corrects_review_id` is deliberately *not* part of the draft: it is not a value
 * the user edits, it is the identity of the Review being corrected, and it is
 * supplied to {@link submitReviewBody} by the screen that opened the correction.
 *
 * `null`/`undefined` yields {@link EMPTY_REVIEW_DRAFT}, so the same helper serves
 * the plain submission form.
 */
export function draftFromReview(review: Review | null | undefined): ReviewDraft {
  if (review == null) {
    return EMPTY_REVIEW_DRAFT
  }
  return {
    rating_technical: ratingText(review.rating_technical),
    rating_communication: ratingText(review.rating_communication),
    rating_culture_fit: ratingText(review.rating_culture_fit),
    rating_overall: ratingText(review.rating_overall),
    // Byte-identical to the stored value: no trimming, no normalization (Req 19
    // AC10, AC11).
    assessment: optionalText(review.assessment),
    jd_id: optionalText(review.jd_id),
  }
}

/**
 * Parses a rating input.
 *
 * `null` for a blank field — nothing has been entered — and `NaN` for a value
 * that is not an integer at all, which the Form_Validator reports as out of range
 * rather than this function silently dropping it.
 */
export function parseRatingInput(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') {
    return null
  }
  return /^[+-]?\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN
}

/**
 * The draft as the values the Form_Validator checks.
 *
 * Ratings become numbers (or `NaN`/`null`, see {@link parseRatingInput}); the
 * assessment is passed through untouched, because trimming it here would both
 * change what the length bound is applied to and rewrite Arabic or Hebrew text
 * the user entered (Req 19 AC11).
 */
export function reviewDraftValues(draft: ReviewDraft): Readonly<Record<string, unknown>> {
  return {
    rating_technical: parseRatingInput(draft.rating_technical),
    rating_communication: parseRatingInput(draft.rating_communication),
    rating_culture_fit: parseRatingInput(draft.rating_culture_fit),
    rating_overall: parseRatingInput(draft.rating_overall),
    assessment: draft.assessment,
  }
}

/**
 * Applies the contract's bounds to a draft (AC1).
 *
 * Runs `SCHEMAS.review`, which mirrors `SubmitReviewRequest` — four integer 1–5
 * ratings and a 1–2000 character assessment — so the numbers live in
 * `forms/validators.ts` and are not restated here. Every failing field is
 * reported, not just the first, so the form renders them simultaneously
 * (Req 22 AC9).
 *
 * An aid only: the Backend_Api remains the authoritative validator (Req 22 AC12),
 * and a draft that passes here can still come back with a 422 the form places the
 * same way.
 */
export function validateReviewDraft(draft: ReviewDraft): readonly ValidationIssue[] {
  return validateSchema(SCHEMAS.review, reviewDraftValues(draft))
}

/**
 * Builds the `POST /candidates/{candidate_id}/reviews` body (AC2, AC4).
 *
 * The four ratings and the assessment are always sent. The optional members are
 * sent only when they carry a value: a blank Job_Description association and an
 * absent correction target are omitted rather than sent as `null`, so the request
 * says nothing about a member the user did not fill in.
 *
 * `correctsReviewId` is the prior Review's identifier when the form was opened by
 * a correction control (AC4). There is no other request shape this module can
 * build — no update, no delete (AC5).
 */
export function submitReviewBody(
  draft: ReviewDraft,
  correctsReviewId?: string | null,
): SubmitReviewBody {
  const jdId = draft.jd_id.trim()
  const corrects = typeof correctsReviewId === 'string' ? correctsReviewId.trim() : ''
  return {
    rating_technical: parseRatingInput(draft.rating_technical) as number,
    rating_communication: parseRatingInput(draft.rating_communication) as number,
    rating_culture_fit: parseRatingInput(draft.rating_culture_fit) as number,
    rating_overall: parseRatingInput(draft.rating_overall) as number,
    assessment: draft.assessment,
    ...(jdId === '' ? {} : { jd_id: jdId }),
    ...(corrects === '' ? {} : { corrects_review_id: corrects }),
  }
}

// ── Timeline ordering (AC7) ───────────────────────────────────────────────────

/**
 * The Reviews of a page in ascending creation order (AC7).
 *
 * `(created_at, seq)` is the total order the Backend_Api documents, and `seq` is
 * the per-Candidate monotonic sequence that breaks a tie between two Reviews
 * created in the same instant. Re-applied client-side rather than trusted: the
 * ascending order is what AC7 requires of the *rendering*, and a page that
 * arrived in another order — or a cache entry a correction was appended to — must
 * still render ascending.
 *
 * Stable: two Reviews that compare equal keep their relative position, so the
 * order never depends on the sort implementation.
 */
export function orderTimelineAscending(reviews: readonly Review[] | null | undefined): Review[] {
  return [...(reviews ?? [])].sort((left, right) => {
    const byCreation = Date.parse(left.created_at) - Date.parse(right.created_at)
    if (Number.isFinite(byCreation) && byCreation !== 0) {
      return byCreation
    }
    return left.seq - right.seq
  })
}

// ── Correction links (AC6) ────────────────────────────────────────────────────

/** How one Review relates to the correction chain around it (AC6). */
export interface CorrectionLink {
  /** The Review this one corrects, when the page carries it. */
  readonly corrects: Review | null
  /**
   * The identifier this Review names as corrected, whether or not the page
   * carries that Review.
   *
   * Non-null on every correcting Review, so the indicator is rendered even when
   * the corrected Review sits on an earlier page.
   */
  readonly correctsId: string | null
  /** The Reviews that correct this one, in the order they were rendered. */
  readonly correctedBy: readonly Review[]
}

/** No correction either way. */
const NO_CORRECTION: CorrectionLink = Object.freeze({
  corrects: null,
  correctsId: null,
  correctedBy: Object.freeze([]) as readonly Review[],
})

/** The correction links of a set of Reviews, addressable by Review identifier. */
export interface CorrectionIndex {
  /** The link of one Review; never `null`, so a caller needs no fallback. */
  linkFor(reviewId: string): CorrectionLink
}

/**
 * Builds the correction index of a rendered page (AC6).
 *
 * A Review carrying `corrects_review_id` is linked to the Review it corrects when
 * that Review is on the page, and the corrected Review is linked back to it. When
 * the corrected Review is *not* on the page — it sits earlier in the timeline, or
 * a filter excluded it — the identifier is still reported, so the indicator names
 * the corrected Review rather than silently disappearing.
 */
export function correctionLinks(reviews: readonly Review[] | null | undefined): CorrectionIndex {
  const present = new Map<string, Review>()
  for (const review of reviews ?? []) {
    present.set(review.id, review)
  }

  const links = new Map<string, { corrects: Review | null; correctsId: string | null; correctedBy: Review[] }>()
  const entry = (id: string) => {
    const existing = links.get(id)
    if (existing !== undefined) {
      return existing
    }
    const created = { corrects: null as Review | null, correctsId: null as string | null, correctedBy: [] as Review[] }
    links.set(id, created)
    return created
  }

  for (const review of reviews ?? []) {
    const correctsId =
      typeof review.corrects_review_id === 'string' && review.corrects_review_id.trim() !== ''
        ? review.corrects_review_id
        : null
    if (correctsId === null) {
      continue
    }
    const self = entry(review.id)
    self.correctsId = correctsId
    self.corrects = present.get(correctsId) ?? null
    if (self.corrects !== null) {
      entry(correctsId).correctedBy.push(review)
    }
  }

  return {
    linkFor(reviewId: string): CorrectionLink {
      const found = links.get(reviewId)
      return found === undefined ? NO_CORRECTION : found
    },
  }
}

/** Whether a Review carries a correction target (AC6). */
export function isCorrection(review: Review): boolean {
  return typeof review.corrects_review_id === 'string' && review.corrects_review_id.trim() !== ''
}

/**
 * DOM id of one Review's rendered card (AC6).
 *
 * Lives here rather than beside the card so the correction indicator and the card
 * derive the anchor target from one function, and so the card file exports
 * components only.
 */
export function reviewElementId(reviewId: string): string {
  return `review-${reviewId}`
}

// ── Keyset pagination (AC11) ──────────────────────────────────────────────────

/**
 * The keyset cursor of the next page: the last returned `seq` (AC11).
 *
 * Both timeline endpoints answer with a bare JSON array and advertise no
 * continuation metadata, so a further page is inferred from a full page having
 * been returned — the `last-id` variant of `lib/cursor.ts` (Assumption 8), with
 * `seq` as the cursor instead of an identifier because that is the cursor these
 * endpoints accept (`after_seq`).
 */
export function nextReviewPage(
  reviews: readonly Review[] | null | undefined,
  limit: number = REVIEW_PAGE_SIZE,
): NextPage<number> {
  return deriveLastIdCursor(reviews, { limit, cursorOf: (review) => review.seq })
}

/**
 * The `after_id` complement of a `seq` cursor, for the Admin endpoint that
 * accepts both.
 *
 * The Backend_Api documents `after_id` as the UUID complement that disambiguates
 * two rows sharing a `seq`; sending the last row's identifier alongside its `seq`
 * is what makes the walk total.
 */
export function lastReviewId(reviews: readonly Review[] | null | undefined): string | null {
  const items = reviews ?? []
  const last = items[items.length - 1]
  return last === undefined ? null : last.id
}
