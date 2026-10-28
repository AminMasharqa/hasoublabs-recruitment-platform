/**
 * The Review_Timeline filters, as URL query parameters, and the request query
 * they become (Requirement 15 AC8, AC11).
 *
 * Pure: no React, no Api_Client. The Admin timeline screen reads its filters out
 * of the address bar through {@link readTimelineFilters}, turns them into the
 * query of `GET /candidates/{candidate_id}/reviews` through
 * {@link timelineQueryParams}, and writes a changed filter set back through
 * {@link writeTimelineFilters}.
 *
 * ## Why the filters live in the address bar
 *
 * The applied filter set *is* the query string, so a filtered timeline is
 * linkable, reload-proof and navigable with the browser's back button, and the
 * empty state can offer "clear filters" without the screen deciding which
 * parameters count as a filter. Same arrangement as the Job_Description browse
 * screen, deliberately: two paginated, filtered lists that behaved differently
 * would be two things for a reader to learn.
 *
 * Applying a filter drops the cursor: a keyset position names a row in one
 * filtered result set and means nothing in another, so a changed filter set starts
 * a new walk from the first page.
 *
 * ## Why the date bounds are stored as calendar days
 *
 * The endpoint takes ISO-8601 UTC instants for `date_from` and `date_to`, but the
 * control an Admin uses is a date picker, which produces a calendar day. Storing
 * the day in the address and expanding it to an instant in
 * {@link timelineQueryParams} keeps the address readable and makes the bound
 * inclusive on both ends — the lower bound is the first instant of the day and the
 * upper bound the last, so "to 3 March" includes the Reviews created on 3 March
 * rather than none of them.
 *
 * Requirements: 15.7, 15.8, 15.9, 15.11.
 */

import { REVIEW_PAGE_SIZE } from './reviewRules'

// ── Parameter names ───────────────────────────────────────────────────────────

/** URL and query parameter names, spelled as the timeline endpoint spells them. */
export const TIMELINE_PARAM = {
  reviewerId: 'reviewer_id',
  jdId: 'jd_id',
  dateFrom: 'date_from',
  dateTo: 'date_to',
  /** Keyset cursor: the last returned `seq` (AC11). Not a filter. */
  afterSeq: 'after_seq',
  /** Keyset cursor complement: the last returned Review identifier. Not a filter. */
  afterId: 'after_id',
} as const

/** Every parameter that is a filter, i.e. everything except the cursor pair. */
export const TIMELINE_FILTER_PARAM_NAMES: readonly string[] = Object.freeze([
  TIMELINE_PARAM.reviewerId,
  TIMELINE_PARAM.jdId,
  TIMELINE_PARAM.dateFrom,
  TIMELINE_PARAM.dateTo,
])

// ── The filter set ────────────────────────────────────────────────────────────

/**
 * The four filters Requirement 15 AC8 asks for: reviewer, Job_Description, a
 * lower creation bound and an upper creation bound.
 *
 * The two bounds are calendar days (`YYYY-MM-DD`) as the date controls produce
 * them; blank means "unbounded".
 */
export interface TimelineFilters {
  readonly reviewerId: string
  readonly jdId: string
  readonly dateFrom: string
  readonly dateTo: string
}

/** No filter applied: the whole timeline from its first page. */
export const EMPTY_TIMELINE_FILTERS: TimelineFilters = Object.freeze({
  reviewerId: '',
  jdId: '',
  dateFrom: '',
  dateTo: '',
})

/** Anything that reads like a `URLSearchParams`. */
export interface ReadableSearchParams {
  get(name: string): string | null
}

function trimmed(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** A calendar day, or `''` for anything that is not one. */
function calendarDay(value: string | null | undefined): string {
  const day = trimmed(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : ''
}

/** Reads the applied filters out of a location's query string (AC8). */
export function readTimelineFilters(params: ReadableSearchParams): TimelineFilters {
  return {
    reviewerId: trimmed(params.get(TIMELINE_PARAM.reviewerId)),
    jdId: trimmed(params.get(TIMELINE_PARAM.jdId)),
    dateFrom: calendarDay(params.get(TIMELINE_PARAM.dateFrom)),
    dateTo: calendarDay(params.get(TIMELINE_PARAM.dateTo)),
  }
}

/** The keyset cursor the current location carries, if any (AC11). */
export interface TimelineCursor {
  readonly afterSeq: number
  readonly afterId: string | null
}

/**
 * Reads the keyset cursor out of a location's query string (AC11).
 *
 * `null` unless the address carries a finite `after_seq`: the `seq` is the cursor
 * and `after_id` only disambiguates rows sharing one, so an address with the
 * complement but no `seq` addresses no page.
 */
export function readTimelineCursor(params: ReadableSearchParams): TimelineCursor | null {
  const raw = trimmed(params.get(TIMELINE_PARAM.afterSeq))
  if (!/^\d+$/.test(raw)) {
    return null
  }
  const afterSeq = Number(raw)
  if (!Number.isFinite(afterSeq)) {
    return null
  }
  const afterId = trimmed(params.get(TIMELINE_PARAM.afterId))
  return { afterSeq, afterId: afterId === '' ? null : afterId }
}

/**
 * Serializes a filter set back into query parameters (AC8).
 *
 * Blank values are omitted, so the address carries only what is actually applied
 * and two equal filter sets always produce the same URL — which is also what makes
 * them one cache entry rather than two. The cursor is not written: applying a
 * filter starts a new keyset walk.
 */
export function writeTimelineFilters(filters: TimelineFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.reviewerId !== '') {
    params.set(TIMELINE_PARAM.reviewerId, filters.reviewerId)
  }
  if (filters.jdId !== '') {
    params.set(TIMELINE_PARAM.jdId, filters.jdId)
  }
  if (filters.dateFrom !== '') {
    params.set(TIMELINE_PARAM.dateFrom, filters.dateFrom)
  }
  if (filters.dateTo !== '') {
    params.set(TIMELINE_PARAM.dateTo, filters.dateTo)
  }
  return params
}

/**
 * The address of the next page: the applied filters plus the cursor (AC11).
 *
 * The filters are re-serialized rather than patched onto the current address, so
 * a stale cursor from the previous page cannot survive into the next one.
 */
export function writeTimelineCursor(
  filters: TimelineFilters,
  cursor: TimelineCursor,
): URLSearchParams {
  const params = writeTimelineFilters(filters)
  params.set(TIMELINE_PARAM.afterSeq, String(cursor.afterSeq))
  if (cursor.afterId !== null && cursor.afterId !== '') {
    params.set(TIMELINE_PARAM.afterId, cursor.afterId)
  }
  return params
}

/**
 * Whether any filter is applied (Requirement 21 AC7).
 *
 * Drives the empty state's clear-filter control: "no Reviews yet" and "no Review
 * matches what you asked for" are different outcomes, and only the second has a
 * filter to clear.
 */
export function hasActiveTimelineFilters(filters: TimelineFilters): boolean {
  return (
    filters.reviewerId !== '' ||
    filters.jdId !== '' ||
    filters.dateFrom !== '' ||
    filters.dateTo !== ''
  )
}

// ── Calendar day → ISO-8601 UTC instant ───────────────────────────────────────

/** The first instant of a calendar day, in UTC. */
export function startOfDayUtc(day: string): string | null {
  return calendarDay(day) === '' ? null : `${day}T00:00:00.000Z`
}

/**
 * The last instant of a calendar day, in UTC.
 *
 * Millisecond precision, so an upper bound of "3 March" includes every Review
 * created on 3 March. Expressing it as the start of 4 March would exclude or
 * include a Review created exactly at midnight depending on whether the
 * Backend_Api's comparison is inclusive, which the contract does not say.
 */
export function endOfDayUtc(day: string): string | null {
  return calendarDay(day) === '' ? null : `${day}T23:59:59.999Z`
}

// ── The request query ─────────────────────────────────────────────────────────

/** The query of one `GET /candidates/{candidate_id}/reviews` request. */
export interface TimelineQueryParams {
  readonly limit: number
  readonly reviewer_id?: string
  readonly jd_id?: string
  readonly date_from?: string
  readonly date_to?: string
  readonly after_seq?: number
  readonly after_id?: string
}

/**
 * Builds the query of the Admin timeline read (AC8, AC11).
 *
 * Every applied filter becomes a query parameter (AC8), the page size is the
 * shared 20-row bound (AC11), and a cursor contributes `after_seq` with its
 * `after_id` complement. Unapplied filters are omitted rather than sent blank.
 */
export function timelineQueryParams(
  filters: TimelineFilters,
  cursor: TimelineCursor | null = null,
): TimelineQueryParams {
  const dateFrom = startOfDayUtc(filters.dateFrom)
  const dateTo = endOfDayUtc(filters.dateTo)
  return {
    limit: REVIEW_PAGE_SIZE,
    ...(filters.reviewerId === '' ? {} : { reviewer_id: filters.reviewerId }),
    ...(filters.jdId === '' ? {} : { jd_id: filters.jdId }),
    ...(dateFrom === null ? {} : { date_from: dateFrom }),
    ...(dateTo === null ? {} : { date_to: dateTo }),
    ...(cursor === null ? {} : { after_seq: cursor.afterSeq }),
    ...(cursor?.afterId == null || cursor.afterId === '' ? {} : { after_id: cursor.afterId }),
  }
}

/** The query of one `GET /candidates/{candidate_id}/reviews/mine` request (AC9, AC11). */
export interface OwnTimelineQueryParams {
  readonly limit: number
  readonly after_seq?: number
}

/**
 * Builds the Senior own-timeline query (AC9, AC11).
 *
 * The endpoint declares no filters and no `after_id`: a Senior's own Reviews for
 * one Candidate are already scoped to that Senior, and the page is keyed on `seq`
 * alone. Sending parameters it does not declare would earn a 422, so the filter
 * controls of AC8 are not offered on that screen at all.
 */
export function ownTimelineQueryParams(cursor: TimelineCursor | null = null): OwnTimelineQueryParams {
  return {
    limit: REVIEW_PAGE_SIZE,
    ...(cursor === null ? {} : { after_seq: cursor.afterSeq }),
  }
}
