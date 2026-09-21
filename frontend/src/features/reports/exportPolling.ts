/**
 * The Excel export lifecycle, as pure logic (Requirement 18 AC6–AC9).
 *
 * An export is an asynchronous job: `POST /api/v1/admin/exports/{entity_type}`
 * answers 202 with a `job_id` and a non-terminal `status`, and
 * `GET /api/v1/admin/exports/{job_id}` reports that job until it reaches a
 * terminal value. Every decision the polling surface takes — keep polling or
 * stop, offer a download or not, render a failure or not — is one of the
 * functions here, so the screen holds no lifecycle rules of its own and the rules
 * are testable without a timer.
 *
 * ## The terminal set is derived, not listed
 *
 * `ExportStatus` is a contract union (`pending | running | ready | failed`).
 * {@link TERMINAL_EXPORT_STATUSES} is built with the same exhaustive-record
 * helper the Form_Validator uses, so a status the Backend_Api adds later is a
 * typecheck failure here rather than a job this client polls forever.
 *
 * ## Why the download URL is checked before it is offered
 *
 * `download_url` is a server-supplied absolute URL that a user activates. A value
 * carrying any scheme other than `http`/`https` — `javascript:`, `data:` — would
 * turn the download control into a script-execution or content-injection vector,
 * so {@link exportDownload} refuses to present one. AC8 makes readiness
 * conditional on a *populated* `download_url` anyway; this narrows "populated" to
 * "usable as a download".
 *
 * Requirements: 18.6, 18.7, 18.8, 18.9.
 */

import type { components } from '../../api/generated/schema'
import { enumValues, type EnumValues } from '../../forms/validators'

/** Lifecycle state of an export job, as the contract declares it. */
export type ExportStatus = components['schemas']['ExportStatus']

/** One export job, as both the 202 and the poll response describe it. */
export type ExportJob = components['schemas']['ExportStatusDTO']

/** The entity an export may be requested for (AC6). */
export type ExportEntityType = 'candidates' | 'job_descriptions' | 'applications'

/**
 * The three entity types AC6 enumerates.
 *
 * The contract types `entity_type` as a bare path string rather than as an
 * enumeration, so the set comes from the requirement; declaring it once here is
 * what keeps the Select options and the request path from drifting apart.
 */
export const EXPORT_ENTITY_TYPES: EnumValues<ExportEntityType> = enumValues<ExportEntityType>({
  candidates: true,
  job_descriptions: true,
  applications: true,
})

/** Every export status, in lifecycle order. */
export const EXPORT_STATUSES: EnumValues<ExportStatus> = enumValues<ExportStatus>({
  pending: true,
  running: true,
  ready: true,
  failed: true,
})

/**
 * The statuses that end the poll (AC7).
 *
 * Exhaustive over the contract union: adding a member to `ExportStatus` without
 * deciding whether it is terminal fails the typecheck.
 */
export const TERMINAL_EXPORT_STATUSES: EnumValues<Extract<ExportStatus, 'ready' | 'failed'>> =
  enumValues<Extract<ExportStatus, 'ready' | 'failed'>>({ ready: true, failed: true })

/** Requirement 18 AC7: poll at an interval of at most 5 seconds. */
export const EXPORT_POLL_INTERVAL_MS = 5_000

/** Whether a status ends the poll (AC7). */
export function isTerminalExportStatus(status: unknown): boolean {
  return TERMINAL_EXPORT_STATUSES.includes(status)
}

/** Whether a job is still being produced, i.e. whether the poll continues (AC7, AC10). */
export function isExportPolling(job: ExportJob | null | undefined): boolean {
  return job != null && !isTerminalExportStatus(job.status)
}

/**
 * The delay until the next poll, or `false` when the job is terminal (AC7).
 *
 * Shaped for TanStack Query's `refetchInterval`, which takes exactly this union.
 * An absent job — the poll has not answered yet — also polls, because the 202
 * that started it reported a non-terminal status.
 */
export function exportPollInterval(job: ExportJob | null | undefined): number | false {
  if (job != null && isTerminalExportStatus(job.status)) {
    return false
  }
  return EXPORT_POLL_INTERVAL_MS
}

/** Schemes a download control may open. */
const DOWNLOADABLE_SCHEMES: readonly string[] = ['http:', 'https:']

/**
 * Whether a server-supplied download URL is one this client will open.
 *
 * Absolute `http`/`https` only. A relative value is refused as well: the export
 * is delivered from object storage, so a relative URL would resolve against the
 * Web_Client origin and download the application's own HTML.
 */
export function isUsableDownloadUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    return false
  }
  try {
    return DOWNLOADABLE_SCHEMES.includes(new URL(value).protocol)
  } catch {
    return false
  }
}

/** The download an export offers, when it offers one (AC8). */
export type ExportDownload =
  | { readonly ready: true; readonly url: string; readonly expiresAt: string | null }
  | { readonly ready: false; readonly url: null; readonly expiresAt: null }

/** No download: the job is not ready, or carries no usable URL. */
const NO_DOWNLOAD: ExportDownload = Object.freeze({ ready: false, url: null, expiresAt: null })

/**
 * The download control's state (AC8).
 *
 * Ready only for a `ready` job with a usable `download_url`; a `ready` job whose
 * URL never arrived is treated as not yet downloadable rather than as a broken
 * control. `expires_at` rides along so the screen can render it beside the
 * control without re-reading the job.
 */
export function exportDownload(job: ExportJob | null | undefined): ExportDownload {
  if (job == null || job.status !== 'ready' || !isUsableDownloadUrl(job.download_url)) {
    return NO_DOWNLOAD
  }
  const expiresAt =
    typeof job.expires_at === 'string' && job.expires_at.trim() !== '' ? job.expires_at : null
  return { ready: true, url: job.download_url, expiresAt }
}

/**
 * The server-supplied failure message of a failed export, or `null` (AC9).
 *
 * Returned verbatim — no trimming, no substitution — because it is Backend_Api
 * text and may be Arabic or Hebrew (Requirement 19 AC10). A `failed` job that
 * carries no message yields `null`, and the screen renders its own localized
 * statement instead.
 */
export function exportErrorMessage(job: ExportJob | null | undefined): string | null {
  if (job == null || job.status !== 'failed') {
    return null
  }
  return typeof job.error_message === 'string' && job.error_message.trim() !== ''
    ? job.error_message
    : null
}

/** Whether a job reported failure (AC9). */
export function isExportFailed(job: ExportJob | null | undefined): boolean {
  return job != null && job.status === 'failed'
}

/**
 * The `job_id` a 202 advertised, or `null` when it advertised none (AC7).
 *
 * A response without a usable identifier leaves nothing to poll, so the screen
 * reports the request as failed rather than starting a poll against `undefined`.
 */
export function exportJobId(job: ExportJob | null | undefined): string | null {
  const id = job?.job_id
  return typeof id === 'string' && id.trim() !== '' ? id : null
}
