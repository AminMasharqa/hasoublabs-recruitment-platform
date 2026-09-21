/**
 * The four Backend_Api calls of the reports slice, and their cache keys.
 *
 * | call | endpoint | requirement |
 * | --- | --- | --- |
 * | activity report | `GET /api/v1/admin/reports/activity` | 18.1, 18.2 |
 * | candidate progress | `GET /api/v1/admin/reports/candidate-progress` | 18.3, 18.4 |
 * | request an export | `POST /api/v1/admin/exports/{entity_type}` | 18.6 |
 * | poll an export | `GET /api/v1/admin/exports/{job_id}` | 18.7 |
 *
 * All four go through the Api_Client (Requirement 3 AC1), so each carries the
 * Access_Token and the active Locale, obeys the 30-second budget and decodes its
 * failure into an Error_Envelope the Error_Presenter can render. Nothing here
 * catches: a failure belongs to the screen's error state, not to a silent empty
 * result.
 *
 * The Admin-only scoping of AC1, AC3 and AC11 is not enforced here. It is a
 * property of the routes these screens are mounted on — the `admin` guarded group
 * — which is what keeps the requests from being issued at all in a Candidate or
 * Senior context.
 *
 * Requirements: 18.1, 18.2, 18.3, 18.4, 18.6, 18.7.
 */

import type { ApiClient } from '../../api/client'
import type { components } from '../../api/generated/schema'

import type { ExportEntityType, ExportJob } from './exportPolling'
import {
  activityQueryParams,
  exportRequestBody,
  progressQueryParams,
  type ActivityQueryParams,
  type ProgressQueryParams,
  type ReportFilters,
} from './reportFilters'

/** The activity report metrics, exactly as the contract describes them. */
export type ActivityReport = components['schemas']['ActivityReportDTO']

/** One page of the candidate-progress report, carrying `has_next`/`next_cursor`. */
export type CandidateProgressPage = components['schemas']['CandidateProgressReport']

/** One candidate-progress row. */
export type CandidateProgressRow = components['schemas']['CandidateProgressRow']

/** One Application status entry on a progress row. */
export type CandidateApplicationStatus = components['schemas']['CandidateApplicationStatus']

// ── Cache keys ────────────────────────────────────────────────────────────────

/** Root of every cache entry this slice owns, so one call can invalidate them all. */
export const REPORTS_QUERY_SCOPE = 'admin-reports' as const

/** Cache key of the activity report under one filter set (AC1, AC2). */
export function activityReportQueryKey(query: ActivityQueryParams): readonly unknown[] {
  return [REPORTS_QUERY_SCOPE, 'activity', query]
}

/** Cache key of one candidate-progress page (AC3, AC4). */
export function candidateProgressQueryKey(query: ProgressQueryParams): readonly unknown[] {
  return [REPORTS_QUERY_SCOPE, 'candidate-progress', query]
}

/**
 * Cache key of one export job (AC7).
 *
 * Keyed by `job_id` alone, so the 202 that started the job can seed the very
 * entry the poll then refreshes — which is what lets the first poll interval
 * elapse before any request is issued, instead of an immediate duplicate read.
 */
export function exportStatusQueryKey(jobId: string): readonly unknown[] {
  return [REPORTS_QUERY_SCOPE, 'export', jobId]
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/** Loads the activity report under the applied filters (AC1, AC2). */
export async function fetchActivityReport(
  api: ApiClient,
  filters: ReportFilters,
  signal?: AbortSignal,
): Promise<ActivityReport> {
  const { data } = await api.request('get', '/api/v1/admin/reports/activity', {
    params: { query: activityQueryParams(filters) },
    ...(signal === undefined ? {} : { signal }),
  })
  return data
}

/** Loads one candidate-progress page (AC3, AC4). */
export async function fetchCandidateProgress(
  api: ApiClient,
  cursor: string | null = null,
  signal?: AbortSignal,
): Promise<CandidateProgressPage> {
  const { data } = await api.request('get', '/api/v1/admin/reports/candidate-progress', {
    params: { query: progressQueryParams(cursor) },
    ...(signal === undefined ? {} : { signal }),
  })
  return data
}

/**
 * One observation of an export job, together with the Support_Reference of the
 * response that carried it.
 *
 * The reference travels with the job because AC9 asks for it beside the
 * `error_message` of a failed export — and a failed export arrives as a *200*
 * whose body reports failure, not as an Error_Envelope. There is therefore no
 * `ApiFailure` for the Error_Presenter to read a reference off, so the one the
 * Api_Client recorded for this response is kept here. It is never rendered for a
 * pending, running or ready job (Requirement 23 AC4).
 */
export interface PolledExport {
  readonly job: ExportJob
  readonly supportReference: string | null
}

/** Polls one export job (AC7). */
export async function fetchExportStatus(
  api: ApiClient,
  jobId: string,
  signal?: AbortSignal,
): Promise<PolledExport> {
  const { data, supportReference } = await api.request('get', '/api/v1/admin/exports/{job_id}', {
    params: { path: { job_id: jobId } },
    ...(signal === undefined ? {} : { signal }),
  })
  return { job: data, supportReference }
}

// ── Mutation ──────────────────────────────────────────────────────────────────

/** What one export request names: the entity and the filters to bound it (AC6). */
export interface ExportRequest {
  readonly entityType: ExportEntityType
  readonly filters: ReportFilters
}

/**
 * Requests an export (AC6).
 *
 * Returns the 202 body, whose `job_id` the caller retains and polls (AC7). Never
 * retried by the Api_Client, because it is a mutation: a retry would enqueue a
 * second job (Requirement 21 AC10).
 */
export async function requestExport(
  api: ApiClient,
  request: ExportRequest,
): Promise<PolledExport> {
  const { data, supportReference } = await api.request(
    'post',
    '/api/v1/admin/exports/{entity_type}',
    {
      params: { path: { entity_type: request.entityType } },
      body: exportRequestBody(request.filters),
    },
  )
  return { job: data, supportReference }
}
