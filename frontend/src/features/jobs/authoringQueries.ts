/**
 * The TanStack Query bindings of the Job_Description authoring slice
 * (Requirement 13).
 *
 * ## Every mutation invalidates the whole jobs scope
 *
 * A create, an edit, a publish, a close and a channel change all alter what the
 * browse list, the detail view and the Admin listing would return, so each one
 * invalidates {@link JOBS_QUERY_SCOPE} rather than a hand-picked subset. Publish and
 * close in particular *move* a Job_Description between the pages `GET /jobs` and
 * `GET /admin/jobs` return; invalidating one key and not the other would leave a
 * published role missing from the list it has just joined.
 *
 * The returned Job_Description is additionally written into the detail cache, so the
 * authoring surface renders the Backend_Api's answer — and therefore the controls
 * the new status admits — the moment the response lands, without waiting for the
 * refetch. The invalidation then reconciles it, so the optimistic write cannot leave
 * the cache disagreeing with the server.
 *
 * ## The extraction poll is a query, not a loop (AC5)
 *
 * AC5 asks for a poll at an interval of at most 5 seconds until the status leaves
 * `pending` or the user leaves the screen. That is one query with a computed
 * `refetchInterval` ({@link useExtractionDraftQuery}):
 *
 * - the interval is recomputed from the last answer, so the poll stops on the first
 *   terminal status and issues no request after it;
 * - leaving the screen unmounts the query, which tears down the timer and cancels
 *   the in-flight request through its `signal` — "or the user leaves the screen",
 *   without a cleanup the component has to remember;
 * - an absent draft identifier disables it, so nothing is polled before an
 *   extraction has been started.
 *
 * The 202 seeds the poll's cache entry, so the pending state is on screen
 * immediately and the first `GET` happens one interval later rather than
 * re-reading a status the 202 already reported.
 *
 * Requirements: 13.2, 13.3, 13.4, 13.5, 13.9, 13.11, 13.12, 13.14, 13.16, 13.17.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useCallback } from 'react'

import type { ApplicationChannel, JdStatus } from '../../api/enums'
import { useApiClient } from '../../shell/appServices'

import {
  adminJobsQuery,
  adminJobsQueryKey,
  adminListJobs,
  closeJob,
  confirmExtractionDraft,
  createJob,
  extractJobFromText,
  extractJobFromUrl,
  extractionDraftQueryKey,
  fetchExtractionDraft,
  publishJob,
  setJobApplicationChannel,
  updateJob,
} from './authoringApi'
import {
  applicationChannelBody,
  createJobBody,
  type JobCreateBody,
  type JobDraft,
  type JobUpdateBody,
} from './authoringRules'
import {
  EXTRACTION_POLL_INTERVAL_MS,
  extractionPollInterval,
  type ExtractionDraft,
} from './extraction'
import {
  JOBS_QUERY_SCOPE,
  jobDetailQueryKey,
  type JobBrowsePage,
  type JobDescription,
} from './jobsApi'

// ── Cache maintenance ─────────────────────────────────────────────────────────

/**
 * Discards every cached Job_Description read.
 *
 * Deliberately the whole scope: a lifecycle transition changes which list a
 * Job_Description belongs to, and the browse pages are keyed by their filter set, so
 * there is no narrower key that is still correct.
 */
export function useInvalidateJobs(): () => void {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: [JOBS_QUERY_SCOPE] })
  }
}

/**
 * The success handler every mutation below shares: adopt the returned
 * Job_Description, then invalidate.
 */
function useAdoptJob(): (job: JobDescription) => void {
  const queryClient = useQueryClient()
  const invalidate = useInvalidateJobs()
  return (job: JobDescription) => {
    queryClient.setQueryData<JobDescription>(jobDetailQueryKey(job.id), job)
    invalidate()
  }
}

/**
 * Refetches one Job_Description from the Backend_Api — the second obligation of
 * AC18.
 *
 * `illegal_transition` means the client's picture of the lifecycle is stale, so the
 * displayed Job_Description is re-read rather than patched: whatever state the
 * Backend_Api reports is the one the controls are then derived from.
 *
 * Memoized on the query client, because the AC18 surface calls it from an effect
 * keyed on the reported transition: a fresh closure per render would re-enter that
 * effect on every render and re-read the Job_Description in a loop.
 */
export function useRefreshJob(): (jdId: string) => void {
  const queryClient = useQueryClient()
  return useCallback(
    (jdId: string) => {
      void queryClient.invalidateQueries({ queryKey: jobDetailQueryKey(jdId) })
    },
    [queryClient],
  )
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/**
 * One page of `GET /api/v1/admin/jobs` (AC17).
 *
 * The cache key is the request query, so a status filter and a cursor position
 * identify the page and walking back to a visited page re-renders rather than
 * re-reads.
 */
export function useAdminJobsQuery(
  status: JdStatus | null = null,
  afterId: string | null = null,
): UseQueryResult<JobBrowsePage> {
  const api = useApiClient()
  const query = adminJobsQuery(status, afterId)
  return useQuery({
    queryKey: adminJobsQueryKey(query),
    queryFn: ({ signal }) => adminListJobs(api, query, signal),
  })
}

/**
 * Polls one extraction draft until its status leaves `pending` (AC5).
 *
 * Disabled for an absent identifier, so no poll exists before an extraction has
 * been started. `refetchIntervalInBackground` is left off, so a hidden tab stops
 * polling and resumes when it is shown again.
 */
export function useExtractionDraftQuery(
  draftId: string | null,
): UseQueryResult<ExtractionDraft> {
  const api = useApiClient()
  const id = (draftId ?? '').trim()
  return useQuery({
    queryKey: extractionDraftQueryKey(id),
    queryFn: ({ signal }) => fetchExtractionDraft(api, id, signal),
    enabled: id !== '',
    // AC5: at most 5 seconds between polls, and no poll once terminal.
    refetchInterval: (query) => extractionPollInterval(query.state.data),
    // One interval of freshness, so the 202's seeded draft is not re-read on mount.
    staleTime: EXTRACTION_POLL_INTERVAL_MS,
    // The poll is the retry: a transient failure is re-asked on the next interval
    // rather than immediately, so a failing draft cannot busy-loop.
    retry: false,
  })
}

// ── Extraction mutations (AC3, AC4, AC9) ──────────────────────────────────────

/** Seeds the poll's cache entry from the 202 body (AC5). */
function useSeedExtractionDraft(): (draft: ExtractionDraft) => void {
  const queryClient = useQueryClient()
  return (draft: ExtractionDraft) => {
    if (draft.id !== '') {
      queryClient.setQueryData<ExtractionDraft>(extractionDraftQueryKey(draft.id), draft)
    }
  }
}

/** `POST /jobs/extract:url` as a mutation (AC3). */
export function useExtractFromUrl(): UseMutationResult<ExtractionDraft, unknown, string> {
  const api = useApiClient()
  const seed = useSeedExtractionDraft()
  return useMutation({
    mutationFn: (url: string) => extractJobFromUrl(api, url),
    onSuccess: seed,
  })
}

/** `POST /jobs/extract:text` as a mutation (AC4). */
export function useExtractFromText(): UseMutationResult<ExtractionDraft, unknown, string> {
  const api = useApiClient()
  const seed = useSeedExtractionDraft()
  return useMutation({
    mutationFn: (rawText: string) => extractJobFromText(api, rawText),
    onSuccess: seed,
  })
}

/** The variables of a confirmation: the draft being confirmed and its values (AC9). */
export interface ConfirmExtractionVariables {
  readonly draftId: string
  readonly body: JobCreateBody
}

/**
 * `POST /jobs/extract/{draft_id}:confirm` as a mutation (AC9).
 *
 * The only persistence request that exists for an extraction draft, and the caller
 * gates it on `canConfirmExtraction` — which is how AC10 holds: there is no other
 * code path from a draft to a stored Job_Description.
 */
export function useConfirmExtraction(): UseMutationResult<
  JobDescription,
  unknown,
  ConfirmExtractionVariables
> {
  const api = useApiClient()
  const adopt = useAdoptJob()
  return useMutation({
    mutationFn: ({ draftId, body }: ConfirmExtractionVariables) =>
      confirmExtractionDraft(api, draftId, body),
    onSuccess: adopt,
  })
}

// ── Lifecycle mutations (AC2, AC11, AC12, AC14, AC16) ─────────────────────────

/** `POST /jobs` as a mutation, from a submitted form draft (AC2). */
export function useCreateJob(): UseMutationResult<JobDescription, unknown, JobDraft> {
  const api = useApiClient()
  const adopt = useAdoptJob()
  return useMutation({
    mutationFn: (draft: JobDraft) => createJob(api, createJobBody(draft)),
    onSuccess: adopt,
  })
}

/** The variables of an edit: the Job_Description and the changed fields (AC11). */
export interface UpdateJobVariables {
  readonly jdId: string
  readonly body: JobUpdateBody
}

/** `PATCH /jobs/{jd_id}` as a mutation, sending changed fields only (AC11). */
export function useUpdateJob(): UseMutationResult<JobDescription, unknown, UpdateJobVariables> {
  const api = useApiClient()
  const adopt = useAdoptJob()
  return useMutation({
    mutationFn: ({ jdId, body }: UpdateJobVariables) => updateJob(api, jdId, body),
    onSuccess: adopt,
  })
}

/** `POST /jobs/{jd_id}:publish` as a mutation (AC12). */
export function usePublishJob(): UseMutationResult<JobDescription, unknown, string> {
  const api = useApiClient()
  const adopt = useAdoptJob()
  return useMutation({
    mutationFn: (jdId: string) => publishJob(api, jdId),
    onSuccess: adopt,
  })
}

/** `POST /jobs/{jd_id}:close` as a mutation (AC14). */
export function useCloseJob(): UseMutationResult<JobDescription, unknown, string> {
  const api = useApiClient()
  const adopt = useAdoptJob()
  return useMutation({
    mutationFn: (jdId: string) => closeJob(api, jdId),
    onSuccess: adopt,
  })
}

/** The variables of a channel change (AC16). */
export interface ApplicationChannelVariables {
  readonly jdId: string
  readonly channel: ApplicationChannel
}

/** `PUT /jobs/{jd_id}/application-channel` as a mutation (AC16). */
export function useSetApplicationChannel(): UseMutationResult<
  JobDescription,
  unknown,
  ApplicationChannelVariables
> {
  const api = useApiClient()
  const adopt = useAdoptJob()
  return useMutation({
    mutationFn: ({ jdId, channel }: ApplicationChannelVariables) =>
      setJobApplicationChannel(api, jdId, applicationChannelBody(channel)),
    onSuccess: adopt,
  })
}
