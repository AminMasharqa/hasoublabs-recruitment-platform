/**
 * Unit tests for the CV_Version decisions (task 17.2).
 *
 * Requirement 11:
 * - AC8/AC9 what a selection must satisfy before an upload is issued.
 * - AC10 the transferred byte percentage.
 * - AC11 where the 202's version lands in the cached list.
 * - AC12 whether the scan poll runs, and at what interval.
 * - AC13/AC14/AC16 which versions may be downloaded, and the stated reason when
 *   they may not.
 * - AC15 the descending listing order.
 * - AC17/AC18 classifying a failed download.
 * - AC19 the version numbers an Admin listing can address.
 *
 * Every assertion is over a plain array or a plain object: these are the decisions
 * the components delegate, so they are checked without a renderer or a request.
 */

import { describe, expect, it } from 'vitest'

import { BOUNDS } from '../../forms/validators'

import {
  adminVersionNumbers,
  applyUploadedVersion,
  canDownloadVersion,
  canUploadSelection,
  CV_UPLOAD_ACCEPT,
  CV_VERSION_STATES,
  declaredContentLength,
  downloadBlockedReason,
  hasPendingScan,
  INCOMPLETE_DOWNLOAD_ERROR,
  incompleteDownloadFailure,
  INTEGRITY_VIOLATION_ERROR,
  isAcceptedMediaType,
  isAvailable,
  isIncompleteDownload,
  isIntegrityViolation,
  isPendingScan,
  isQuarantined,
  isTruncatedTransfer,
  isWithinUploadBound,
  latestVersion,
  MAX_UPLOAD_BYTES,
  orderVersionsForDisplay,
  pendingScanVersions,
  uploadProgress,
  UPLOAD_FIELD_PATH,
  validateVersionSelection,
  VERSION_POLL_INTERVAL_MS,
  versionsPollInterval,
  type CvVersion,
  type CvVersionState,
} from './versionRules'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function version(
  versionNumber: number,
  state: CvVersionState = 'Available',
  overrides: Partial<CvVersion> = {},
): CvVersion {
  return {
    id: `ver-${versionNumber}`,
    variant_id: 'v1',
    version_number: versionNumber,
    state,
    original_filename: `cv-${versionNumber}.pdf`,
    mime_type: 'application/pdf',
    size_bytes: 1024,
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

const PDF = 'application/pdf'
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// ── The listing order (AC15) ──────────────────────────────────────────────────

describe('orderVersionsForDisplay (Req 11 AC15)', () => {
  it('orders by descending version number', () => {
    const ordered = orderVersionsForDisplay([version(1), version(3), version(2)])
    expect(ordered.map((entry) => entry.version_number)).toEqual([3, 2, 1])
  })

  it('keeps pending and quarantined versions in the list (AC14)', () => {
    const ordered = orderVersionsForDisplay([
      version(1, 'Available'),
      version(2, 'Quarantined'),
      version(3, 'PendingScan'),
    ])
    expect(ordered.map((entry) => entry.state)).toEqual(['PendingScan', 'Quarantined', 'Available'])
  })

  it('breaks a tie on the identifier and does not mutate its argument', () => {
    const input = [version(1, 'Available', { id: 'b' }), version(1, 'Available', { id: 'a' })]
    expect(orderVersionsForDisplay(input).map((entry) => entry.id)).toEqual(['a', 'b'])
    expect(input.map((entry) => entry.id)).toEqual(['b', 'a'])
  })

  it('treats an absent list as empty', () => {
    expect(orderVersionsForDisplay(null)).toEqual([])
    expect(latestVersion(undefined)).toBeNull()
    expect(latestVersion([version(1), version(7), version(3)])?.version_number).toBe(7)
  })
})

// ── The 202 (AC11) ────────────────────────────────────────────────────────────

describe('applyUploadedVersion (Req 11 AC11)', () => {
  it('adds the accepted version and keeps the list ordered', () => {
    const applied = applyUploadedVersion([version(1)], version(2, 'PendingScan'))
    expect(applied.map((entry) => entry.version_number)).toEqual([2, 1])
    expect(applied[0]?.state).toBe('PendingScan')
  })

  it('replaces rather than duplicates a version already in the list', () => {
    const applied = applyUploadedVersion(
      [version(1, 'PendingScan')],
      version(1, 'Available'),
    )
    expect(applied).toHaveLength(1)
    expect(applied[0]?.state).toBe('Available')
  })

  it('seeds an empty cache entry', () => {
    expect(applyUploadedVersion(undefined, version(1, 'PendingScan'))).toHaveLength(1)
  })
})

// ── Download gating (AC13, AC14, AC16) ────────────────────────────────────────

describe('download gating (Req 11 AC13, AC14, AC16)', () => {
  it('offers the download only for an Available version', () => {
    expect(canDownloadVersion(version(1, 'Available'))).toBe(true)
    expect(canDownloadVersion(version(1, 'PendingScan'))).toBe(false)
    expect(canDownloadVersion(version(1, 'Quarantined'))).toBe(false)
  })

  it('names the reason a download is refused', () => {
    expect(downloadBlockedReason(version(1, 'Available'))).toBeNull()
    expect(downloadBlockedReason(version(1, 'PendingScan'))).toBe('pending_scan')
    expect(downloadBlockedReason(version(1, 'Quarantined'))).toBe('quarantined')
  })

  it('refuses a state it does not recognize rather than guessing', () => {
    const unknown = { ...version(1), state: 'Rescanning' as CvVersionState }
    expect(downloadBlockedReason(unknown)).toBe('unknown_state')
    expect(canDownloadVersion(unknown)).toBe(false)
  })

  it('classifies each state exactly once', () => {
    expect(CV_VERSION_STATES.values).toEqual(['PendingScan', 'Available', 'Quarantined'])
    expect(isPendingScan(version(1, 'PendingScan'))).toBe(true)
    expect(isQuarantined(version(1, 'Quarantined'))).toBe(true)
    expect(isAvailable(version(1, 'Available'))).toBe(true)
  })
})

// ── The scan poll (AC12) ──────────────────────────────────────────────────────

describe('the scan poll (Req 11 AC12)', () => {
  it('polls at most every 10 seconds while a version is pending', () => {
    expect(VERSION_POLL_INTERVAL_MS).toBeLessThanOrEqual(10_000)
    expect(versionsPollInterval([version(1, 'PendingScan')])).toBe(VERSION_POLL_INTERVAL_MS)
    expect(hasPendingScan([version(1, 'Available'), version(2, 'PendingScan')])).toBe(true)
    expect(pendingScanVersions([version(1, 'Available'), version(2, 'PendingScan')])).toHaveLength(1)
  })

  it('stops as soon as no version is pending', () => {
    expect(versionsPollInterval([version(1, 'Available'), version(2, 'Quarantined')])).toBe(false)
    expect(versionsPollInterval([])).toBe(false)
  })

  it('does not poll before the first answer has arrived', () => {
    expect(versionsPollInterval(undefined)).toBe(false)
  })
})

// ── The selection (AC8, AC9) ──────────────────────────────────────────────────

describe('validateVersionSelection (Req 11 AC8, AC9)', () => {
  it('accepts both CV media types within the size bound', () => {
    expect(validateVersionSelection({ name: 'cv.pdf', size: 1024, type: PDF })).toEqual([])
    expect(validateVersionSelection({ name: 'cv.docx', size: 1024, type: DOCX })).toEqual([])
    expect(CV_UPLOAD_ACCEPT).toContain(PDF)
    expect(CV_UPLOAD_ACCEPT).toContain(DOCX)
  })

  it('refuses a selection over 10 MB with the size code and bound', () => {
    expect(MAX_UPLOAD_BYTES).toBe(BOUNDS.cv.maxUploadBytes)
    const issues = validateVersionSelection({
      name: 'cv.pdf',
      size: MAX_UPLOAD_BYTES + 1,
      type: PDF,
    })
    expect(issues.map((issue) => issue.code)).toEqual(['file_too_large'])
    expect(issues[0]?.path).toBe(UPLOAD_FIELD_PATH)
    expect(issues[0]?.params).toMatchObject({ maxBytes: MAX_UPLOAD_BYTES })
    // AC9: the upload request is not issued for a selection that fails a rule.
    expect(canUploadSelection({ name: 'cv.pdf', size: MAX_UPLOAD_BYTES + 1, type: PDF })).toBe(false)
  })

  it('accepts a file exactly at the bound', () => {
    expect(isWithinUploadBound({ name: 'cv.pdf', size: MAX_UPLOAD_BYTES, type: PDF })).toBe(true)
    expect(canUploadSelection({ name: 'cv.pdf', size: MAX_UPLOAD_BYTES, type: PDF })).toBe(true)
  })

  it('refuses another media type, and both rules together', () => {
    expect(isAcceptedMediaType({ name: 'cv.txt', size: 1, type: 'text/plain' })).toBe(false)
    const issues = validateVersionSelection({
      name: 'cv.txt',
      size: MAX_UPLOAD_BYTES + 1,
      type: 'text/plain',
    })
    expect(issues.map((issue) => issue.code)).toEqual(['unsupported_media_type', 'file_too_large'])
  })

  it('leaves a file the platform reported no media type for to the Backend_Api', () => {
    expect(isAcceptedMediaType({ name: 'cv.pdf', size: 1, type: '' })).toBe(true)
  })

  it('reports an absent selection as required', () => {
    expect(validateVersionSelection(null).map((issue) => issue.code)).toEqual(['required'])
    expect(canUploadSelection(null)).toBe(false)
  })
})

// ── Progress (AC10) ───────────────────────────────────────────────────────────

describe('uploadProgress (Req 11 AC10)', () => {
  it('reports the transferred byte percentage', () => {
    expect(uploadProgress(0, 400)).toMatchObject({ transferredBytes: 0, percentage: 0 })
    expect(uploadProgress(100, 400).percentage).toBe(25)
    expect(uploadProgress(400, 400).percentage).toBe(100)
  })

  it('never reports outside 0–100, whatever it is handed', () => {
    expect(uploadProgress(-10, 400).percentage).toBe(0)
    expect(uploadProgress(900, 400).percentage).toBe(100)
    expect(uploadProgress(Number.NaN, 400).percentage).toBe(0)
    expect(uploadProgress(1, 0).percentage).toBe(100)
  })
})

// ── Failed downloads (AC17, AC18) ─────────────────────────────────────────────

describe('failed downloads (Req 11 AC17, AC18)', () => {
  it('recognizes an integrity violation', () => {
    expect(isIntegrityViolation({ error: INTEGRITY_VIOLATION_ERROR, httpStatus: 500 })).toBe(true)
    expect(isIntegrityViolation({ error: 'not_authorized', httpStatus: 403 })).toBe(false)
    expect(isIntegrityViolation(new Error('boom'))).toBe(false)
  })

  it('reads the declared length, and treats an undeclared one as no declaration', () => {
    expect(declaredContentLength(new Headers({ 'Content-Length': '2048' }))).toBe(2048)
    expect(declaredContentLength(new Headers())).toBeNull()
    expect(declaredContentLength(new Headers({ 'Content-Length': 'many' }))).toBeNull()
  })

  it('calls a body short of its declared length truncated, and nothing else', () => {
    expect(isTruncatedTransfer(2048, 1024)).toBe(true)
    expect(isTruncatedTransfer(2048, 2048)).toBe(false)
    // No declaration to fall short of: a chunked response is not suspect.
    expect(isTruncatedTransfer(null, 1024)).toBe(false)
  })

  it('synthesizes a failure carrying the Support_Reference', () => {
    const failure = incompleteDownloadFailure({
      declaredBytes: 2048,
      receivedBytes: 1024,
      httpStatus: 200,
      supportReference: 'req-42',
    })
    expect(failure.error).toBe(INCOMPLETE_DOWNLOAD_ERROR)
    expect(isIncompleteDownload(failure)).toBe(true)
    expect(failure.supportReference).toBe('req-42')
    expect(failure.request_id).toBe('req-42')
    expect(failure.details).toEqual({ declared_bytes: 2048, received_bytes: 1024 })
    expect(failure.refreshEligible).toBe(false)
  })
})

// ── Admin version addressing (AC19) ───────────────────────────────────────────

describe('adminVersionNumbers (Req 11 AC19)', () => {
  it('addresses 1..version_count, newest first', () => {
    expect(adminVersionNumbers(3)).toEqual([3, 2, 1])
    expect(adminVersionNumbers(1)).toEqual([1])
  })

  it('offers nothing for a variant with no versions', () => {
    expect(adminVersionNumbers(0)).toEqual([])
    expect(adminVersionNumbers(-1)).toEqual([])
    expect(adminVersionNumbers(Number.NaN)).toEqual([])
  })
})
