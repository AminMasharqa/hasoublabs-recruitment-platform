/**
 * The TanStack Query bindings of the CV_Version half of the slice: one polled
 * read, one upload and two downloads (Requirement 11 AC10–AC12, AC16, AC19).
 *
 * ## The scan poll is a query, not a loop
 *
 * AC12 asks for the version list to be re-queried at an interval of at most 10
 * seconds while any listed version reports `PendingScan`, until that version
 * reports something else or the Candidate leaves the screen. That is a single
 * query with a computed `refetchInterval` ({@link useCvVersionsQuery}) rather than
 * a `setInterval` in a component:
 *
 * - the interval is recomputed from the *last answer*, so the poll stops on the
 *   answer that resolves the last pending version — no extra request after it;
 * - leaving the screen unmounts the query, which tears the timer down and cancels
 *   the in-flight request through its `signal`, so nothing keeps polling behind a
 *   screen the Candidate has left;
 * - and the rest of the screen stays interactive throughout, because a poll is one
 *   more cache entry rather than a blocking wait.
 *
 * The upload seeds the same cache entry with the version its 202 returned
 * ({@link useUploadCvVersion}), so the new `PendingScan` row — and therefore the
 * poll — appears on the response rather than one round trip later (AC11).
 *
 * ## Why the upload hook owns the progress observation
 *
 * A transfer observation is not server state: it is not cacheable, not shareable
 * and meaningless once the request ends. It is held in component state here, next
 * to the mutation that produces it, so the surface renders one object and the
 * mutation's own lifecycle resets it (AC10).
 *
 * Requirements: 11.10, 11.11, 11.12, 11.15, 11.16, 11.19.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import { useApiClient } from '../../shell/appServices'

import { CV_VARIANTS_QUERY_KEY } from './variantApi'
import {
  adminCvVariantsQueryKey,
  adminListCvVariants,
  cvVersionsQueryKey,
  listCvVersions,
} from './versionApi'
import {
  adminDownloadCvVersion,
  deliverFile,
  downloadCvVersion,
  type AdminDownloadVersionRequest,
  type DownloadedFile,
  type DownloadVersionRequest,
} from './versionDownload'
import {
  applyUploadedVersion,
  versionsPollInterval,
  type CvUploadAccepted,
  type CvVersion,
  type UploadProgress,
} from './versionRules'
import { uploadCvVersion } from './versionUpload'
import type { CvVariant } from './variantRules'

/** The cached version list, as the upload reads and writes it. */
type CachedVersions = readonly CvVersion[] | undefined

/**
 * One variant's versions, re-read while any of them is still being scanned
 * (AC12, AC15).
 *
 * Disabled for an absent `variantId` — a screen whose path parameter named no
 * variant issues no request at all.
 */
export function useCvVersionsQuery(
  variantId: string | null | undefined,
): UseQueryResult<readonly CvVersion[]> {
  const api = useApiClient()
  const id = variantId ?? ''
  return useQuery({
    queryKey: cvVersionsQueryKey(id),
    queryFn: ({ signal }) => listCvVersions(api, id, signal),
    enabled: id !== '',
    // AC12: at most 10 seconds between reads, and no read at all once every
    // version has left `PendingScan`.
    refetchInterval: (query) => versionsPollInterval(query.state.data),
    // The poll itself is the retry: a transient failure is re-asked on the next
    // interval rather than immediately, so a failing read cannot busy-loop.
    retry: false,
  })
}

/** The upload mutation together with the transfer it is reporting (AC10). */
export interface CvVersionUpload {
  /** The mutation; `mutate` takes the selected file. */
  readonly mutation: UseMutationResult<CvUploadAccepted, unknown, File>
  /** The most recent transfer observation, or `null` before an upload starts. */
  readonly progress: UploadProgress | null
  /** Clears the outcome and the progress, e.g. when the Candidate picks another file. */
  readonly reset: () => void
}

/**
 * Uploads a file as a new version of one variant (AC10, AC11).
 *
 * On the 202 the returned version is written into the version cache entry and the
 * variant list is invalidated, because the variant's `version_count` (AC1) has
 * just changed. The version read is *not* invalidated: the seeded entry already
 * holds the new row, and the poll of AC12 is what refreshes its state.
 */
export function useUploadCvVersion(variantId: string): CvVersionUpload {
  const api = useApiClient()
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState<UploadProgress | null>(null)

  const mutation = useMutation({
    mutationFn: (file: File) =>
      uploadCvVersion(api, { variantId, file, onProgress: setProgress }),
    onMutate: () => {
      setProgress(null)
    },
    onSuccess: (accepted) => {
      queryClient.setQueryData<CachedVersions>(cvVersionsQueryKey(variantId), (current) =>
        applyUploadedVersion(current, accepted.version),
      )
      void queryClient.invalidateQueries({ queryKey: CV_VARIANTS_QUERY_KEY })
    },
  })

  const reset = useCallback(() => {
    setProgress(null)
    mutation.reset()
  }, [mutation])

  return { mutation, progress, reset }
}

/**
 * Downloads one version and hands it to the browser (AC16).
 *
 * A mutation rather than a query: it is a user action with an effect outside the
 * cache, it must not be retried automatically, and its result is not state any
 * screen re-renders from. A failure — including the `integrity_violation` of AC17
 * and the truncated transfer of AC18 — is surfaced from `mutation.error`, which the
 * download control renders.
 */
export function useDownloadCvVersion(): UseMutationResult<
  DownloadedFile,
  unknown,
  DownloadVersionRequest
> {
  const api = useApiClient()
  return useMutation({
    mutationFn: (request: DownloadVersionRequest) => downloadCvVersion(api, request),
    onSuccess: (file) => {
      deliverFile(file)
    },
  })
}

/** One Candidate's variants, as an Admin reads them (AC19). */
export function useAdminCvVariantsQuery(
  candidateId: string | null | undefined,
): UseQueryResult<readonly CvVariant[]> {
  const api = useApiClient()
  const id = candidateId ?? ''
  return useQuery({
    queryKey: adminCvVariantsQueryKey(id),
    queryFn: ({ signal }) => adminListCvVariants(api, id, signal),
    enabled: id !== '',
  })
}

/** The Admin download of any Candidate's version (AC19). */
export function useAdminDownloadCvVersion(): UseMutationResult<
  DownloadedFile,
  unknown,
  AdminDownloadVersionRequest
> {
  const api = useApiClient()
  return useMutation({
    mutationFn: (request: AdminDownloadVersionRequest) => adminDownloadCvVersion(api, request),
    onSuccess: (file) => {
      deliverFile(file)
    },
  })
}
