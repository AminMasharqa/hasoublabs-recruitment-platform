/**
 * The two reads the Audit_Log_Viewer issues, and their cache keys.
 *
 * | read | endpoint | requirement |
 * | --- | --- | --- |
 * | one page of the Audit_Log | `GET /api/v1/admin/audit` | 17.1–17.4 |
 * | chain verification | `GET /api/v1/admin/audit/chain/verify` | 17.6, 17.7 |
 *
 * Both go through the Api_Client (Requirement 3 AC1), so each carries the
 * Access_Token and the active Locale, obeys the 30-second budget, is retried as an
 * idempotent read and decodes its failure into an Error_Envelope the
 * Error_Presenter can render. Neither catches: a failure belongs to the screen's
 * error state, not to a silent empty result.
 *
 * ## Reads only, by construction (AC8)
 *
 * Requirement 17 AC8 forbids any control that edits or deletes an Audit_Log entry,
 * and this module is where that is enforced rather than merely observed: it
 * exports two functions, both `get`, and no mutation exists for a component to
 * call. The contract's third audit operation —
 * `POST /admin/audit/actors/{account_id}/anonymise` — is deliberately absent too.
 * It belongs to account deletion, not to audit browsing, and it is the one audit
 * write a reader of this slice might otherwise mistake for an editing control.
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.6, 17.8.
 */

import type { ApiClient } from '../../api/client'
import type { components } from '../../api/generated/schema'

import { auditQueryParams, type AuditFilters, type AuditQueryParams } from './auditFilters'

/** One Audit_Log entry, exactly as the contract describes it. */
export type AuditEntry = components['schemas']['AuditLogEntryDTO']

/** The actor identity snapshot an entry may carry. */
export type AuditActor = components['schemas']['AuditActorDTO']

/** One page of the search response, carrying `meta.has_more` and `meta.next_after_id`. */
export type AuditSearchPage = components['schemas']['AuditSearchResponse']

/** The result of one chain verification (AC6). */
export type ChainVerifyReport = components['schemas']['ChainVerifyResponse']

// ── Cache keys ────────────────────────────────────────────────────────────────

/**
 * Root of every cache entry this slice owns, so one call can invalidate them all.
 *
 * Spelled `['admin', 'audit', …]` as the design's key conventions have it, which
 * also keeps every Admin-only read under one prefix a context switch can drop.
 */
export const AUDIT_QUERY_SCOPE: readonly string[] = Object.freeze(['admin', 'audit'])

/** Cache key of one Audit_Log page: the query is the identity of the page (AC2, AC3). */
export function auditSearchQueryKey(query: AuditQueryParams): readonly unknown[] {
  return [...AUDIT_QUERY_SCOPE, 'search', query]
}

/** Cache key of the chain verification (AC6). */
export function chainVerifyQueryKey(): readonly unknown[] {
  return [...AUDIT_QUERY_SCOPE, 'chain', 'verify']
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/**
 * Reads one page of the Audit_Log (AC1–AC4).
 *
 * The page size and every applied filter come from {@link auditQueryParams}, so
 * the 20-row bound of AC3 and the filter-to-parameter mapping of AC2 live in one
 * pure function rather than in the call site.
 */
export async function searchAudit(
  api: ApiClient,
  args: {
    readonly filters: AuditFilters
    readonly cursor?: number | null
    readonly signal?: AbortSignal
  },
): Promise<AuditSearchPage> {
  const query = auditQueryParams(args.filters, args.cursor ?? null)
  const { data } = await api.request('get', '/api/v1/admin/audit', {
    params: { query },
    ...(args.signal === undefined ? {} : { signal: args.signal }),
  })
  return data
}

/**
 * Verifies the Audit_Log hash chain (AC6, AC7).
 *
 * No `start_id` is sent: the verify control asks whether the chain is intact, and
 * the endpoint's default walks it from the beginning. A partial walk would answer
 * a narrower question than the one the control offers.
 */
export async function verifyChain(
  api: ApiClient,
  signal?: AbortSignal,
): Promise<ChainVerifyReport> {
  const { data } = await api.request('get', '/api/v1/admin/audit/chain/verify', {
    ...(signal === undefined ? {} : { signal }),
  })
  return data
}
