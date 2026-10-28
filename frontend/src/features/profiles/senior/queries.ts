/**
 * The three Backend_Api calls the Senior profile slice makes
 * (Requirement 10 AC1, AC9, AC12).
 *
 * Kept apart from the screens so the paths, the query keys and the decoding are
 * assertable without rendering anything, and so the Admin read (AC12) and the
 * Senior's own read (AC1) cannot drift into two different shapes — both return the
 * same `SeniorProfileDTO`, and the only difference is which path carries the
 * account id.
 *
 * Note what is *not* here: no fallback, no retry policy, no error translation. The
 * Api_Client already retries an idempotent read, decodes every failure into an
 * Error_Envelope and records its Support_Reference, and the screens render that
 * through the Error_Presenter.
 */

import type { ApiClient } from '../../../api/client'

import type { SeniorProfile, SeniorProfileUpdate } from './model'

/** `GET`/`PUT` the authenticated Senior's own profile (AC1, AC9). */
export const MY_SENIOR_PROFILE_PATH = '/api/v1/me/senior-profile'

/** The Admin view of any Senior's profile (AC12). */
export const ADMIN_SENIOR_PROFILE_PATH = '/api/v1/admin/seniors/{account_id}/profile'

/** Root of the query key space this slice owns. */
export const SENIOR_PROFILE_QUERY_ROOT = ['profiles', 'senior'] as const

/** Query key of the authenticated Senior's own profile. */
export const MY_SENIOR_PROFILE_QUERY_KEY = [...SENIOR_PROFILE_QUERY_ROOT, 'me'] as const

/** Query key of one Senior's profile as an Admin reads it. */
export function adminSeniorProfileQueryKey(accountId: string): readonly unknown[] {
  return [...SENIOR_PROFILE_QUERY_ROOT, 'admin', accountId]
}

/** Reads the authenticated Senior's profile (AC1). */
export async function fetchMySeniorProfile(
  api: ApiClient,
  signal?: AbortSignal,
): Promise<SeniorProfile> {
  const { data } = await api.request('get', MY_SENIOR_PROFILE_PATH, {
    ...(signal === undefined ? {} : { signal }),
  })
  return data
}

/**
 * Saves the profile (AC9).
 *
 * Rejects with the `ApiFailure` the Api_Client decoded, so a 422 arrives at the
 * form with its `fieldViolations` already extracted (Req 3 AC9) and placing them
 * is all that is left.
 */
export async function saveMySeniorProfile(
  api: ApiClient,
  body: SeniorProfileUpdate,
): Promise<SeniorProfile> {
  const { data } = await api.request('put', MY_SENIOR_PROFILE_PATH, { body })
  return data
}

/** Reads one Senior's profile as an Admin (AC12). */
export async function fetchSeniorProfileAsAdmin(
  api: ApiClient,
  accountId: string,
  signal?: AbortSignal,
): Promise<SeniorProfile> {
  const { data } = await api.request('get', ADMIN_SENIOR_PROFILE_PATH, {
    params: { path: { account_id: accountId } },
    ...(signal === undefined ? {} : { signal }),
  })
  return data
}
