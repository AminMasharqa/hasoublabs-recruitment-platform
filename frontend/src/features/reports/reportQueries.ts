/**
 * The TanStack Query bindings of the reports slice: three reads and one mutation
 * (Requirement 18 AC1, AC3, AC4, AC6, AC7, AC10).
 *
 * ## The export poll is a query, not a loop
 *
 * AC7 asks for a poll at an interval of at most 5 seconds until the status is
 * terminal or the user dismisses the export. That is expressed as a single query
 * with a computed `refetchInterval` ({@link useExportStatusQuery}) rather than as
 * a `setInterval` inside a component:
 *
 * - the interval is recomputed from the *last answer*, so the poll stops the
 *   moment a terminal status arrives — no extra request after the last one;
 * - dismissal is `enabled: false`, so the timer is torn down by the same
 *   mechanism that unmounts it, and no in-flight request can resurrect it;
 * - the request is cancelled on unmount through the query's `signal`, so leaving
 *   the reports destination cannot leave a timer running;
 * - and the reports on the same screen stay readable and refetchable throughout,
 *   because a poll is one more cache entry rather than a blocking wait (AC10).
 *
 * The 202 seeds the poll's cache entry ({@link useRequestExport}), so the first
 * poll request happens one interval later instead of immediately re-reading a
 * status the enqueue response already carried.
 *
 * Requirements: 18.1, 18.3, 18.4, 18.6, 18.7, 18.10.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'

import { useApiClient } from '../../shell/appServices'

import { EXPORT_POLL_INTERVAL_MS, exportJobId, exportPollInterval } from './exportPolling'
import {
  activityQueryParams,
  progressQueryParams,
  type ReportFilters,
} from './reportFilters'
import {
  activityReportQueryKey,
  candidateProgressQueryKey,
  exportStatusQueryKey,
  fetchActivityReport,
  fetchCandidateProgress,
  fetchExportStatus,
  requestExport,
  type ActivityReport,
  type CandidateProgressPage,
  type ExportRequest,
  type PolledExport,
} from './reportsApi'

/**
 * The activity report under one filter set (AC1, AC2).
 *
 * The cache key is the request query itself, so two equal filter sets share one
 * entry and walking back to a previously applied range re-renders rather than
 * re-reads.
 */
export function useActivityReportQuery(filters: ReportFilters): UseQueryResult<ActivityReport> {
  const api = useApiClient()
  return useQuery({
    queryKey: activityReportQueryKey(activityQueryParams(filters)),
    queryFn: ({ signal }) => fetchActivityReport(api, filters, signal),
  })
}

/** One candidate-progress page (AC3, AC4). */
export function useCandidateProgressQuery(
  cursor: string | null = null,
): UseQueryResult<CandidateProgressPage> {
  const api = useApiClient()
  return useQuery({
    queryKey: candidateProgressQueryKey(progressQueryParams(cursor)),
    queryFn: ({ signal }) => fetchCandidateProgress(api, cursor, signal),
  })
}

/**
 * Polls one export job until its status is terminal (AC7).
 *
 * Disabled for an absent `jobId`, which is how dismissal works: the screen drops
 * the retained identifier and the poll stops with it. `refetchIntervalInBackground`
 * is left off, so a hidden tab stops polling and resumes when it is shown again.
 */
export function useExportStatusQuery(jobId: string | null): UseQueryResult<PolledExport> {
  const api = useApiClient()
  const id = jobId ?? ''
  return useQuery({
    queryKey: exportStatusQueryKey(id),
    queryFn: ({ signal }) => fetchExportStatus(api, id, signal),
    enabled: id !== '',
    // AC7: at most 5 seconds between polls, and no poll at all once terminal.
    refetchInterval: (query) => exportPollInterval(query.state.data?.job),
    // One interval of freshness, so the 202's seeded status is not immediately
    // re-read on mount and a remount inside the interval adds no request. The
    // interval above is unaffected by this: it refetches on its own schedule.
    staleTime: EXPORT_POLL_INTERVAL_MS,
    // The poll itself is the retry: a transient failure is re-asked on the next
    // interval rather than immediately, so a failing job cannot busy-loop.
    retry: false,
  })
}

/**
 * Requests an export and seeds the poll's cache entry with the 202 body
 * (AC6, AC7).
 *
 * Seeding means the poll starts from the status the enqueue response reported, so
 * the progress indicator appears immediately and the first `GET` happens one
 * interval later. A 202 that carries no usable `job_id` seeds nothing, and the
 * caller reports the request as failed rather than polling an empty identifier.
 */
export function useRequestExport(): UseMutationResult<PolledExport, unknown, ExportRequest> {
  const api = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: ExportRequest) => requestExport(api, request),
    onSuccess: (enqueued) => {
      const id = exportJobId(enqueued.job)
      if (id !== null) {
        queryClient.setQueryData<PolledExport>(exportStatusQueryKey(id), enqueued)
      }
    },
  })
}
