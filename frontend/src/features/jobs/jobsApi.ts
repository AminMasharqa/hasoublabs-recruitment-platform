/**
 * The four reads the Job_Description browsing slice issues, and their cache keys.
 *
 * | read | endpoint | requirement |
 * | --- | --- | --- |
 * | browse a page | `GET /api/v1/jobs` | 12.1–12.5 |
 * | one Job_Description | `GET /api/v1/jobs/{jd_id}` | 12.6, 12.7 |
 * | contactable Seniors | `GET /api/v1/jobs/{jd_id}/contactable-seniors` | 12.8–12.10 |
 * | Skill_Taxonomy search | `GET /api/v1/skills` | 12.2, 12.6 |
 *
 * All four go through the Api_Client (Requirement 3 AC1), so each carries the
 * Access_Token and the active Locale, obeys the 30-second budget, is retried as an
 * idempotent read and decodes its failure into an Error_Envelope the
 * Error_Presenter can render. Nothing here catches: a failure belongs to the
 * screen's error state, not to a silent empty result.
 *
 * Reads only. This slice browses; authoring is task 19.1 and applying is task
 * 20.1, and neither shares a module with this one.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.6, 12.8.
 */

import type { ApiClient } from '../../api/client'
import type { components } from '../../api/generated/schema'

import { browseQueryParams, type BrowseQueryParams, type JobBrowseFilters } from './browseFilters'
import { decodeContactableSeniors, type ContactableSenior } from './contacts'
import { decodeSkills, type Skill } from './skills'

/** A Job_Description, exactly as the contract describes it. */
export type JobDescription = components['schemas']['JobDescriptionDTO']

/** One page of the browse response, carrying `has_next` and `next_cursor`. */
export type JobBrowsePage = components['schemas']['JdBrowsePage']

// ── Cache keys ────────────────────────────────────────────────────────────────

/** Root of every cache entry this slice owns, so one call can invalidate them all. */
export const JOBS_QUERY_SCOPE = 'jobs' as const

/** Cache key of one browse page: the query is the identity of the page (AC2, AC4). */
export function jobBrowseQueryKey(query: BrowseQueryParams): readonly unknown[] {
  return [JOBS_QUERY_SCOPE, 'browse', query]
}

/** Cache key of one Job_Description detail (AC6). */
export function jobDetailQueryKey(jdId: string): readonly unknown[] {
  return [JOBS_QUERY_SCOPE, 'detail', jdId]
}

/** Cache key of the contactable Seniors of one Job_Description (AC8). */
export function contactableSeniorsQueryKey(jdId: string): readonly unknown[] {
  return [JOBS_QUERY_SCOPE, 'contactable-seniors', jdId]
}

/** Cache key of one Skill_Taxonomy search. Shared by the filter and the detail. */
export function skillSearchQueryKey(term: string): readonly unknown[] {
  return ['skills', 'search', term]
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/**
 * Browses Job_Descriptions (AC1–AC4).
 *
 * The page size and every applied filter come from {@link browseQueryParams}, so
 * the 20-row bound of AC3 and the filter-to-parameter mapping of AC2 live in one
 * pure function rather than in the call site.
 */
export async function browseJobs(
  api: ApiClient,
  args: {
    readonly filters: JobBrowseFilters
    readonly cursor?: string | null
    readonly signal?: AbortSignal
  },
): Promise<JobBrowsePage> {
  const query = browseQueryParams(args.filters, args.cursor ?? null)
  const { data } = await api.request('get', '/api/v1/jobs', {
    params: { query },
    ...(args.signal === undefined ? {} : { signal: args.signal }),
  })
  return data
}

/** Loads one Job_Description (AC6, AC7). */
export async function fetchJob(
  api: ApiClient,
  jdId: string,
  signal?: AbortSignal,
): Promise<JobDescription> {
  const { data } = await api.request('get', '/api/v1/jobs/{jd_id}', {
    params: { path: { jd_id: jdId } },
    ...(signal === undefined ? {} : { signal }),
  })
  return data
}

/** Loads the contactable Seniors of one Job_Description (AC8, AC9, AC10). */
export async function fetchContactableSeniors(
  api: ApiClient,
  jdId: string,
  signal?: AbortSignal,
): Promise<readonly ContactableSenior[]> {
  const { data } = await api.request('get', '/api/v1/jobs/{jd_id}/contactable-seniors', {
    params: { path: { jd_id: jdId } },
    ...(signal === undefined ? {} : { signal }),
  })
  return decodeContactableSeniors(data)
}

/**
 * Searches the Skill_Taxonomy (AC2, AC6).
 *
 * An empty term is a legitimate request: the endpoint answers it with the first
 * page of the taxonomy, which is what the detail view has to resolve identifiers
 * against when it has no term to search by (Assumption 4).
 */
export async function searchSkills(
  api: ApiClient,
  term: string,
  signal?: AbortSignal,
): Promise<readonly Skill[]> {
  const { data } = await api.request('get', '/api/v1/skills', {
    params: { query: { q: term } },
    ...(signal === undefined ? {} : { signal }),
  })
  return decodeSkills(data)
}
