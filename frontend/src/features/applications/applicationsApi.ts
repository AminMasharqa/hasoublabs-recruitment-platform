/**
 * The five Application requests, issued through the Api_Client, and their cache
 * keys.
 *
 * | request | endpoint | requirement |
 * | --- | --- | --- |
 * | apply | `POST /jobs/{jd_id}/apply` | 14.2, 14.3, 14.4 |
 * | own Applications | `GET /me/applications` | 14.9, 14.10 |
 * | one own Application | `GET /me/applications/{application_id}` | 14.11 |
 * | applicants of a Job_Description | `GET /jobs/{jd_id}/applicants` | 14.12 |
 * | change a status | `PATCH /admin/applications/{application_id}/status` | 14.13 |
 *
 * Every one is a single call into {@link ApiClient.request}, so credential
 * attachment, `Accept-Language`, the 30-second budget, the read retry policy, the
 * 401 refresh-and-replay path, Error_Envelope decoding and the Support_Reference are
 * the Api_Client's (Requirement 3 AC1) rather than restated per screen. The path
 * templates are keys of the generated declarations, so a contract change that
 * renamed one fails `npm run typecheck` instead of a request at runtime.
 *
 * ## Why apply returns the raw response
 *
 * Requirement 14 AC3 and AC4 distinguish two *successes* — a 201 that recorded an
 * Application and a 200 that did not — and the generated declarations describe only
 * the 201. {@link submitApplication} therefore returns the classified
 * {@link ApplyOutcome} rather than a body: the status code is part of the answer, and
 * reading it here keeps `response.status` out of every calling component.
 *
 * Separate from `applicationQueries.ts` because these are plain promises with no
 * React in them: a test can drive the slice's data access with a stub Api_Client and
 * no renderer.
 *
 * Requirements: 14.2, 14.3, 14.4, 14.9, 14.10, 14.11, 14.12, 14.13.
 */

import type { ApiClient } from '../../api/client'
import type { ApplicationStatus } from '../../api/enums'

import {
  applicantsQueryParams,
  applicationStatusBody,
  applyBody,
  applyOutcome,
  myApplicationsQueryParams,
  type Application,
  type ApplicantCard,
  type ApplyOutcome,
} from './applicationRules'

// ── Paths ─────────────────────────────────────────────────────────────────────

/** `POST` path of an in-platform application (AC2). */
export const APPLY_PATH = '/api/v1/jobs/{jd_id}/apply'

/** `GET` path of the authenticated Candidate's own Applications (AC9). */
export const MY_APPLICATIONS_PATH = '/api/v1/me/applications'

/** `GET` path of one of the Candidate's own Applications (AC11). */
export const MY_APPLICATION_PATH = '/api/v1/me/applications/{application_id}'

/** `GET` path of the Applicant_Cards of one Job_Description (AC12). */
export const APPLICANTS_PATH = '/api/v1/jobs/{jd_id}/applicants'

/** `PATCH` path of an Application status (AC13). */
export const APPLICATION_STATUS_PATH = '/api/v1/admin/applications/{application_id}/status'

// ── Cache keys ────────────────────────────────────────────────────────────────

/** Root of every cache entry this slice owns, so one call can invalidate them all. */
export const APPLICATIONS_QUERY_SCOPE = 'applications' as const

/** Every cached page of the Candidate's own Application list (AC9, AC10). */
export const MY_APPLICATIONS_SCOPE_KEY: readonly unknown[] = [APPLICATIONS_QUERY_SCOPE, 'mine']

/**
 * Cache key of one page of the own-Application list (AC9, AC10).
 *
 * The request query is part of the identity of the page, so a cursor walk keeps each
 * visited page cached — pressing "next" and then going back re-renders rather than
 * re-reads.
 */
export function myApplicationsQueryKey(cursor: string | null): readonly unknown[] {
  return [...MY_APPLICATIONS_SCOPE_KEY, myApplicationsQueryParams(cursor)]
}

/** Every cached Application detail, whichever Application it is (AC11, AC14). */
export const APPLICATION_DETAIL_SCOPE_KEY: readonly unknown[] = [
  APPLICATIONS_QUERY_SCOPE,
  'detail',
]

/** Cache key of one Application detail (AC11). */
export function applicationQueryKey(applicationId: string): readonly unknown[] {
  return [...APPLICATION_DETAIL_SCOPE_KEY, applicationId]
}

/** Every cached applicant list, whichever Job_Description it belongs to (AC14). */
export const APPLICANTS_SCOPE_KEY: readonly unknown[] = [APPLICATIONS_QUERY_SCOPE, 'applicants']

/** Cache key of the applicant list of one Job_Description (AC12). */
export function applicantsQueryKey(
  jdId: string,
  status: ApplicationStatus | null = null,
): readonly unknown[] {
  return [...APPLICANTS_SCOPE_KEY, jdId, applicantsQueryParams(status)]
}

/** Every cache entry of the applicant list of one Job_Description (AC14). */
export function applicantsScopeKey(jdId: string): readonly unknown[] {
  return [...APPLICANTS_SCOPE_KEY, jdId]
}

// ── Requests ──────────────────────────────────────────────────────────────────

/**
 * `POST /jobs/{jd_id}/apply` — submits an application (AC2, AC3, AC4).
 *
 * Resolves with the classified outcome: the recorded Application of AC3, or the
 * external destination of AC4 that no in-platform Application accompanies. It never
 * opens that destination — AC5 reserves that for an explicit user action, so the
 * address is carried back to the dialog and rendered as a control.
 *
 * Rejects with the decoded Error_Envelope for every refusal, including the three
 * Requirement 14 names (AC6, AC7, AC8); classifying them is `applicationRules.ts`.
 */
export async function submitApplication(
  api: ApiClient,
  jdId: string,
  cvVariantId: string | null,
): Promise<ApplyOutcome> {
  const { data, response } = await api.request('post', APPLY_PATH, {
    params: { path: { jd_id: jdId } },
    body: applyBody(cvVariantId),
  })
  return applyOutcome(response.status, data)
}

/** `GET /me/applications` — one page of the Candidate's own Applications (AC9, AC10). */
export async function listMyApplications(
  api: ApiClient,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<readonly Application[]> {
  const { data } = await api.request('get', MY_APPLICATIONS_PATH, {
    params: { query: myApplicationsQueryParams(cursor) },
    ...(signal === undefined ? {} : { signal }),
  })
  return data
}

/** `GET /me/applications/{application_id}` — one own Application in full (AC11). */
export async function fetchMyApplication(
  api: ApiClient,
  applicationId: string,
  signal?: AbortSignal,
): Promise<Application> {
  const { data } = await api.request('get', MY_APPLICATION_PATH, {
    params: { path: { application_id: applicationId } },
    ...(signal === undefined ? {} : { signal }),
  })
  return data
}

/**
 * `GET /jobs/{jd_id}/applicants` — the Applicant_Cards of one Job_Description
 * (AC12).
 *
 * The restriction to three fields is the endpoint's: `ApplicantCardDTO` carries the
 * full name, the applied role title and the Application status and nothing else, so
 * there is no field for a screen to leak by accident.
 */
export async function listApplicants(
  api: ApiClient,
  jdId: string,
  status: ApplicationStatus | null,
  signal?: AbortSignal,
): Promise<readonly ApplicantCard[]> {
  const { data } = await api.request('get', APPLICANTS_PATH, {
    params: { path: { jd_id: jdId }, query: applicantsQueryParams(status) },
    ...(signal === undefined ? {} : { signal }),
  })
  return data
}

/**
 * `PATCH /admin/applications/{application_id}/status` — changes a status (AC13).
 *
 * Returns the updated Application, which is what the screen renders after a 200
 * rather than predicting where the transition led.
 */
export async function updateApplicationStatus(
  api: ApiClient,
  applicationId: string,
  status: ApplicationStatus,
  reason: string | null,
): Promise<Application> {
  const { data } = await api.request('patch', APPLICATION_STATUS_PATH, {
    params: { path: { application_id: applicationId } },
    body: applicationStatusBody(status, reason),
  })
  return data
}
