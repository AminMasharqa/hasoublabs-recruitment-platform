/**
 * The five CV_Variant requests, issued through the Api_Client.
 *
 * | request | requirement |
 * | --- | --- |
 * | `GET /me/cv-variants` | AC1 |
 * | `POST /me/cv-variants` | AC2 |
 * | `PATCH /me/cv-variants/{variant_id}` | AC4 |
 * | `DELETE /me/cv-variants/{variant_id}` | AC5 |
 * | `POST /me/cv-variants/{variant_id}/primary` | AC7 |
 *
 * Each is a one-line call into {@link ApiClient.request}, so credential
 * attachment, `Accept-Language`, the 30-second budget, the retry policy, the 401
 * refresh-and-replay path, error decoding and the Support_Reference are the
 * Api_Client's (Requirement 3 AC1) and not restated per screen. The path
 * templates are keys of the generated declarations, so a contract change that
 * renamed one of them fails `npm run typecheck` rather than a request at runtime.
 *
 * Separate from `variantQueries.ts` because these functions are plain promises
 * with no React in them: a test can drive the whole slice's data access with a
 * stub Api_Client and no renderer.
 *
 * Requirements: 11.1, 11.2, 11.4, 11.5, 11.7.
 */

import type { ApiClient } from '../../api/client'

import type { CreateVariantBody, CvVariant, UpdateVariantBody } from './variantRules'

/** `GET`/`POST` collection path of the authenticated Candidate's variants. */
export const CV_VARIANTS_PATH = '/api/v1/me/cv-variants'

/** `PATCH`/`DELETE` path of one variant. */
export const CV_VARIANT_PATH = '/api/v1/me/cv-variants/{variant_id}'

/** `POST` path that designates one variant as primary (AC7). */
export const CV_VARIANT_PRIMARY_PATH = '/api/v1/me/cv-variants/{variant_id}/primary'

/**
 * TanStack Query key of the variant list.
 *
 * The design's convention (`['me', 'cv-variants']`) — every mutation here
 * invalidates exactly this key, and the version keys task 17.2 adds are scoped
 * under `['cv-versions', variantId]` so a variant mutation does not discard them.
 */
export const CV_VARIANTS_QUERY_KEY = ['me', 'cv-variants'] as const

/** `GET /me/cv-variants` — the authenticated Candidate's variants (AC1). */
export async function listCvVariants(
  api: ApiClient,
  signal?: AbortSignal,
): Promise<readonly CvVariant[]> {
  const { data } = await api.request('get', CV_VARIANTS_PATH, {
    ...(signal === undefined ? {} : { signal }),
  })
  return data
}

/** `POST /me/cv-variants` — creates a variant (AC2). */
export async function createCvVariant(
  api: ApiClient,
  body: CreateVariantBody,
): Promise<CvVariant> {
  const { data } = await api.request('post', CV_VARIANTS_PATH, { body })
  return data
}

/** `PATCH /me/cv-variants/{variant_id}` — changes the name or description (AC4). */
export async function updateCvVariant(
  api: ApiClient,
  variantId: string,
  body: UpdateVariantBody,
): Promise<CvVariant> {
  const { data } = await api.request('patch', CV_VARIANT_PATH, {
    params: { path: { variant_id: variantId } },
    body,
  })
  return data
}

/**
 * `DELETE /me/cv-variants/{variant_id}` — archives a variant (AC5).
 *
 * Answers 204, so there is no body to return. The variant is not deleted: it
 * stays in the list with `is_archived` set, which is why the screens keep
 * rendering it (AC1).
 */
export async function archiveCvVariant(api: ApiClient, variantId: string): Promise<void> {
  await api.request('delete', CV_VARIANT_PATH, {
    params: { path: { variant_id: variantId } },
  })
}

/** `POST /me/cv-variants/{variant_id}/primary` — designates the primary variant (AC7). */
export async function setPrimaryCvVariant(
  api: ApiClient,
  variantId: string,
): Promise<CvVariant> {
  const { data } = await api.request('post', CV_VARIANT_PRIMARY_PATH, {
    params: { path: { variant_id: variantId } },
  })
  return data
}
