/**
 * Unit tests for the export lifecycle (task 24.1).
 *
 * Requirement 18:
 * - AC6 the three entity types an export may be requested for.
 * - AC7 the poll interval is at most 5 seconds and stops at a terminal status.
 * - AC8 readiness requires a populated, usable `download_url`, and `expires_at`
 *   travels with it.
 * - AC9 a failed job exposes its `error_message`.
 */

import { describe, expect, it } from 'vitest'

import {
  EXPORT_ENTITY_TYPES,
  EXPORT_POLL_INTERVAL_MS,
  exportDownload,
  exportErrorMessage,
  exportJobId,
  exportPollInterval,
  isExportFailed,
  isExportPolling,
  isTerminalExportStatus,
  isUsableDownloadUrl,
  type ExportJob,
  type ExportStatus,
} from './exportPolling'

function jobFixture(overrides: Partial<ExportJob> = {}): ExportJob {
  return {
    created_at: '2024-04-01T08:00:00Z',
    download_url: null,
    entity_type: 'candidates',
    error_message: null,
    expires_at: null,
    job_id: 'job-1',
    status: 'pending',
    ...overrides,
  }
}

describe('the entity types an export may be requested for (Req 18 AC6)', () => {
  it('offers exactly candidates, job_descriptions and applications', () => {
    expect(EXPORT_ENTITY_TYPES.values).toEqual(['candidates', 'job_descriptions', 'applications'])
    expect(EXPORT_ENTITY_TYPES.includes('accounts')).toBe(false)
  })
})

describe('the poll interval (Req 18 AC7)', () => {
  it('polls a non-terminal job at most every 5 seconds', () => {
    expect(EXPORT_POLL_INTERVAL_MS).toBeLessThanOrEqual(5_000)
    for (const status of ['pending', 'running'] satisfies ExportStatus[]) {
      expect(exportPollInterval(jobFixture({ status }))).toBe(EXPORT_POLL_INTERVAL_MS)
      expect(isExportPolling(jobFixture({ status }))).toBe(true)
    }
  })

  it('stops polling once the status is terminal', () => {
    for (const status of ['ready', 'failed'] satisfies ExportStatus[]) {
      expect(isTerminalExportStatus(status)).toBe(true)
      expect(exportPollInterval(jobFixture({ status }))).toBe(false)
      expect(isExportPolling(jobFixture({ status }))).toBe(false)
    }
  })

  it('polls while no observation has arrived yet', () => {
    // The 202 reported a non-terminal status, so an absent poll answer still polls.
    expect(exportPollInterval(null)).toBe(EXPORT_POLL_INTERVAL_MS)
    expect(isExportPolling(null)).toBe(false)
  })
})

describe('the download control (Req 18 AC8)', () => {
  it('offers the download and the expiry of a ready job', () => {
    const job = jobFixture({
      status: 'ready',
      download_url: 'https://files.example.test/export.xlsx',
      expires_at: '2024-04-01T09:00:00Z',
    })
    expect(exportDownload(job)).toEqual({
      ready: true,
      url: 'https://files.example.test/export.xlsx',
      expiresAt: '2024-04-01T09:00:00Z',
    })
  })

  it('offers nothing while the job is not ready', () => {
    const running = jobFixture({
      status: 'running',
      download_url: 'https://files.example.test/export.xlsx',
    })
    expect(exportDownload(running).ready).toBe(false)
  })

  it('offers nothing for a ready job whose download URL is absent or unusable', () => {
    expect(exportDownload(jobFixture({ status: 'ready' })).ready).toBe(false)
    expect(
      exportDownload(jobFixture({ status: 'ready', download_url: '   ' })).ready,
    ).toBe(false)
    // A non-http scheme would make the control a script vector.
    expect(
      exportDownload(jobFixture({ status: 'ready', download_url: 'javascript:alert(1)' })).ready,
    ).toBe(false)
    // A relative value would download the application's own HTML.
    expect(
      exportDownload(jobFixture({ status: 'ready', download_url: '/exports/export.xlsx' })).ready,
    ).toBe(false)
  })

  it('accepts only absolute http and https URLs', () => {
    expect(isUsableDownloadUrl('https://files.example.test/a.xlsx')).toBe(true)
    expect(isUsableDownloadUrl('http://files.example.test/a.xlsx')).toBe(true)
    expect(isUsableDownloadUrl('data:text/plain,hello')).toBe(false)
    expect(isUsableDownloadUrl(null)).toBe(false)
  })

  it('reports a ready job that names no expiry', () => {
    const job = jobFixture({ status: 'ready', download_url: 'https://files.example.test/a.xlsx' })
    expect(exportDownload(job)).toEqual({
      ready: true,
      url: 'https://files.example.test/a.xlsx',
      expiresAt: null,
    })
  })
})

describe('a failed export (Req 18 AC9)', () => {
  it('exposes the server message verbatim', () => {
    const job = jobFixture({ status: 'failed', error_message: 'فشل إنتاج الملف' })
    expect(isExportFailed(job)).toBe(true)
    expect(exportErrorMessage(job)).toBe('فشل إنتاج الملف')
  })

  it('exposes no message for a failure that named none', () => {
    expect(exportErrorMessage(jobFixture({ status: 'failed' }))).toBeNull()
    expect(exportErrorMessage(jobFixture({ status: 'failed', error_message: '  ' }))).toBeNull()
  })

  it('exposes no message for a job that did not fail', () => {
    expect(exportErrorMessage(jobFixture({ status: 'running', error_message: 'ignored' }))).toBeNull()
    expect(isExportFailed(jobFixture({ status: 'ready' }))).toBe(false)
  })
})

describe('the job identifier to poll (Req 18 AC7)', () => {
  it('reads a usable identifier and refuses a blank one', () => {
    expect(exportJobId(jobFixture())).toBe('job-1')
    expect(exportJobId(jobFixture({ job_id: '   ' }))).toBeNull()
    expect(exportJobId(null)).toBeNull()
  })
})
