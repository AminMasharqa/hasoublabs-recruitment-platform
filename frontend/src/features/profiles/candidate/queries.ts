/**
 * The three Backend_Api calls the Candidate profile slice makes
 * (Requirement 9 AC1, AC8, AC14).
 *
 * Kept apart from the screens so the paths, the query keys and the decoding are
 * assertable without rendering anything, and so the Admin read (AC14) and the
 * Candidate's own read (AC1) cannot drift into two different shapes — they return
 * the same `CandidateProfileDTO`, and the only difference is which path carries
 * the account id.
 *
 * Note what is *not* here: no fallback, no retry policy, no error translation. The
 * Api_Client already retries an idempotent read, decodes every failure into an
 * Error_Envelope and records its Support_Reference, and the screens render that
 * through the Error_Presenter.
 */

import type { ApiClient } from '../../../api/client'

import type { CandidateProfile, CandidateProfileUpdate } from './model'

/** `GET`/`PUT` the authenticated Candidate's own profile (AC1, AC8). */
export const MY_PROFILE_PATH = '/api/v1/me/profile'

/** The Admin view of any Candidate's profile (AC14). */
export const ADMIN_CANDIDATE_PROFILE_PATH = '/api/v1/admin/candidates/{account_id}/profile'

/** Root of the query key space this slice owns. */
export const CANDIDATE_PROFILE_QUERY_ROOT = ['profiles', 'candidate'] as const

/** Query key of the authenticated Candidate's own profile. */
export const MY_PROFILE_QUERY_KEY = [...CANDIDATE_PROFILE_QUERY_ROOT, 'me'] as const

/** Query key of one Candidate's profile as an Admin reads it. */
export function adminCandidateProfileQueryKey(accountId: string): readonly unknown[] {
  return [...CANDIDATE_PROFILE_QUERY_ROOT, 'admin', accountId]
}

/** Reads the authenticated Candidate's profile (AC1). */
export async function fetchMyProfile(
  api: ApiClient,
  signal?: AbortSignal,
): Promise<CandidateProfile> {
  const { data } = await api.request('get', MY_PROFILE_PATH, {
    ...(signal === undefined ? {} : { signal }),
  })
  return data
}

/**
 * Saves the profile (AC8).
 *
 * Rejects with the `ApiFailure` the Api_Client decoded, so a 422 arrives at the
 * form with its `fieldViolations` already extracted (Req 3 AC9) and AC11 is a
 * matter of placing them.
 */
export async function saveMyProfile(
  api: ApiClient,
  body: CandidateProfileUpdate,
): Promise<CandidateProfile> {
  const { data } = await api.request('put', MY_PROFILE_PATH, { body })
  return data
}

/** Reads one Candidate's profile as an Admin (AC14). */
export async function fetchCandidateProfileAsAdmin(
  api: ApiClient,
  accountId: string,
  signal?: AbortSignal,
): Promise<CandidateProfile> {
  const { data } = await api.request('get', ADMIN_CANDIDATE_PROFILE_PATH, {
    params: { path: { account_id: accountId } },
    ...(signal === undefined ? {} : { signal }),
  })
  return data
}
