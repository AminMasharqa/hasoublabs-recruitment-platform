/**
 * The Job_Description browse filters, as URL query parameters (Requirement 12
 * AC1–AC5).
 *
 * Pure: no React, no Api_Client. The browse screen reads its filters out of the
 * address bar through {@link readBrowseFilters}, turns them into the query of
 * `GET /api/v1/jobs` through {@link browseQueryParams}, and writes a changed
 * filter set back through {@link writeBrowseFilters}. Keeping that round trip in
 * one testable module is what makes a filtered list linkable and reload-proof
 * (AC2) and what lets the empty state offer "clear filters" without the screen
 * having to know which parameters count as a filter (AC5).
 *
 * ## Why the URL parameter names are the endpoint's parameter names
 *
 * `search`, `location`, `skills`, `work_model`, `employment_type` and
 * `experience_level` are spelled exactly as `GET /jobs` spells them, so the
 * address bar and the request carry the same vocabulary and a reviewer can read
 * one off the other. The single exception is `cursor`, which is the browse
 * response's own `next_cursor` token (AC4) and not a filter — see
 * {@link decodeBrowseCursor} for why it cannot be forwarded verbatim.
 *
 * ## Why the cursor is decoded rather than forwarded
 *
 * Requirement 12 AC4 says the next request carries the `next_cursor` value as its
 * keyset cursor, and the Backend_Api issues that value as an opaque token — but
 * `GET /jobs` declares no `cursor` parameter. It declares the keyset pair
 * `after_published_at` + `after_id`, and the token is a base64url-encoded JSON
 * object holding exactly that pair. So the token is the cursor, and sending it
 * means decoding it into the two parameters the endpoint accepts. A token that
 * does not decode into a usable pair yields no next page at all rather than a
 * request the Backend_Api would refuse with a 422 — see {@link nextBrowsePage}.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5.
 */

import type { EmploymentType, ExperienceLevel, WorkModel } from '../../api/enums'
import {
  EMPLOYMENT_TYPE_VALUES,
  EXPERIENCE_LEVEL_VALUES,
  WORK_MODEL_VALUES,
  type EnumValues,
} from '../../forms/validators'
import {
  DEFAULT_PAGE_SIZE,
  deriveTokenCursor,
  NO_NEXT_PAGE,
  type NextPage,
  type TokenPagedResponse,
} from '../../lib/cursor'

// ── Parameter names ───────────────────────────────────────────────────────────

/** URL and query parameter names, spelled as `GET /jobs` spells them. */
export const BROWSE_PARAM = {
  search: 'search',
  location: 'location',
  skills: 'skills',
  workModel: 'work_model',
  employmentType: 'employment_type',
  experienceLevel: 'experience_level',
  /** The `next_cursor` token of the previous page (AC4). Not a filter. */
  cursor: 'cursor',
} as const

/** Every parameter that is a filter, i.e. everything except the cursor. */
export const FILTER_PARAM_NAMES: readonly string[] = [
  BROWSE_PARAM.search,
  BROWSE_PARAM.location,
  BROWSE_PARAM.skills,
  BROWSE_PARAM.workModel,
  BROWSE_PARAM.employmentType,
  BROWSE_PARAM.experienceLevel,
]

// ── The filter set ────────────────────────────────────────────────────────────

/**
 * The filters Requirement 12 AC2 asks for.
 *
 * `skillIds` holds Skill_Taxonomy identifiers rather than terms, because that is
 * what the endpoint filters on — its `skills` parameter is a list of UUIDs. The
 * browse screen therefore feeds this from `GET /skills`, which is also how the
 * identifiers get a display name (Assumption 4).
 */
export interface JobBrowseFilters {
  readonly search: string
  readonly location: string
  readonly skillIds: readonly string[]
  readonly workModel: WorkModel | null
  readonly employmentType: EmploymentType | null
  readonly experienceLevel: ExperienceLevel | null
}

/** No filter applied: the unfiltered first page. */
export const EMPTY_BROWSE_FILTERS: JobBrowseFilters = Object.freeze({
  search: '',
  location: '',
  skillIds: Object.freeze([]) as readonly string[],
  workModel: null,
  employmentType: null,
  experienceLevel: null,
})

/** Anything that reads like a `URLSearchParams`. */
export interface ReadableSearchParams {
  get(name: string): string | null
  getAll(name: string): string[]
}

function trimmed(value: string | null): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Reads a filter value constrained to a contract enum.
 *
 * An unrecognized value — a hand-edited URL, a stale link from before a contract
 * change — resolves to "no filter" rather than being forwarded, so a crafted
 * address produces an unfiltered list instead of a 422.
 */
function enumFilter<T extends string>(raw: string | null, members: EnumValues<T>): T | null {
  const value = trimmed(raw)
  return value !== '' && members.includes(value) ? value : null
}

/** Distinct, non-blank skill identifiers, in the order the URL listed them. */
function skillIdsFrom(values: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  for (const value of values) {
    const id = value.trim()
    if (id !== '') {
      seen.add(id)
    }
  }
  return [...seen]
}

/** Reads the applied filters out of a location's query string (AC1, AC2). */
export function readBrowseFilters(params: ReadableSearchParams): JobBrowseFilters {
  return {
    search: trimmed(params.get(BROWSE_PARAM.search)),
    location: trimmed(params.get(BROWSE_PARAM.location)),
    skillIds: skillIdsFrom(params.getAll(BROWSE_PARAM.skills)),
    workModel: enumFilter<WorkModel>(params.get(BROWSE_PARAM.workModel), WORK_MODEL_VALUES),
    employmentType: enumFilter<EmploymentType>(
      params.get(BROWSE_PARAM.employmentType),
      EMPLOYMENT_TYPE_VALUES,
    ),
    experienceLevel: enumFilter<ExperienceLevel>(
      params.get(BROWSE_PARAM.experienceLevel),
      EXPERIENCE_LEVEL_VALUES,
    ),
  }
}

/** The keyset cursor token the current location carries, if any (AC4). */
export function readBrowseCursor(params: ReadableSearchParams): string | null {
  const cursor = trimmed(params.get(BROWSE_PARAM.cursor))
  return cursor === '' ? null : cursor
}

/**
 * Serializes a filter set back into query parameters (AC1, AC2).
 *
 * Blank and absent values are omitted, so the address bar carries only what is
 * actually applied and two equal filter sets always produce the same URL. The
 * cursor is deliberately not written: applying a filter starts a new keyset walk,
 * because a cursor taken from a differently filtered page addresses a different
 * result set.
 */
export function writeBrowseFilters(filters: JobBrowseFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.search !== '') {
    params.set(BROWSE_PARAM.search, filters.search)
  }
  if (filters.location !== '') {
    params.set(BROWSE_PARAM.location, filters.location)
  }
  for (const id of skillIdsFrom(filters.skillIds)) {
    params.append(BROWSE_PARAM.skills, id)
  }
  if (filters.workModel !== null) {
    params.set(BROWSE_PARAM.workModel, filters.workModel)
  }
  if (filters.employmentType !== null) {
    params.set(BROWSE_PARAM.employmentType, filters.employmentType)
  }
  if (filters.experienceLevel !== null) {
    params.set(BROWSE_PARAM.experienceLevel, filters.experienceLevel)
  }
  return params
}

/**
 * Whether any filter is applied (AC5, Requirement 21 AC7).
 *
 * Drives the empty state's clear-filter control: "nothing here yet" and "nothing
 * matches what you asked for" are different outcomes and only the second one has
 * a filter to clear.
 */
export function hasActiveFilters(filters: JobBrowseFilters): boolean {
  return (
    filters.search !== '' ||
    filters.location !== '' ||
    filters.skillIds.length > 0 ||
    filters.workModel !== null ||
    filters.employmentType !== null ||
    filters.experienceLevel !== null
  )
}

// ── The keyset cursor (AC4) ───────────────────────────────────────────────────

/** The keyset pair `GET /jobs` accepts, decoded out of a `next_cursor` token. */
export interface BrowseCursorParams {
  readonly after_published_at: string
  readonly after_id: string
}

function decodeBase64Url(token: string): string | null {
  const normalized = token.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
  try {
    return atob(padded)
  } catch {
    return null
  }
}

/**
 * Decodes a `next_cursor` token into the keyset parameters of the next request
 * (AC4).
 *
 * Returns `null` for anything that is not a token carrying both members: the
 * Backend_Api rejects `after_id` without `after_published_at`, so half a cursor
 * is not a request worth issuing. The caller turns that into "no next page"
 * ({@link nextBrowsePage}) rather than into a failed read.
 */
export function decodeBrowseCursor(token: string | null | undefined): BrowseCursorParams | null {
  if (typeof token !== 'string' || token.trim() === '') {
    return null
  }
  const json = decodeBase64Url(token.trim())
  if (json === null) {
    return null
  }
  let payload: unknown
  try {
    payload = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null
  }
  const { after_published_at: publishedAt, after_id: id } = payload as Record<string, unknown>
  if (typeof publishedAt !== 'string' || typeof id !== 'string') {
    return null
  }
  if (publishedAt.trim() === '' || id.trim() === '') {
    return null
  }
  return { after_published_at: publishedAt, after_id: id }
}

/**
 * The next page of a browse response (AC4).
 *
 * `deriveTokenCursor` answers the contract question — did the response report
 * `has_next` with a usable `next_cursor`? — and this adds the one thing the
 * endpoint's parameter list adds: the token has to decode into the keyset pair,
 * or there is no next request to form and the control stays disabled.
 */
export function nextBrowsePage(
  page: TokenPagedResponse | null | undefined,
): NextPage<string> {
  const derived = deriveTokenCursor(page)
  if (!derived.hasNextPage) {
    return NO_NEXT_PAGE
  }
  return decodeBrowseCursor(derived.nextCursor) === null ? NO_NEXT_PAGE : derived
}

// ── The request query ─────────────────────────────────────────────────────────

/** The query of one `GET /api/v1/jobs` request. */
export interface BrowseQueryParams {
  readonly limit: number
  readonly search?: string
  readonly location?: string
  readonly skills?: string[]
  readonly work_model?: WorkModel
  readonly employment_type?: EmploymentType
  readonly experience_level?: ExperienceLevel
  readonly after_published_at?: string
  readonly after_id?: string
}

/**
 * Builds the query of `GET /api/v1/jobs` (AC2, AC3, AC4).
 *
 * Every applied filter becomes a query parameter (AC2), the page size is the
 * shared 20-row bound (AC3), and a cursor token contributes the decoded keyset
 * pair (AC4). Unapplied filters are omitted rather than sent empty, so the
 * request carries exactly what the user asked for — and so two equal filter sets
 * produce one cache key instead of two.
 */
export function browseQueryParams(
  filters: JobBrowseFilters,
  cursor: string | null = null,
): BrowseQueryParams {
  const keyset = decodeBrowseCursor(cursor)
  return {
    limit: DEFAULT_PAGE_SIZE,
    ...(filters.search === '' ? {} : { search: filters.search }),
    ...(filters.location === '' ? {} : { location: filters.location }),
    ...(filters.skillIds.length === 0 ? {} : { skills: [...skillIdsFrom(filters.skillIds)] }),
    ...(filters.workModel === null ? {} : { work_model: filters.workModel }),
    ...(filters.employmentType === null ? {} : { employment_type: filters.employmentType }),
    ...(filters.experienceLevel === null ? {} : { experience_level: filters.experienceLevel }),
    ...(keyset === null ? {} : keyset),
  }
}
