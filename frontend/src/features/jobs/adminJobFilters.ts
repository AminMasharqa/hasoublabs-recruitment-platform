/**
 * The Admin listing's status filter and keyset cursor, as URL query parameters
 * (Requirement 13 AC17).
 *
 * Pure: no React, no Api_Client. The Admin listing screen reads both out of the
 * address bar and writes a changed filter back, which is what makes a filtered
 * listing linkable, reload-proof and navigable with the browser's own back button —
 * none of which a component-state filter is.
 *
 * The parameter names are the endpoint's own (`status`, `after_id`), so the address
 * bar and the request carry one vocabulary and a reviewer can read either off the
 * other.
 *
 * Requirements: 13.17.
 */

import type { JdStatus } from '../../api/enums'
import { JD_STATUS_VALUES } from '../../forms/validators'

/** Query parameter names, spelled as `GET /admin/jobs` spells them. */
export const ADMIN_JOBS_PARAM = {
  status: 'status',
  afterId: 'after_id',
} as const

/** Anything that reads like a `URLSearchParams`. */
export interface ReadableParams {
  get(name: string): string | null
}

/**
 * The status filter the address carries, or `null` for "every status" (AC17).
 *
 * A value outside the contract enumeration — a hand-edited URL, a stale link from
 * before a contract change — resolves to no filter rather than being forwarded, so a
 * crafted address lists every status instead of earning a 422.
 */
export function readAdminJobStatus(params: ReadableParams): JdStatus | null {
  const value = (params.get(ADMIN_JOBS_PARAM.status) ?? '').trim()
  return value !== '' && JD_STATUS_VALUES.includes(value) ? value : null
}

/** The keyset cursor the address carries, or `null` on the first page (AC17). */
export function readAdminJobsCursor(params: ReadableParams): string | null {
  const value = (params.get(ADMIN_JOBS_PARAM.afterId) ?? '').trim()
  return value === '' ? null : value
}

/**
 * The address of one listing page.
 *
 * A changed status drops the cursor by construction — the caller passes `null` — so
 * applying a filter starts a new keyset walk rather than resuming at a position that
 * belongs to a different result set.
 */
export function writeAdminJobsParams(
  status: JdStatus | null,
  afterId: string | null = null,
): URLSearchParams {
  const params = new URLSearchParams()
  if (status !== null) {
    params.set(ADMIN_JOBS_PARAM.status, status)
  }
  if (afterId !== null && afterId.trim() !== '') {
    params.set(ADMIN_JOBS_PARAM.afterId, afterId)
  }
  return params
}
