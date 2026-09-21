/**
 * The Audit_Log search filters, as URL query parameters (Requirement 17 AC2–AC4).
 *
 * Pure: no React, no Api_Client. The Audit_Log_Viewer reads its filters out of
 * the address bar through {@link readAuditFilters}, turns them into the query of
 * `GET /admin/audit` through {@link auditQueryParams}, and writes a changed
 * filter set back through {@link writeAuditFilters}. Keeping that round trip in
 * one testable module is what makes a filtered audit search linkable and
 * reload-proof, and what lets the empty state offer "clear filters" without the
 * screen having to know which parameters count as a filter.
 *
 * ## Why the URL parameter names are the endpoint's parameter names
 *
 * `actor_account_id`, `action`, `entity_type`, `entity_id`, `from_dt` and `to_dt`
 * are spelled exactly as `GET /admin/audit` spells them, so the address bar and
 * the request carry the same vocabulary and a reviewer can read one off the
 * other. `after_id` is the same: it is not a filter but the keyset cursor, and
 * the endpoint takes the `meta.next_after_id` of the previous page in it verbatim
 * (AC3), so no decoding step stands between the response and the next request.
 *
 * ## Why the time bounds are UTC and canonicalized
 *
 * Every Audit_Log timestamp is authoritative in UTC (AC9), so a bound typed into
 * this screen is read as UTC wall time rather than as the viewer's local time —
 * the alternative is a search whose meaning changes with the reader's machine,
 * which is indefensible on an accountability surface. {@link normalizeTimeBound}
 * is what makes that unambiguous: a value carrying no zone designator gets `Z`
 * appended before it is parsed, and the result is stored and sent as an ISO-8601
 * UTC instant with milliseconds. A value that names no instant at all — a
 * hand-edited URL, a half-typed bound — resolves to "no bound" rather than being
 * forwarded, so a crafted address produces an unfiltered search instead of a 422.
 *
 * Requirements: 17.2, 17.3, 17.4.
 */

import { parseInstant } from '../../i18n/formatting'
import {
  DEFAULT_PAGE_SIZE,
  deriveMetaCursor,
  type MetaPagedResponse,
  type NextPage,
} from '../../lib/cursor'

// ── Parameter names ───────────────────────────────────────────────────────────

/** URL and query parameter names, spelled as `GET /admin/audit` spells them. */
export const AUDIT_PARAM = {
  actorAccountId: 'actor_account_id',
  action: 'action',
  entityType: 'entity_type',
  entityId: 'entity_id',
  from: 'from_dt',
  to: 'to_dt',
  /** The `meta.next_after_id` of the previous page (AC3). Not a filter. */
  cursor: 'after_id',
} as const

/** Every parameter that is a filter, i.e. everything except the cursor. */
export const AUDIT_FILTER_PARAM_NAMES: readonly string[] = Object.freeze([
  AUDIT_PARAM.actorAccountId,
  AUDIT_PARAM.action,
  AUDIT_PARAM.entityType,
  AUDIT_PARAM.entityId,
  AUDIT_PARAM.from,
  AUDIT_PARAM.to,
])

// ── The filter set ────────────────────────────────────────────────────────────

/**
 * The filters Requirement 17 AC2 asks for: actor account, action, entity type,
 * entity identifier, a lower time bound and an upper time bound.
 *
 * Every member is a string, and the empty string means "not applied". The two
 * bounds hold an ISO-8601 UTC instant, canonicalized by
 * {@link normalizeTimeBound}; the other four are free text, because the contract
 * declares them as free-form strings rather than as enumerations and the
 * Backend_Api is the authority on which values exist.
 */
export interface AuditFilters {
  readonly actorAccountId: string
  readonly action: string
  readonly entityType: string
  readonly entityId: string
  /** Lower bound, inclusive as the Backend_Api applies it. ISO-8601 UTC or `''`. */
  readonly from: string
  /** Upper bound, as the Backend_Api applies it. ISO-8601 UTC or `''`. */
  readonly to: string
}

/** No filter applied: the unfiltered first page of the Audit_Log. */
export const EMPTY_AUDIT_FILTERS: AuditFilters = Object.freeze({
  actorAccountId: '',
  action: '',
  entityType: '',
  entityId: '',
  from: '',
  to: '',
})

/** Anything that reads like a `URLSearchParams`. */
export interface ReadableSearchParams {
  get(name: string): string | null
}

function trimmed(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** A timestamp with no zone designator, which this module reads as UTC. */
const ZONELESS_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?$/

/**
 * Canonicalizes a time-bound value into an ISO-8601 UTC instant, or `''`.
 *
 * A value carrying no zone designator is read as UTC — `2024-04-01T08:30` means
 * 08:30 UTC, not 08:30 wherever the reader happens to be — because the Audit_Log
 * is authoritative in UTC (AC9) and `new Date('2024-04-01T08:30')` would
 * otherwise resolve it against the host time zone, making the same URL mean
 * different searches on two machines.
 *
 * Anything that names no instant yields `''`, i.e. no bound.
 */
export function normalizeTimeBound(raw: string | null | undefined): string {
  const value = trimmed(raw)
  if (value === '') {
    return ''
  }
  const zoned = ZONELESS_TIMESTAMP.test(value) ? `${value.replace(' ', 'T')}Z` : value
  return parseInstant(zoned)?.toISOString() ?? ''
}

/**
 * The value an `<input type="datetime-local">` carries for a bound, in UTC.
 *
 * Taken from the ISO instant's UTC fields, so the control shows the same wall time
 * the bound denotes and round-trips through {@link normalizeTimeBound} unchanged.
 *
 * The seconds are included only when the bound actually carries some. A bound of
 * `…T23:59:59Z` rendered to the minute would be silently rounded down to
 * `…T23:59:00Z` the next time the form was submitted — an upper bound quietly
 * losing 59 seconds of the record it was meant to include — while a bound on the
 * minute reads better without a trailing `:00`.
 */
export function timeBoundInputValue(bound: string): string {
  const instant = parseInstant(normalizeTimeBound(bound))
  if (instant === null) {
    return ''
  }
  const iso = instant.toISOString()
  const seconds = instant.getUTCSeconds() + instant.getUTCMilliseconds()
  return seconds === 0 ? iso.slice(0, 16) : iso.slice(0, 19)
}

/** Reads the applied filters out of a location's query string (AC2). */
export function readAuditFilters(params: ReadableSearchParams): AuditFilters {
  return {
    actorAccountId: trimmed(params.get(AUDIT_PARAM.actorAccountId)),
    action: trimmed(params.get(AUDIT_PARAM.action)),
    entityType: trimmed(params.get(AUDIT_PARAM.entityType)),
    entityId: trimmed(params.get(AUDIT_PARAM.entityId)),
    from: normalizeTimeBound(params.get(AUDIT_PARAM.from)),
    to: normalizeTimeBound(params.get(AUDIT_PARAM.to)),
  }
}

/**
 * The keyset cursor the current location carries, if any (AC3).
 *
 * `after_id` is an Audit_Log entry identifier, so only a finite integer counts; a
 * non-numeric value is a defective address and yields the first page rather than
 * a request the Backend_Api would refuse.
 */
export function readAuditCursor(params: ReadableSearchParams): number | null {
  const raw = trimmed(params.get(AUDIT_PARAM.cursor))
  if (!/^\d+$/.test(raw)) {
    return null
  }
  const parsed = Number.parseInt(raw, 10)
  return Number.isSafeInteger(parsed) ? parsed : null
}

/**
 * Serializes a filter set back into query parameters (AC2).
 *
 * Blank and absent values are omitted, so the address bar carries only what is
 * actually applied and two equal filter sets always produce the same URL. The
 * cursor is deliberately not written: applying a filter starts a new keyset walk,
 * because an `after_id` taken from a differently filtered page addresses a
 * different result set.
 */
export function writeAuditFilters(filters: AuditFilters): URLSearchParams {
  const params = new URLSearchParams()
  const set = (name: string, value: string): void => {
    if (value !== '') {
      params.set(name, value)
    }
  }
  set(AUDIT_PARAM.actorAccountId, filters.actorAccountId)
  set(AUDIT_PARAM.action, filters.action)
  set(AUDIT_PARAM.entityType, filters.entityType)
  set(AUDIT_PARAM.entityId, filters.entityId)
  set(AUDIT_PARAM.from, normalizeTimeBound(filters.from))
  set(AUDIT_PARAM.to, normalizeTimeBound(filters.to))
  return params
}

/**
 * Whether any filter is applied (Requirement 21 AC7).
 *
 * Drives the empty state's clear-filter control: "the Audit_Log holds nothing"
 * and "nothing matches what you asked for" are different outcomes, and only the
 * second one has a filter to clear.
 */
export function hasActiveAuditFilters(filters: AuditFilters): boolean {
  return (
    filters.actorAccountId !== '' ||
    filters.action !== '' ||
    filters.entityType !== '' ||
    filters.entityId !== '' ||
    normalizeTimeBound(filters.from) !== '' ||
    normalizeTimeBound(filters.to) !== ''
  )
}

// ── The next page (AC3, AC4) ──────────────────────────────────────────────────

/**
 * The next page of an Audit_Log search response (AC3, AC4).
 *
 * Delegates to the shared `meta.has_more` / `meta.next_after_id` derivation, so
 * "is there a further page, and which cursor addresses it" is answered in one
 * place for every endpoint that advertises pagination this way. A response that
 * claims a further page without a usable continuation id yields no next page, so
 * the control stays disabled rather than issuing a cursor-less repeat of the page
 * already on screen.
 */
export function nextAuditPage(page: MetaPagedResponse | null | undefined): NextPage<number> {
  return deriveMetaCursor(page)
}

// ── The request query ─────────────────────────────────────────────────────────

/** The query of one `GET /api/v1/admin/audit` request. */
export interface AuditQueryParams {
  readonly page_size: number
  readonly actor_account_id?: string
  readonly action?: string
  readonly entity_type?: string
  readonly entity_id?: string
  readonly from_dt?: string
  readonly to_dt?: string
  readonly after_id?: number
}

/**
 * Builds the query of `GET /api/v1/admin/audit` (AC2, AC3).
 *
 * Every applied filter becomes a query parameter (AC2), the page size is the
 * shared 20-row bound (AC3), and a cursor contributes `after_id` verbatim.
 * Unapplied filters are omitted rather than sent empty, so the request carries
 * exactly what was asked for — and so two equal filter sets produce one cache key
 * instead of two.
 */
export function auditQueryParams(
  filters: AuditFilters,
  cursor: number | null = null,
): AuditQueryParams {
  const from = normalizeTimeBound(filters.from)
  const to = normalizeTimeBound(filters.to)
  return {
    page_size: DEFAULT_PAGE_SIZE,
    ...(filters.actorAccountId === '' ? {} : { actor_account_id: filters.actorAccountId }),
    ...(filters.action === '' ? {} : { action: filters.action }),
    ...(filters.entityType === '' ? {} : { entity_type: filters.entityType }),
    ...(filters.entityId === '' ? {} : { entity_id: filters.entityId }),
    ...(from === '' ? {} : { from_dt: from }),
    ...(to === '' ? {} : { to_dt: to }),
    ...(cursor === null ? {} : { after_id: cursor }),
  }
}
