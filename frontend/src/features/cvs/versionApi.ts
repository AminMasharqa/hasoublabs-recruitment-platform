/**
 * The CV_Version requests, issued through the Api_Client.
 *
 * | request | requirement |
 * | --- | --- |
 * | `GET /me/cv-variants/{variant_id}/versions` | AC12, AC15 |
 * | `POST /me/cv-variants/{variant_id}/versions` | AC10, AC11 (see `versionUpload.ts`) |
 * | `GET /me/cv-variants/{variant_id}/versions/{version_number}/download` | AC16 |
 * | `GET /admin/candidates/{candidate_id}/cv-variants` | AC19 |
 * | `GET /admin/candidates/{candidate_id}/cv-variants/{variant_id}/versions/{version_number}/download` | AC19 |
 *
 * Each read is a one-line call into {@link ApiClient.request}, so credential
 * attachment, `Accept-Language`, the request budget, the retry policy, the 401
 * refresh-and-replay path, error decoding and the Support_Reference stay the
 * Api_Client's concern (Requirement 3 AC1). The path templates are keys of the
 * generated declarations, so a contract change that renamed one of them fails
 * `npm run typecheck` rather than a request at runtime.
 *
 * The Admin-only scoping of AC19 is not enforced here: it is a property of the
 * route the Admin surface is mounted on, which is what keeps these two requests
 * from being issued at all in a Candidate or Senior context.
 *
 * The upload lives in `versionUpload.ts` because its body — not its dispatch — is
 * the whole of its complexity, and the download in `versionDownload.ts` because
 * delivering a file to the browser is a different concern from asking for it.
 *
 * Requirements: 11.12, 11.15, 11.16, 11.19.
 */

import type { ApiClient } from '../../api/client'

import type { CvVariant } from './variantRules'
import type { CvVersion } from './versionRules'
import { CV_VERSIONS_PATH } from './versionUpload'

export { CV_VERSIONS_PATH }

/** `GET` path of one version's bytes (AC16). */
export const CV_VERSION_DOWNLOAD_PATH =
  '/api/v1/me/cv-variants/{variant_id}/versions/{version_number}/download'

/** `GET` path of any Candidate's variants, for an Admin (AC19). */
export const ADMIN_CV_VARIANTS_PATH = '/api/v1/admin/candidates/{candidate_id}/cv-variants'

/** `GET` path of any Candidate's version bytes, for an Admin (AC19). */
export const ADMIN_CV_VERSION_DOWNLOAD_PATH =
  '/api/v1/admin/candidates/{candidate_id}/cv-variants/{variant_id}/versions/{version_number}/download'

// ── Cache keys ────────────────────────────────────────────────────────────────

/** Root of every version cache entry, per the design's key convention. */
export const CV_VERSIONS_QUERY_SCOPE = 'cv-versions' as const

/**
 * TanStack Query key of one variant's versions (AC12, AC15).
 *
 * `['cv-versions', variantId]` — scoped under its own root rather than under the
 * variant list's `['me', 'cv-variants']`, so a variant mutation invalidating that
 * list does not discard the version entries, and the scan poll of AC12 is not
 * restarted by an unrelated rename.
 */
export function cvVersionsQueryKey(variantId: string): readonly unknown[] {
  return [CV_VERSIONS_QUERY_SCOPE, variantId]
}

/** TanStack Query key of one Candidate's variants as an Admin reads them (AC19). */
export function adminCvVariantsQueryKey(candidateId: string): readonly unknown[] {
  return ['admin', 'candidate-cv-variants', candidateId]
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/**
 * `GET /me/cv-variants/{variant_id}/versions` — every version of one variant
 * (AC15), and the request the scan poll of AC12 repeats.
 */
export async function listCvVersions(
  api: ApiClient,
  variantId: string,
  signal?: AbortSignal,
): Promise<readonly CvVersion[]> {
  const { data } = await api.request('get', CV_VERSIONS_PATH, {
    params: { path: { variant_id: variantId } },
    ...(signal === undefined ? {} : { signal }),
  })
  return data
}

/**
 * `GET /admin/candidates/{candidate_id}/cv-variants` — any Candidate's variants
 * (AC19).
 *
 * Returns archived variants too, which is deliberate on an Admin surface: the
 * reason an Admin reads a Candidate's CVs is usually to find one that is no longer
 * the active choice.
 */
export async function adminListCvVariants(
  api: ApiClient,
  candidateId: string,
  signal?: AbortSignal,
): Promise<readonly CvVariant[]> {
  const { data } = await api.request('get', ADMIN_CV_VARIANTS_PATH, {
    params: { path: { candidate_id: candidateId } },
    ...(signal === undefined ? {} : { signal }),
  })
  return data
}
