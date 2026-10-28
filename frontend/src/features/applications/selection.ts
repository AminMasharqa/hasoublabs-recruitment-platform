/**
 * Which Job_Description an applicant list is about, and which Application the Admin
 * status control acts on, when the route does not say.
 *
 * Two of the applicant destinations carry no Job_Description in their path:
 * `/senior/applicants` and `/admin/applications` are menu destinations
 * (Requirement 8 AC7, AC8), not per-role addresses. Both read the Job_Description
 * from a `jd` query parameter, so the address remains the whole state of the screen —
 * linkable, reload-proof and back-button-navigable — exactly as the job browse
 * filters are. The per-role address `/senior/jobs/:jdId/applicants` takes it from the
 * path instead and does not need this module.
 *
 * The Application identifier is spelled `application_id`, which is the parameter the
 * reports slice already addresses the Admin Application destination with
 * (`features/reports/drilldowns.ts`). It is read from there rather than re-declared,
 * so a drill-down out of the candidate-progress report lands on an Application this
 * screen actually narrows to — the two cannot drift apart.
 *
 * Pure: no React, no router.
 *
 * Requirements: 14.12, 14.13, 18.5.
 */

import { APPLICATION_DRILLDOWN_PARAM } from '../reports/drilldowns'

/** Query parameter naming the Job_Description an applicant list is about (AC12). */
export const JD_PARAM = 'jd'

/**
 * Query parameter carrying the keyset cursor of the own-Application list (AC10).
 *
 * Spelled exactly as `GET /me/applications` spells it, so the address bar and the
 * request carry one vocabulary and the cursor needs no translation between them.
 */
export const APPLICATIONS_CURSOR_PARAM = 'after_id'

/** Query parameter naming the Application the status control acts on (AC13). */
export const APPLICATION_PARAM: string = APPLICATION_DRILLDOWN_PARAM

/** Anything that reads like a `URLSearchParams`. */
export interface ReadableSearchParams {
  get(name: string): string | null
}

function trimmed(params: ReadableSearchParams, name: string): string {
  const value = params.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * The Job_Description identifier the address names, or `''` when it names none.
 *
 * `''` rather than `null` so the value feeds straight into a controlled text input;
 * the screens read it as "no Job_Description selected" and issue no request.
 */
export function readJdId(params: ReadableSearchParams): string {
  return trimmed(params, JD_PARAM)
}

/** The Application identifier the address names, or `''` when it names none (AC13). */
export function readApplicationId(params: ReadableSearchParams): string {
  return trimmed(params, APPLICATION_PARAM)
}

/** The keyset cursor the current location carries, or `null` for the first page (AC10). */
export function readApplicationsCursor(params: ReadableSearchParams): string | null {
  const cursor = trimmed(params, APPLICATIONS_CURSOR_PARAM)
  return cursor === '' ? null : cursor
}

/** The address of the page beginning after `afterId` (AC10). */
export function writeApplicationsCursor(afterId: string): URLSearchParams {
  const params = new URLSearchParams()
  const cursor = afterId.trim()
  if (cursor !== '') {
    params.set(APPLICATIONS_CURSOR_PARAM, cursor)
  }
  return params
}

/**
 * The address for one Job_Description's applicants, retaining a named Application.
 *
 * Selecting a different Job_Description keeps the Admin's Application selection —
 * the two are independent choices on the Admin screen — but drops everything else,
 * because any other parameter names a position in the previous list.
 */
export function writeSelection(
  selection: { readonly jdId?: string; readonly applicationId?: string } = {},
): URLSearchParams {
  const params = new URLSearchParams()
  const jdId = (selection.jdId ?? '').trim()
  const applicationId = (selection.applicationId ?? '').trim()
  if (jdId !== '') {
    params.set(JD_PARAM, jdId)
  }
  if (applicationId !== '') {
    params.set(APPLICATION_PARAM, applicationId)
  }
  return params
}
