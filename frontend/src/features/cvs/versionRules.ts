/**
 * The CV_Version decisions, as pure functions.
 *
 * Requirement 11 states the version half of the CV slice almost entirely as
 * predicates over a version list, so every one of them lives here rather than
 * inside a component:
 *
 * - **AC8/AC9** what the file input accepts, and the client-side refusal of a
 *   selection over 10 MB ({@link CV_UPLOAD_ACCEPT},
 *   {@link validateVersionSelection}).
 * - **AC12** whether the list still holds a `PendingScan` version, and therefore
 *   whether the poll continues and at what interval ({@link hasPendingScan},
 *   {@link versionsPollInterval}).
 * - **AC13/AC14/AC16** whether one version may be downloaded, and why not
 *   ({@link downloadBlockedReason}, {@link canDownloadVersion}).
 * - **AC15** the listing order: descending version number ({@link orderVersionsForDisplay}).
 * - **AC11** where the 202's version lands in the cached list
 *   ({@link applyUploadedVersion}).
 * - **AC17/AC18** classifying a failed download as an integrity violation or as a
 *   truncated transfer ({@link isIntegrityViolation}, {@link isTruncatedTransfer},
 *   {@link incompleteDownloadFailure}).
 *
 * AC14 and AC20 are satisfied by what is *absent* as much as by what is here: a
 * `Quarantined` version is never filtered out of the list, and no function
 * removes a version, because the endpoint set carries no per-version delete and
 * the Web_Client presents no control for one.
 *
 * No React, no Api_Client, no i18next: each rule is checkable from a unit test
 * against a plain array. The 10 MB bound and the two accepted media types are
 * read from `forms/validators.ts`, which mirrors the Backend_Api, so this module
 * cannot drift from it on its own.
 *
 * Requirements: 11.8, 11.9, 11.11, 11.12, 11.13, 11.14, 11.15, 11.16, 11.17,
 * 11.18, 11.20.
 */

import type { CvVersionState } from '../../api/enums'
import type { components } from '../../api/generated/schema'
import {
  BOUNDS,
  CV_UPLOAD_MEDIA_TYPES,
  enumValues,
  validateCvUploadSize,
  type EnumValues,
  type ValidationIssue,
} from '../../forms/validators'

/** One CV_Version, exactly as the Backend_Api describes it. */
export type CvVersion = components['schemas']['CvVersionDTO']

/** The 202 body of an upload: the accepted version plus the server's message (AC11). */
export type CvUploadAccepted = components['schemas']['CvUploadResponse']

export type { CvVersionState }

/**
 * The three availability states, as a runtime set.
 *
 * Exhaustive over the contract union, so a state the Backend_Api adds later is a
 * typecheck failure here — where the download gating and the poll condition are
 * decided — rather than a version this client silently treats as downloadable.
 */
export const CV_VERSION_STATES: EnumValues<CvVersionState> = enumValues<CvVersionState>({
  PendingScan: true,
  Available: true,
  Quarantined: true,
})

/** The maximum size of one upload, in bytes (AC9). */
export const MAX_UPLOAD_BYTES: number = BOUNDS.cv.maxUploadBytes

/** The two media types the file input accepts (AC8). */
export const UPLOAD_MEDIA_TYPES: readonly string[] = CV_UPLOAD_MEDIA_TYPES

/**
 * Filename extensions of the two accepted media types.
 *
 * Listed beside the media types in {@link CV_UPLOAD_ACCEPT} because a file picker
 * on some platforms filters by extension rather than by media type, and a PDF the
 * operating system reports with no media type would otherwise be unselectable.
 * They widen what the *picker* offers only; {@link validateVersionSelection}
 * still decides what may be submitted.
 */
export const UPLOAD_EXTENSIONS: readonly string[] = ['.pdf', '.docx']

/** The `accept` attribute of the file input (AC8). */
export const CV_UPLOAD_ACCEPT: string = [...UPLOAD_MEDIA_TYPES, ...UPLOAD_EXTENSIONS].join(',')

// ── The list (AC14, AC15) ─────────────────────────────────────────────────────

/**
 * The listing order: descending version number (AC15).
 *
 * The newest upload is what a Candidate came to see, and the identifier is the
 * tie-break so the order is total even if two rows ever reported the same number.
 * Archived, pending and quarantined versions are all included — nothing a
 * Candidate uploaded is ever hidden (AC14).
 */
export function orderVersionsForDisplay(
  versions: readonly CvVersion[] | null | undefined,
): readonly CvVersion[] {
  return [...(versions ?? [])].sort((left, right) => {
    const byNumber = right.version_number - left.version_number
    return byNumber === 0 ? left.id.localeCompare(right.id) : byNumber
  })
}

/** The version with the highest version number, or `null` for an empty list. */
export function latestVersion(
  versions: readonly CvVersion[] | null | undefined,
): CvVersion | null {
  return orderVersionsForDisplay(versions)[0] ?? null
}

/**
 * The cached list with `version` in it, ordered for display (AC11).
 *
 * Applied the moment the 202 arrives, so the accepted version — carrying its
 * `PendingScan` state — is rendered without waiting for the list read that
 * follows. A version already present is replaced rather than duplicated, which is
 * what makes a re-applied 202 (a remount, a replayed mutation) harmless.
 */
export function applyUploadedVersion(
  versions: readonly CvVersion[] | null | undefined,
  version: CvVersion,
): readonly CvVersion[] {
  const current = versions ?? []
  const replaced = current.some((entry) => entry.id === version.id)
    ? current.map((entry) => (entry.id === version.id ? version : entry))
    : [...current, version]
  return orderVersionsForDisplay(replaced)
}

// ── State predicates (AC12, AC13, AC14, AC16) ─────────────────────────────────

/** Whether the version is still being scanned (AC12, AC13). */
export function isPendingScan(version: CvVersion): boolean {
  return version.state === 'PendingScan'
}

/** Whether the version was quarantined by the scan (AC14). */
export function isQuarantined(version: CvVersion): boolean {
  return version.state === 'Quarantined'
}

/** Whether the version cleared the scan and may be delivered (AC16). */
export function isAvailable(version: CvVersion): boolean {
  return version.state === 'Available'
}

/** Why a version's download control is refused, mirroring AC13 and AC14. */
export type DownloadBlockedReason =
  /** AC13: the scan has not finished. */
  | 'pending_scan'
  /** AC14: the scan quarantined the file. */
  | 'quarantined'
  /** A state this client does not recognize — refused rather than guessed at. */
  | 'unknown_state'

/**
 * The reason a version may not be downloaded, or `null` while it may (AC13,
 * AC14, AC16).
 *
 * Only `Available` yields `null`. An unrecognized state is refused as
 * `unknown_state` rather than treated as downloadable, so a Backend_Api that
 * introduces a fourth state cannot make this client offer a file it knows nothing
 * about.
 */
export function downloadBlockedReason(version: CvVersion): DownloadBlockedReason | null {
  if (isAvailable(version)) {
    return null
  }
  if (isPendingScan(version)) {
    return 'pending_scan'
  }
  if (isQuarantined(version)) {
    return 'quarantined'
  }
  return 'unknown_state'
}

/** Whether a version's download control is available (AC16). */
export function canDownloadVersion(version: CvVersion): boolean {
  return downloadBlockedReason(version) === null
}

/** Every version still awaiting its scan result (AC12). */
export function pendingScanVersions(
  versions: readonly CvVersion[] | null | undefined,
): readonly CvVersion[] {
  return (versions ?? []).filter(isPendingScan)
}

/** Whether the list still holds a `PendingScan` version, i.e. whether the poll runs (AC12). */
export function hasPendingScan(versions: readonly CvVersion[] | null | undefined): boolean {
  return pendingScanVersions(versions).length > 0
}

// ── The scan poll (AC12) ──────────────────────────────────────────────────────

/** Requirement 11 AC12: re-query at an interval of at most 10 seconds. */
export const VERSION_POLL_INTERVAL_MS = 10_000

/**
 * The delay until the next version read, or `false` when no version is pending
 * (AC12).
 *
 * Shaped for TanStack Query's `refetchInterval`, which takes exactly this union.
 * An absent list — the first read has not answered yet — does *not* poll: there
 * is already a request in flight, and its answer is what decides whether a poll
 * is needed at all.
 */
export function versionsPollInterval(
  versions: readonly CvVersion[] | null | undefined,
): number | false {
  if (versions == null) {
    return false
  }
  return hasPendingScan(versions) ? VERSION_POLL_INTERVAL_MS : false
}

// ── The selection (AC8, AC9) ──────────────────────────────────────────────────

/** The form path both selection issues address, so each renders beside the input. */
export const UPLOAD_FIELD_PATH = 'file'

/** What {@link validateVersionSelection} needs of a selected file. */
export interface SelectedFile {
  readonly name: string
  readonly size: number
  readonly type: string
}

/**
 * Whether a selected file carries one of the two accepted media types (AC8).
 *
 * A file the operating system reported no media type for is accepted here and
 * left to the Backend_Api, which validates the document structure itself: an
 * empty `type` is the platform declining to answer, not the Candidate choosing
 * the wrong file.
 */
export function isAcceptedMediaType(file: SelectedFile): boolean {
  return file.type === '' || UPLOAD_MEDIA_TYPES.includes(file.type)
}

/** Whether a selected file is within the 10 MB bound (AC9). */
export function isWithinUploadBound(file: SelectedFile): boolean {
  return validateCvUploadSize(file.size, UPLOAD_FIELD_PATH) === null
}

/**
 * The client-side rules a selection must clear before the upload is issued (AC8,
 * AC9).
 *
 * Returns every issue at once so the input can render them together. An empty
 * result is the only state in which {@link import('./versionUpload').uploadCvVersion}
 * is called, which is what makes AC9's "SHALL NOT issue the upload request"
 * structural rather than a habit: the control that submits is disabled while this
 * list is non-empty.
 *
 * The size message comes from the Form_Validator, so the wording and the bound
 * are the same ones every other size-bounded input uses; the media-type message
 * is this slice's own catalogue entry.
 */
export function validateVersionSelection(
  file: SelectedFile | null | undefined,
): readonly ValidationIssue[] {
  if (file == null) {
    return [
      { path: UPLOAD_FIELD_PATH, code: 'required', messageKey: 'cvs.upload.selectionRequired' },
    ]
  }
  const issues: ValidationIssue[] = []
  if (!isAcceptedMediaType(file)) {
    issues.push({
      path: UPLOAD_FIELD_PATH,
      code: 'unsupported_media_type',
      messageKey: 'cvs.upload.unsupportedMediaType',
    })
  }
  const tooLarge = validateCvUploadSize(file.size, UPLOAD_FIELD_PATH)
  if (tooLarge !== null) {
    issues.push(tooLarge)
  }
  return issues
}

/** Whether a selection may be submitted (AC9). */
export function canUploadSelection(file: SelectedFile | null | undefined): boolean {
  return file != null && validateVersionSelection(file).length === 0
}

// ── Upload progress (AC10) ────────────────────────────────────────────────────

/** One observation of an upload's transfer (AC10). */
export interface UploadProgress {
  /** Bytes of the request body handed to the transport so far. */
  readonly transferredBytes: number
  /** Total bytes of the request body. */
  readonly totalBytes: number
  /** Whole-percent fraction of {@link totalBytes} transferred, 0–100. */
  readonly percentage: number
}

/**
 * The transferred byte percentage of an upload (AC10).
 *
 * Whole percent, clamped to 0–100, so the rendered indicator can never report a
 * figure outside the range a progress bar declares. A zero total — an empty
 * selection, which the selection rules already refuse — reports 100 rather than
 * dividing by zero.
 */
export function uploadProgress(transferredBytes: number, totalBytes: number): UploadProgress {
  const total = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0
  const transferred = Number.isFinite(transferredBytes)
    ? Math.min(Math.max(transferredBytes, 0), total === 0 ? 0 : total)
    : 0
  const percentage = total === 0 ? 100 : Math.min(100, Math.round((transferred / total) * 100))
  return { transferredBytes: transferred, totalBytes: total, percentage }
}

/** Receives every {@link UploadProgress} observation of one upload (AC10). */
export type UploadProgressListener = (progress: UploadProgress) => void

// ── Download failures (AC17, AC18) ────────────────────────────────────────────

/** The Error_Envelope `error` member of a failed integrity check (AC17). */
export const INTEGRITY_VIOLATION_ERROR = 'integrity_violation'

/**
 * The `error` member this slice synthesizes for a truncated download (AC18).
 *
 * Not a Backend_Api key: the response *started* successfully and then stopped, so
 * there is no envelope to decode. Giving the outcome a key of its own is what lets
 * the download surface render the localized incomplete-download message — the
 * generic failure entry would say nothing about the partial file having been
 * discarded.
 */
export const INCOMPLETE_DOWNLOAD_ERROR = 'incomplete_download'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The `error` member of a failure, or `null` when it carries none. */
function errorKeyOf(value: unknown): string | null {
  if (!isRecord(value)) {
    return null
  }
  return typeof value.error === 'string' && value.error !== '' ? value.error : null
}

/** Whether a failed download reported an integrity violation (AC17). */
export function isIntegrityViolation(error: unknown): boolean {
  return errorKeyOf(error) === INTEGRITY_VIOLATION_ERROR
}

/** Whether a failed download terminated before its declared length (AC18). */
export function isIncompleteDownload(error: unknown): boolean {
  return errorKeyOf(error) === INCOMPLETE_DOWNLOAD_ERROR
}

/**
 * The declared length of a response body, or `null` when none was declared.
 *
 * A chunked response carries no `Content-Length`, and `null` then means "no
 * declaration to fall short of" — {@link isTruncatedTransfer} treats such a
 * transfer as complete rather than as suspect, because there is nothing to
 * compare it against.
 */
export function declaredContentLength(headers: Headers | null | undefined): number | null {
  const raw = headers?.get('Content-Length') ?? null
  if (raw === null || !/^\d+$/.test(raw.trim())) {
    return null
  }
  const declared = Number.parseInt(raw.trim(), 10)
  return Number.isFinite(declared) ? declared : null
}

/** Whether a read body fell short of the length the response declared (AC18). */
export function isTruncatedTransfer(
  declaredBytes: number | null,
  receivedBytes: number,
): boolean {
  return declaredBytes !== null && receivedBytes < declaredBytes
}

/**
 * The failure a truncated download rejects with (AC18).
 *
 * Shaped like a decoded {@link import('../../api/errors').ApiError} — an `error`
 * member plus `supportReference` — so the Error_Presenter and the
 * Support_Reference surface read it exactly as they read a Backend_Api envelope,
 * and so `errors/errorMessages.ts` can resolve its reference without a special
 * case. The `httpStatus` is the 200 the response actually carried: the request
 * succeeded, the transfer did not.
 */
export interface IncompleteDownloadFailure {
  readonly error: typeof INCOMPLETE_DOWNLOAD_ERROR
  readonly message: null
  readonly details: {
    readonly declared_bytes: number | null
    readonly received_bytes: number
  }
  readonly request_id: string | null
  readonly httpStatus: number
  readonly supportReference: string | null
  readonly refreshEligible: false
  readonly authOutcome: 'other'
  readonly fieldViolations: readonly never[]
}

/** Builds the {@link IncompleteDownloadFailure} of a truncated transfer (AC18). */
export function incompleteDownloadFailure(options: {
  readonly declaredBytes: number | null
  readonly receivedBytes: number
  readonly httpStatus: number
  readonly supportReference: string | null
}): IncompleteDownloadFailure {
  return Object.freeze({
    error: INCOMPLETE_DOWNLOAD_ERROR,
    message: null,
    details: Object.freeze({
      declared_bytes: options.declaredBytes,
      received_bytes: options.receivedBytes,
    }),
    request_id: options.supportReference,
    httpStatus: options.httpStatus,
    supportReference: options.supportReference,
    refreshEligible: false,
    authOutcome: 'other',
    fieldViolations: Object.freeze([]),
  })
}

// ── Admin version addressing (AC19) ───────────────────────────────────────────

/**
 * The version numbers of a variant the Admin listing can address (AC19).
 *
 * The Admin endpoint set carries a variant listing and a per-version download,
 * but *no* version listing — so the only thing an Admin screen knows about a
 * variant's versions is the `version_count` the variant DTO reports. Version
 * numbers are assigned from 1 upward per variant, so the addressable set is
 * `1..version_count`, descending to match AC15's ordering.
 *
 * Returns an empty list for a variant with no versions, which is what keeps the
 * Admin surface from rendering a download control that could only 404.
 */
export function adminVersionNumbers(versionCount: number): readonly number[] {
  if (!Number.isFinite(versionCount) || versionCount < 1) {
    return []
  }
  const count = Math.floor(versionCount)
  return Array.from({ length: count }, (_unused, index) => count - index)
}
