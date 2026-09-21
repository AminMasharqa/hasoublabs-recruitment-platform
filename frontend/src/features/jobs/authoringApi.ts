/**
 * The nine authoring requests of Requirement 13, issued through the Api_Client.
 *
 * | request | endpoint | requirement |
 * | --- | --- | --- |
 * | create | `POST /jobs` | AC2 |
 * | extract from a URL | `POST /jobs/extract:url` | AC3 |
 * | extract from text | `POST /jobs/extract:text` | AC4 |
 * | poll a draft | `GET /jobs/extract/{draft_id}` | AC5 |
 * | confirm a draft | `POST /jobs/extract/{draft_id}:confirm` | AC9 |
 * | edit | `PATCH /jobs/{jd_id}` | AC11 |
 * | publish | `POST /jobs/{jd_id}:publish` | AC12 |
 * | close | `POST /jobs/{jd_id}:close` | AC14 |
 * | set the channel | `PUT /jobs/{jd_id}/application-channel` | AC16 |
 * | Admin listing | `GET /admin/jobs` | AC17 |
 *
 * Each is a one-line call into {@link ApiClient.request}, so credential
 * attachment, `Accept-Language`, the 30-second budget, the no-retry-for-mutations
 * policy, the 401 refresh-and-replay path, error decoding and the
 * Support_Reference are the Api_Client's (Requirement 3 AC1) rather than restated
 * per screen. The path templates are keys of the generated declarations, so a
 * contract change that renamed one fails `npm run typecheck` instead of a request
 * at runtime.
 *
 * Nothing here catches: a failure belongs to the surface that issued it — and for
 * `illegal_transition` that is the whole point, since AC18 renders the reported
 * states and refetches.
 *
 * Separate from `authoringQueries.ts` because these are plain promises with no
 * React in them, so the whole slice's data access can be driven from a test with a
 * stub Api_Client and no renderer.
 *
 * Requirements: 13.2, 13.3, 13.4, 13.5, 13.9, 13.11, 13.12, 13.14, 13.16, 13.17.
 */

import type { ApiClient } from '../../api/client'
import type { JdStatus } from '../../api/enums'
import { DEFAULT_PAGE_SIZE, NO_NEXT_PAGE, type NextPage } from '../../lib/cursor'

import type {
  ApplicationChannelBody,
  JobCreateBody,
  JobUpdateBody,
} from './authoringRules'
import { decodeExtractionDraft, type ExtractionDraft } from './extraction'
import { JOBS_QUERY_SCOPE, type JobBrowsePage, type JobDescription } from './jobsApi'

// ── Paths ─────────────────────────────────────────────────────────────────────

/** `POST` collection path of Job_Descriptions (AC2). */
export const JOBS_PATH = '/api/v1/jobs'

/** `PATCH` path of one Job_Description (AC11). */
export const JOB_PATH = '/api/v1/jobs/{jd_id}'

/** `POST` path that publishes a `Draft` (AC12). */
export const JOB_PUBLISH_PATH = '/api/v1/jobs/{jd_id}:publish'

/** `POST` path that closes an `Open` Job_Description (AC14). */
export const JOB_CLOSE_PATH = '/api/v1/jobs/{jd_id}:close'

/** `PUT` path of the Application_Channel (AC16). */
export const JOB_CHANNEL_PATH = '/api/v1/jobs/{jd_id}/application-channel'

/** `POST` path of a URL extraction (AC3). */
export const EXTRACT_URL_PATH = '/api/v1/jobs/extract:url'

/** `POST` path of a text extraction (AC4). */
export const EXTRACT_TEXT_PATH = '/api/v1/jobs/extract:text'

/** `GET` path of one extraction draft (AC5). */
export const EXTRACT_DRAFT_PATH = '/api/v1/jobs/extract/{draft_id}'

/** `POST` path that confirms an extraction draft (AC9). */
export const EXTRACT_CONFIRM_PATH = '/api/v1/jobs/extract/{draft_id}:confirm'

/** `GET` path of the Admin all-status listing (AC17). */
export const ADMIN_JOBS_PATH = '/api/v1/admin/jobs'

// ── Cache keys ────────────────────────────────────────────────────────────────

/**
 * Cache key of one Admin listing page (AC17).
 *
 * Scoped under the same {@link JOBS_QUERY_SCOPE} the browsing slice owns, so one
 * invalidation after a lifecycle transition refreshes the browse list, the detail
 * and the Admin listing together rather than leaving one of the three stale.
 */
export function adminJobsQueryKey(query: AdminJobsQuery): readonly unknown[] {
  return [JOBS_QUERY_SCOPE, 'admin', query]
}

/** Cache key of one extraction draft (AC5). */
export function extractionDraftQueryKey(draftId: string): readonly unknown[] {
  return [JOBS_QUERY_SCOPE, 'extract', draftId]
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/** `POST /api/v1/jobs` — creates a `Draft` Job_Description (AC2). */
export async function createJob(api: ApiClient, body: JobCreateBody): Promise<JobDescription> {
  const { data } = await api.request('post', JOBS_PATH, { body })
  return data
}

/** `PATCH /api/v1/jobs/{jd_id}` — applies the changed fields only (AC11). */
export async function updateJob(
  api: ApiClient,
  jdId: string,
  body: JobUpdateBody,
): Promise<JobDescription> {
  const { data } = await api.request('patch', JOB_PATH, {
    params: { path: { jd_id: jdId } },
    body,
  })
  return data
}

/** `POST /api/v1/jobs/{jd_id}:publish` — publishes a `Draft` (AC12). */
export async function publishJob(api: ApiClient, jdId: string): Promise<JobDescription> {
  const { data } = await api.request('post', JOB_PUBLISH_PATH, {
    params: { path: { jd_id: jdId } },
  })
  return data
}

/** `POST /api/v1/jobs/{jd_id}:close` — closes an `Open` Job_Description (AC14). */
export async function closeJob(api: ApiClient, jdId: string): Promise<JobDescription> {
  const { data } = await api.request('post', JOB_CLOSE_PATH, {
    params: { path: { jd_id: jdId } },
  })
  return data
}

/** `PUT /api/v1/jobs/{jd_id}/application-channel` — sets the channel (AC16). */
export async function setJobApplicationChannel(
  api: ApiClient,
  jdId: string,
  body: ApplicationChannelBody,
): Promise<JobDescription> {
  const { data } = await api.request('put', JOB_CHANNEL_PATH, {
    params: { path: { jd_id: jdId } },
    body,
  })
  return data
}

// ── Extraction (AC3–AC5, AC9) ─────────────────────────────────────────────────

/** `POST /api/v1/jobs/extract:url` — starts a URL extraction (AC3). */
export async function extractJobFromUrl(api: ApiClient, url: string): Promise<ExtractionDraft> {
  const { data } = await api.request('post', EXTRACT_URL_PATH, { body: { url } })
  return decodeExtractionDraft(data)
}

/** `POST /api/v1/jobs/extract:text` — starts a text extraction (AC4). */
export async function extractJobFromText(
  api: ApiClient,
  rawText: string,
): Promise<ExtractionDraft> {
  const { data } = await api.request('post', EXTRACT_TEXT_PATH, { body: { raw_text: rawText } })
  return decodeExtractionDraft(data)
}

/** `GET /api/v1/jobs/extract/{draft_id}` — one poll of a draft (AC5). */
export async function fetchExtractionDraft(
  api: ApiClient,
  draftId: string,
  signal?: AbortSignal,
): Promise<ExtractionDraft> {
  const { data } = await api.request('get', EXTRACT_DRAFT_PATH, {
    params: { path: { draft_id: draftId } },
    ...(signal === undefined ? {} : { signal }),
  })
  return decodeExtractionDraft(data)
}

/**
 * `POST /api/v1/jobs/extract/{draft_id}:confirm` — confirms a draft into a real
 * `Draft` Job_Description (AC9).
 *
 * The body is the same `JdCreateRequest` the creation form submits: confirming *is*
 * creating, from the values the user reviewed. AC10's "no persistence request
 * before confirmation" is enforced by the caller's gate
 * (`canConfirmExtraction`), which is where the user's act of confirming is observed.
 */
export async function confirmExtractionDraft(
  api: ApiClient,
  draftId: string,
  body: JobCreateBody,
): Promise<JobDescription> {
  const { data } = await api.request('post', EXTRACT_CONFIRM_PATH, {
    params: { path: { draft_id: draftId } },
    body,
  })
  return data
}

// ── Admin listing (AC17) ──────────────────────────────────────────────────────

/** The query of one `GET /api/v1/admin/jobs` request (AC17). */
export interface AdminJobsQuery {
  readonly limit: number
  readonly status?: JdStatus
  readonly after_id?: string
}

/**
 * Builds the Admin listing query (AC17).
 *
 * An absent status filter lists every status, which is the whole point of AC17:
 * `GET /jobs` browses `Open` Job_Descriptions only, so this is the one read through
 * which a `Draft` or a `Closed` posting is reachable at all.
 */
export function adminJobsQuery(
  status: JdStatus | null = null,
  afterId: string | null = null,
): AdminJobsQuery {
  return {
    limit: DEFAULT_PAGE_SIZE,
    ...(status === null ? {} : { status }),
    ...(afterId === null || afterId.trim() === '' ? {} : { after_id: afterId }),
  }
}

/**
 * The next page of an Admin listing response (AC17).
 *
 * Deliberately *not* `deriveTokenCursor`: the Admin listing reports `has_next` but
 * always answers `next_cursor: null` — it paginates on `after_id`, the identifier of
 * the last row returned. So a further page is reported by `has_next` and addressed
 * by that identifier, and a page claiming a successor without returning a row leaves
 * no next request to form, which keeps the control disabled.
 */
export function nextAdminJobsPage(page: JobBrowsePage | null | undefined): NextPage<string> {
  if (page == null || page.has_next !== true) {
    return NO_NEXT_PAGE
  }
  const last = page.items[page.items.length - 1]
  if (last === undefined || last.id.trim() === '') {
    return NO_NEXT_PAGE
  }
  return { hasNextPage: true, nextCursor: last.id }
}

/** `GET /api/v1/admin/jobs` — Job_Descriptions of every status (AC17). */
export async function adminListJobs(
  api: ApiClient,
  query: AdminJobsQuery,
  signal?: AbortSignal,
): Promise<JobBrowsePage> {
  const { data } = await api.request('get', ADMIN_JOBS_PATH, {
    params: { query },
    ...(signal === undefined ? {} : { signal }),
  })
  return data
}
