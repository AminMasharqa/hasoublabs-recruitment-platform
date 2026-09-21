/**
 * The report filters, as URL query parameters and as request members
 * (Requirement 18 AC2, AC4, AC6).
 *
 * Pure: no React, no Api_Client. Both report screens read their filters out of
 * the address bar through {@link readReportFilters}, turn them into the query of
 * `GET /api/v1/admin/reports/activity` through {@link activityQueryParams} and
 * into the body of `POST /api/v1/admin/exports/{entity_type}` through
 * {@link exportRequestBody}, and write a changed set back through
 * {@link writeReportFilters}.
 *
 * Keeping the round trip here is what makes AC6's "the currently applied
 * date-range and Job_Description filters" a single expression rather than two
 * call sites that could disagree: the report read and the export request are
 * built from the same value by two functions in this module.
 *
 * ## Why the controls carry a calendar date and the request carries an instant
 *
 * `date_from` and `date_to` are documented by the contract as ISO-8601 UTC
 * bounds, while a date control yields a calendar date (`YYYY-MM-DD`). A bare date
 * would land on midnight, which would silently exclude everything that happened
 * on the upper-bound day. So the address bar carries the calendar date the user
 * picked — short, linkable, and what the control reads back — and the request
 * carries the UTC instants that bound those days inclusively: the start of
 * `date_from` and the last millisecond of `date_to`. UTC stays the authoritative
 * zone throughout (Requirement 19 AC12); no host-local conversion happens
 * anywhere.
 *
 * A value that is not a real calendar date — a hand-edited address, a stale link
 * — is dropped rather than forwarded, so a crafted address produces an
 * unfiltered report instead of a 422.
 *
 * Requirements: 18.2, 18.4, 18.6.
 */

import { DEFAULT_PAGE_SIZE, deriveTokenCursor, type NextPage, type TokenPagedResponse } from '../../lib/cursor'

// ── Parameter names ───────────────────────────────────────────────────────────

/**
 * URL and query parameter names, spelled as the report endpoints spell them.
 *
 * `after_id` is both the address-bar name and the query name of the
 * candidate-progress cursor, which is what AC4 asks for: the `next_cursor` value
 * of the previous page is sent as `after_id`.
 */
export const REPORT_PARAM = {
  dateFrom: 'date_from',
  dateTo: 'date_to',
  jdId: 'jd_id',
  /** The `next_cursor` of the previous candidate-progress page (AC4). Not a filter. */
  cursor: 'after_id',
} as const

/** Every parameter that is a filter, i.e. everything except the cursor. */
export const REPORT_FILTER_PARAM_NAMES: readonly string[] = [
  REPORT_PARAM.dateFrom,
  REPORT_PARAM.dateTo,
  REPORT_PARAM.jdId,
]

// ── The filter set ────────────────────────────────────────────────────────────

/**
 * The filters Requirement 18 AC2 asks for: a date range and a Job_Description.
 *
 * `dateFrom` and `dateTo` are calendar dates in `YYYY-MM-DD` form, or the empty
 * string when unapplied; `jdId` is a Job_Description identifier, or the empty
 * string.
 */
export interface ReportFilters {
  readonly dateFrom: string
  readonly dateTo: string
  readonly jdId: string
}

/** No filter applied: the unfiltered report. */
export const EMPTY_REPORT_FILTERS: ReportFilters = Object.freeze({
  dateFrom: '',
  dateTo: '',
  jdId: '',
})

/** Anything that reads like a `URLSearchParams`. */
export interface ReadableSearchParams {
  get(name: string): string | null
}

function trimmed(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** The `YYYY-MM-DD` shape a date control produces. */
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * A usable calendar date, or the empty string.
 *
 * Checks the shape *and* that the date exists: `2024-02-31` matches the pattern
 * but denotes no day, and round-tripping it through `Date` is what catches that.
 */
export function calendarDate(value: string | null | undefined): string {
  const candidate = trimmed(value)
  if (!CALENDAR_DATE.test(candidate)) {
    return ''
  }
  const parsed = new Date(`${candidate}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) {
    return ''
  }
  return parsed.toISOString().slice(0, 10) === candidate ? candidate : ''
}

/** Reads the applied filters out of a location's query string (AC2). */
export function readReportFilters(params: ReadableSearchParams): ReportFilters {
  return {
    dateFrom: calendarDate(params.get(REPORT_PARAM.dateFrom)),
    dateTo: calendarDate(params.get(REPORT_PARAM.dateTo)),
    jdId: trimmed(params.get(REPORT_PARAM.jdId)),
  }
}

/** The candidate-progress cursor the current location carries, if any (AC4). */
export function readProgressCursor(params: ReadableSearchParams): string | null {
  const cursor = trimmed(params.get(REPORT_PARAM.cursor))
  return cursor === '' ? null : cursor
}

/**
 * Serializes a filter set back into query parameters (AC2).
 *
 * Unapplied values are omitted, so the address carries only what is actually
 * applied and two equal filter sets produce the same URL. The cursor is
 * deliberately not written: a cursor names a position in one result set, so
 * applying a filter starts the candidate-progress walk again from the first page.
 */
export function writeReportFilters(filters: ReportFilters): URLSearchParams {
  const params = new URLSearchParams()
  const dateFrom = calendarDate(filters.dateFrom)
  const dateTo = calendarDate(filters.dateTo)
  if (dateFrom !== '') {
    params.set(REPORT_PARAM.dateFrom, dateFrom)
  }
  if (dateTo !== '') {
    params.set(REPORT_PARAM.dateTo, dateTo)
  }
  const jdId = trimmed(filters.jdId)
  if (jdId !== '') {
    params.set(REPORT_PARAM.jdId, jdId)
  }
  return params
}

/** Whether any filter is applied (Requirement 21 AC7). */
export function hasActiveReportFilters(filters: ReportFilters): boolean {
  return (
    calendarDate(filters.dateFrom) !== '' ||
    calendarDate(filters.dateTo) !== '' ||
    trimmed(filters.jdId) !== ''
  )
}

/**
 * Whether the applied range runs backwards.
 *
 * Reported rather than corrected: the user asked for it, the Backend_Api is the
 * authority on what it accepts, and silently swapping the bounds would answer a
 * question nobody asked. The screen renders a hint beside the controls.
 */
export function isReversedRange(filters: ReportFilters): boolean {
  const from = calendarDate(filters.dateFrom)
  const to = calendarDate(filters.dateTo)
  return from !== '' && to !== '' && from > to
}

// ── Instants ──────────────────────────────────────────────────────────────────

/** The first instant of a calendar day, in UTC. */
export function startOfDayUtc(date: string): string {
  return `${date}T00:00:00.000Z`
}

/** The last instant of a calendar day, in UTC, so the bound includes that day. */
export function endOfDayUtc(date: string): string {
  return `${date}T23:59:59.999Z`
}

// ── Request shapes ────────────────────────────────────────────────────────────

/** The query of one `GET /api/v1/admin/reports/activity` request. */
export interface ActivityQueryParams {
  readonly date_from?: string
  readonly date_to?: string
  readonly jd_id?: string
}

/**
 * Builds the query of the activity report (AC1, AC2).
 *
 * Every applied value becomes a query parameter; an unapplied one is omitted
 * rather than sent empty, so the request carries exactly what the user asked for
 * and two equal filter sets produce one cache key instead of two.
 */
export function activityQueryParams(filters: ReportFilters): ActivityQueryParams {
  const dateFrom = calendarDate(filters.dateFrom)
  const dateTo = calendarDate(filters.dateTo)
  const jdId = trimmed(filters.jdId)
  return {
    ...(dateFrom === '' ? {} : { date_from: startOfDayUtc(dateFrom) }),
    ...(dateTo === '' ? {} : { date_to: endOfDayUtc(dateTo) }),
    ...(jdId === '' ? {} : { jd_id: jdId }),
  }
}

/** The query of one `GET /api/v1/admin/reports/candidate-progress` request. */
export interface ProgressQueryParams {
  readonly limit: number
  readonly after_id?: string
}

/**
 * Builds the query of the candidate-progress report (AC3, AC4).
 *
 * The page size is the shared 20-row bound and the cursor is forwarded verbatim
 * as `after_id`, because this endpoint's `next_cursor` *is* an account
 * identifier — unlike the job browse token, there is nothing to decode.
 *
 * The date range and the Job_Description filter are deliberately absent: the
 * endpoint declares neither, so sending them would be a 422. AC2 scopes the two
 * controls to the activity report, and AC6 to the export.
 */
export function progressQueryParams(cursor: string | null = null): ProgressQueryParams {
  const token = trimmed(cursor)
  return {
    limit: DEFAULT_PAGE_SIZE,
    ...(token === '' ? {} : { after_id: token }),
  }
}

/**
 * The next candidate-progress page (AC4).
 *
 * The response advertises `has_next` with a `next_cursor`, which is exactly the
 * shape `deriveTokenCursor` answers, so the next-page control is enabled only
 * while there is a token to send.
 */
export function nextProgressPage(page: TokenPagedResponse | null | undefined): NextPage<string> {
  return deriveTokenCursor(page)
}

/** The body of one `POST /api/v1/admin/exports/{entity_type}` request. */
export interface ExportRequestBody {
  readonly date_from?: string | null
  readonly date_to?: string | null
  readonly jd_id?: string | null
}

/**
 * Builds the export request body from the applied filters (AC6).
 *
 * The same instants the activity report is read with, so an export is the
 * offline form of the report on screen rather than of a differently bounded one.
 */
export function exportRequestBody(filters: ReportFilters): ExportRequestBody {
  const query = activityQueryParams(filters)
  return {
    ...(query.date_from === undefined ? {} : { date_from: query.date_from }),
    ...(query.date_to === undefined ? {} : { date_to: query.date_to }),
    ...(query.jd_id === undefined ? {} : { jd_id: query.jd_id }),
  }
}
