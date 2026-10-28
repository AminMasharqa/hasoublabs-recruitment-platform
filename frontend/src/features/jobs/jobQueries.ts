/**
 * The TanStack Query bindings of the Job_Description browsing slice
 * (Requirement 12 AC1–AC4, AC6, AC8).
 *
 * Four reads, no mutations: browsing is read-only, so nothing here invalidates
 * anything. The Api_Client already retries an idempotent read, decodes every
 * failure into an Error_Envelope and records its Support_Reference, so these
 * hooks add exactly two things — the cache key and, for the skill taxonomy, a
 * stale window.
 *
 * ## Why required skills are resolved from one taxonomy page
 *
 * `JobDescriptionDTO.required_skill_ids` carries identifiers and the contract
 * exposes no lookup-by-identifier endpoint (requirements Assumption 4), so AC6's
 * "resolved required skills" is resolved the only way the contract allows: the
 * first page of `GET /api/v1/skills` is read and the identifiers are matched
 * against it ({@link useResolvedSkills}). An identifier no page named stays
 * unresolved and the detail view says so, rather than the skill being dropped —
 * see `skills.ts`.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.6, 12.8.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import { useApiClient } from '../../shell/appServices'

import { browseQueryParams, type JobBrowseFilters } from './browseFilters'
import type { ContactableSenior } from './contacts'
import {
  browseJobs,
  contactableSeniorsQueryKey,
  fetchContactableSeniors,
  fetchJob,
  jobBrowseQueryKey,
  jobDetailQueryKey,
  searchSkills,
  skillSearchQueryKey,
  type JobBrowsePage,
  type JobDescription,
} from './jobsApi'
import { resolveSkills, skillNameIndex, type ResolvedSkill, type Skill } from './skills'

/**
 * How long a taxonomy search stays fresh.
 *
 * The Skill_Taxonomy changes rarely and the same page is read by the filter
 * panel and by every detail view, so a minute of freshness turns a screen-to-
 * screen walk into one request instead of one per screen.
 */
export const SKILL_SEARCH_STALE_MS = 60_000

/**
 * The term the detail view resolves identifiers with: none.
 *
 * `GET /skills` answers an empty term with the first page of the taxonomy, which
 * is the only identifier-bearing page the contract offers (Assumption 4).
 */
export const TAXONOMY_PAGE_TERM = ''

/**
 * One page of `GET /api/v1/jobs` (AC1–AC4).
 *
 * The cache key is the request query itself, so two equal filter sets share one
 * entry and a cursor walk keeps each visited page cached — pressing "next" and
 * then going back re-renders rather than re-reads.
 */
export function useJobBrowseQuery(
  filters: JobBrowseFilters,
  cursor: string | null = null,
): UseQueryResult<JobBrowsePage> {
  const api = useApiClient()
  const query = browseQueryParams(filters, cursor)
  return useQuery({
    queryKey: jobBrowseQueryKey(query),
    queryFn: ({ signal }) => browseJobs(api, { filters, cursor, signal }),
  })
}

/**
 * One Job_Description (AC6, AC7).
 *
 * Disabled for a blank identifier: an address that carries none is a defective
 * link, and the screen says so rather than issuing a request the Backend_Api
 * would refuse.
 */
export function useJobQuery(jdId: string): UseQueryResult<JobDescription> {
  const api = useApiClient()
  const id = jdId.trim()
  return useQuery({
    queryKey: jobDetailQueryKey(id),
    queryFn: ({ signal }) => fetchJob(api, id, signal),
    enabled: id !== '',
  })
}

/** The contactable Seniors of one Job_Description (AC8, AC9, AC10). */
export function useContactableSeniorsQuery(
  jdId: string,
): UseQueryResult<readonly ContactableSenior[]> {
  const api = useApiClient()
  const id = jdId.trim()
  return useQuery({
    queryKey: contactableSeniorsQueryKey(id),
    queryFn: ({ signal }) => fetchContactableSeniors(api, id, signal),
    enabled: id !== '',
  })
}

/**
 * One Skill_Taxonomy search (AC2, AC6).
 *
 * `enabled` is the caller's decision rather than a length rule: the filter panel
 * searches only once a term has been typed, while the detail view deliberately
 * reads the empty term to get a page of identifiers to resolve against.
 */
export function useSkillSearchQuery(
  term: string,
  options: { readonly enabled?: boolean } = {},
): UseQueryResult<readonly Skill[]> {
  const api = useApiClient()
  const searched = term.trim()
  return useQuery({
    queryKey: skillSearchQueryKey(searched),
    queryFn: ({ signal }) => searchSkills(api, searched, signal),
    enabled: options.enabled ?? true,
    staleTime: SKILL_SEARCH_STALE_MS,
  })
}

/** The required skills of a Job_Description, named where the taxonomy names them. */
export interface ResolvedSkillsResult {
  readonly skills: readonly ResolvedSkill[]
  /** Whether the taxonomy page is still being read. */
  readonly isPending: boolean
}

/**
 * Resolves `required_skill_ids` against the taxonomy (AC6).
 *
 * Never fails the screen: a failed or still-running taxonomy read yields the
 * identifiers unresolved, because the required skills of the role are part of the
 * Job_Description the read already returned and withholding them would hide
 * information the user has.
 */
export function useResolvedSkills(
  ids: readonly string[] | null | undefined,
): ResolvedSkillsResult {
  const taxonomy = useSkillSearchQuery(TAXONOMY_PAGE_TERM, {
    enabled: (ids ?? []).length > 0,
  })
  return {
    skills: resolveSkills(ids, skillNameIndex(taxonomy.data)),
    isPending: taxonomy.isPending && taxonomy.fetchStatus !== 'idle',
  }
}
