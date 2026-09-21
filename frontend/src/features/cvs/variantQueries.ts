/**
 * The TanStack Query bindings of the CV_Variant slice: one read and four
 * mutations, each keyed on the list the screens render.
 *
 * Every mutation invalidates {@link CV_VARIANTS_QUERY_KEY} on success, so the
 * list a screen renders is always the Backend_Api's answer rather than a locally
 * patched guess — which matters most for the two guards of Requirement 11 AC3 and
 * AC6, since both are decided from the active-variant count of that very list.
 *
 * Two mutations additionally write the cache before the refetch lands:
 *
 * - `setPrimary` applies {@link applyPrimary}, so the moment the 200 arrives
 *   exactly one variant is rendered as primary (AC7) without waiting for a
 *   second round trip in which two badges — or none — could briefly show.
 * - `update` replaces the edited variant, so the new name appears immediately
 *   (AC4).
 *
 * Both writes are then reconciled by the invalidation, so neither can leave the
 * cache disagreeing with the server.
 *
 * Requirements: 11.1, 11.2, 11.4, 11.5, 11.7.
 */

import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'

import { useApiClient } from '../../shell/appServices'

import {
  archiveCvVariant,
  createCvVariant,
  CV_VARIANTS_QUERY_KEY,
  listCvVariants,
  setPrimaryCvVariant,
  updateCvVariant,
} from './variantApi'
import {
  applyPrimary,
  changedVariantFields,
  createBodyFrom,
  replaceVariant,
  type CvVariant,
  type VariantDraft,
} from './variantRules'

/** The cached variant list, as the mutations read and write it. */
type CachedVariants = readonly CvVariant[] | undefined

/** `GET /me/cv-variants` as a query (AC1). */
export function useCvVariantsQuery(): UseQueryResult<readonly CvVariant[]> {
  const api = useApiClient()
  return useQuery({
    queryKey: CV_VARIANTS_QUERY_KEY,
    queryFn: ({ signal }) => listCvVariants(api, signal),
  })
}

/** The variant-list invalidation every mutation below performs on success. */
function useInvalidateVariants(): () => void {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: CV_VARIANTS_QUERY_KEY })
  }
}

/** `POST /me/cv-variants` as a mutation (AC2). */
export function useCreateCvVariant(): UseMutationResult<CvVariant, unknown, VariantDraft> {
  const api = useApiClient()
  const invalidate = useInvalidateVariants()
  return useMutation({
    mutationFn: (draft: VariantDraft) => createCvVariant(api, createBodyFrom(draft)),
    onSuccess: invalidate,
  })
}

/** The variables of an edit: the variant being edited and the draft it produced. */
export interface UpdateVariantVariables {
  readonly variant: CvVariant
  readonly draft: VariantDraft
}

/** `PATCH /me/cv-variants/{variant_id}` as a mutation, sending changed fields only (AC4). */
export function useUpdateCvVariant(): UseMutationResult<CvVariant, unknown, UpdateVariantVariables> {
  const api = useApiClient()
  const queryClient = useQueryClient()
  const invalidate = useInvalidateVariants()
  return useMutation({
    mutationFn: ({ variant, draft }: UpdateVariantVariables) =>
      updateCvVariant(api, variant.id, changedVariantFields(variant, draft)),
    onSuccess: (updated) => {
      queryClient.setQueryData<CachedVariants>(CV_VARIANTS_QUERY_KEY, (current) =>
        replaceVariant(current, updated),
      )
      invalidate()
    },
  })
}

/** `DELETE /me/cv-variants/{variant_id}` as a mutation (AC5). */
export function useArchiveCvVariant(): UseMutationResult<void, unknown, string> {
  const api = useApiClient()
  const invalidate = useInvalidateVariants()
  return useMutation({
    mutationFn: (variantId: string) => archiveCvVariant(api, variantId),
    onSuccess: invalidate,
  })
}

/** `POST /me/cv-variants/{variant_id}/primary` as a mutation (AC7). */
export function useSetPrimaryCvVariant(): UseMutationResult<CvVariant, unknown, string> {
  const api = useApiClient()
  const queryClient = useQueryClient()
  const invalidate = useInvalidateVariants()
  return useMutation({
    mutationFn: (variantId: string) => setPrimaryCvVariant(api, variantId),
    onSuccess: (updated) => {
      // AC7: one primary, applied to the cached list on the response itself.
      queryClient.setQueryData<CachedVariants>(CV_VARIANTS_QUERY_KEY, (current) =>
        applyPrimary(replaceVariant(current, updated), updated.id),
      )
      invalidate()
    },
  })
}
