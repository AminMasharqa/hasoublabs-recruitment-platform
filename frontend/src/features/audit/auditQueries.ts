/**
 * The TanStack Query bindings of the Audit_Log_Viewer (Requirement 17 AC1–AC4,
 * AC6).
 *
 * Two reads, no mutations: browsing the Audit_Log is read-only (AC8), so nothing
 * here invalidates anything. The Api_Client already retries an idempotent read,
 * decodes every failure into an Error_Envelope and records its Support_Reference,
 * so these hooks add exactly two things — the cache key and, for the verification,
 * the fact that it runs on demand.
 *
 * ## Why the verification is a query that starts disabled
 *
 * AC6 makes chain verification an explicit user action, so it must not run when
 * the screen opens: a full chain walk is expensive on the Backend_Api and nobody
 * asked for it. Modelling it as a disabled query rather than as a mutation keeps
 * the three states Requirement 21 AC6/AC8 ask of every read — the loading
 * indicator, the localized error with its Support_Reference, the retry control —
 * and keeps the request classified as the read it is, so the Api_Client's
 * idempotent-retry policy applies to it.
 *
 * `staleTime: 0` is deliberate: a cached verdict is worthless, because the point
 * of pressing verify is to ask *now*.
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.6.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import { useApiClient } from '../../shell/appServices'

import {
  auditSearchQueryKey,
  chainVerifyQueryKey,
  searchAudit,
  verifyChain,
  type AuditSearchPage,
  type ChainVerifyReport,
} from './auditApi'
import { auditQueryParams, type AuditFilters } from './auditFilters'

/**
 * One page of `GET /api/v1/admin/audit` (AC1–AC4).
 *
 * The cache key is the request query itself, so two equal filter sets share one
 * entry and a cursor walk keeps each visited page cached — pressing "next" and
 * then going back re-renders rather than re-reads.
 */
export function useAuditSearchQuery(
  filters: AuditFilters,
  cursor: number | null = null,
): UseQueryResult<AuditSearchPage> {
  const api = useApiClient()
  const query = auditQueryParams(filters, cursor)
  return useQuery({
    queryKey: auditSearchQueryKey(query),
    queryFn: ({ signal }) => searchAudit(api, { filters, cursor, signal }),
  })
}

/**
 * The chain verification, on demand (AC6, AC7).
 *
 * Disabled until the caller enables it, which is what the verify control does; a
 * second press refetches through the returned `refetch`.
 */
export function useChainVerifyQuery(
  options: { readonly enabled?: boolean } = {},
): UseQueryResult<ChainVerifyReport> {
  const api = useApiClient()
  return useQuery({
    queryKey: chainVerifyQueryKey(),
    queryFn: ({ signal }) => verifyChain(api, signal),
    enabled: options.enabled ?? false,
    // Pressing verify is a request to check now, so nothing cached counts.
    staleTime: 0,
  })
}
