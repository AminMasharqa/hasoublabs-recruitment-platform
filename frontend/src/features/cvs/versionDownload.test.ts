/**
 * Unit tests for the version download (task 17.2).
 *
 * Requirement 11:
 * - AC16 an `Available` version is requested from the download endpoint and
 *   delivered under its original filename.
 * - AC17 an `integrity_violation` envelope reaches the caller as it was decoded, so
 *   the Error_Presenter can map it to the alerted-administrator message.
 * - AC18 a body that stops before its declared length is discarded and reported as
 *   an incomplete download carrying the Support_Reference.
 * - AC19 the Admin path is asked with the candidate, variant and version it names.
 *
 * The Api_Client is a stub, so these are assertions about this module's own
 * behaviour: which path it asks, what it does with the bytes, and what it refuses
 * to hand back.
 */

import { describe, expect, it, vi } from 'vitest'

import type { ApiClient, ApiSuccess } from '../../api/client'

import {
  ADMIN_CV_VERSION_DOWNLOAD_PATH,
  CV_VERSION_DOWNLOAD_PATH,
} from './versionApi'
import {
  adminDownloadCvVersion,
  deliverFile,
  downloadCvVersion,
  type DownloadHost,
} from './versionDownload'
import { isIncompleteDownload, type CvVersion } from './versionRules'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function version(overrides: Partial<CvVersion> = {}): CvVersion {
  return {
    id: 'ver-1',
    variant_id: 'v1',
    version_number: 2,
    state: 'Available',
    original_filename: 'السيرة الذاتية.pdf',
    mime_type: 'application/pdf',
    size_bytes: 4,
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

function streamOf(chunks: readonly Uint8Array[], failAfter = -1): ReadableStream<Uint8Array> {
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (failAfter >= 0 && index === failAfter) {
        controller.error(new Error('connection reset'))
        return
      }
      const chunk = chunks[index]
      index += 1
      if (chunk === undefined) {
        controller.close()
        return
      }
      controller.enqueue(chunk)
    },
  })
}

/** An Api_Client answering the download with `body` under `headers`. */
function backend(options: {
  readonly body: ReadableStream<Uint8Array> | null
  readonly headers?: Record<string, string>
  readonly supportReference?: string | null
}): { readonly calls: { method: string; path: string; init: Record<string, unknown> }[]; readonly api: ApiClient } {
  const calls: { method: string; path: string; init: Record<string, unknown> }[] = []
  const request = vi.fn((method: string, path: string, init: Record<string, unknown>) => {
    calls.push({ method, path, init })
    return Promise.resolve({
      data: options.body,
      response: new Response(null, { status: 200, headers: options.headers ?? {} }),
      supportReference: options.supportReference ?? 'req-ok',
    } satisfies ApiSuccess<unknown>)
  })
  return {
    calls,
    api: {
      request: request as unknown as ApiClient['request'],
      exchangeRefreshToken: () => Promise.reject(new Error('not used')),
      revokeSession: () => Promise.resolve(),
    },
  }
}

/** An Api_Client that rejects with a decoded Error_Envelope. */
function failing(error: unknown): ApiClient {
  return {
    request: (() => Promise.reject(error)) as unknown as ApiClient['request'],
    exchangeRefreshToken: () => Promise.reject(new Error('not used')),
    revokeSession: () => Promise.resolve(),
  }
}

// ── The complete download (AC16) ──────────────────────────────────────────────

describe('downloadCvVersion (Req 11 AC16)', () => {
  it('asks the download path and returns the bytes under the original filename', async () => {
    const stub = backend({
      body: streamOf([new Uint8Array([1, 2]), new Uint8Array([3, 4])]),
      headers: { 'Content-Length': '4', 'Content-Type': 'application/pdf' },
    })

    const file = await downloadCvVersion(stub.api, { variantId: 'v1', version: version() })

    expect(stub.calls[0]?.method).toBe('get')
    expect(stub.calls[0]?.path).toBe(CV_VERSION_DOWNLOAD_PATH)
    expect(stub.calls[0]?.init).toMatchObject({
      params: { path: { variant_id: 'v1', version_number: 2 } },
      parseAs: 'stream',
    })
    expect(file.filename).toBe('السيرة الذاتية.pdf')
    expect(file.blob.size).toBe(4)
    expect(file.blob.type).toBe('application/pdf')
    expect(new Uint8Array(await file.blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  it('accepts a body whose length was never declared', async () => {
    const stub = backend({ body: streamOf([new Uint8Array([1, 2, 3])]) })
    const file = await downloadCvVersion(stub.api, { variantId: 'v1', version: version() })
    expect(file.blob.size).toBe(3)
  })
})

// ── The integrity violation (AC17) ────────────────────────────────────────────

describe('a failed download (Req 11 AC17)', () => {
  it('surfaces the decoded envelope untouched, for the Error_Presenter to map', async () => {
    const envelope = {
      error: 'integrity_violation',
      message: null,
      httpStatus: 500,
      supportReference: 'req-99',
    }
    await expect(
      downloadCvVersion(failing(envelope), { variantId: 'v1', version: version() }),
    ).rejects.toEqual(envelope)
  })
})

// ── The truncated download (AC18) ─────────────────────────────────────────────

describe('a truncated download (Req 11 AC18)', () => {
  it('discards the partial file and reports the Support_Reference', async () => {
    const stub = backend({
      body: streamOf([new Uint8Array([1, 2])]),
      headers: { 'Content-Length': '4' },
      supportReference: 'req-77',
    })

    const failure = await downloadCvVersion(stub.api, {
      variantId: 'v1',
      version: version(),
    }).catch((thrown: unknown) => thrown)

    expect(isIncompleteDownload(failure)).toBe(true)
    expect(failure).toMatchObject({
      supportReference: 'req-77',
      details: { declared_bytes: 4, received_bytes: 2 },
    })
  })

  it('treats a body that errors mid-transfer the same way', async () => {
    const stub = backend({
      body: streamOf([new Uint8Array([1, 2])], 1),
      headers: { 'Content-Length': '4' },
    })

    const failure = await downloadCvVersion(stub.api, {
      variantId: 'v1',
      version: version(),
    }).catch((thrown: unknown) => thrown)

    expect(isIncompleteDownload(failure)).toBe(true)
  })

  it('treats a declared body that never arrived as incomplete', async () => {
    const stub = backend({ body: null, headers: { 'Content-Length': '4' } })

    const failure = await downloadCvVersion(stub.api, {
      variantId: 'v1',
      version: version(),
    }).catch((thrown: unknown) => thrown)

    expect(isIncompleteDownload(failure)).toBe(true)
  })
})

// ── The Admin download (AC19) ─────────────────────────────────────────────────

describe('adminDownloadCvVersion (Req 11 AC19)', () => {
  it('asks the Admin path with the candidate, variant and version it names', async () => {
    const stub = backend({
      body: streamOf([new Uint8Array([9])]),
      headers: { 'Content-Length': '1' },
    })

    const file = await adminDownloadCvVersion(stub.api, {
      candidateId: 'acc-1',
      variantId: 'v1',
      versionNumber: 3,
      filename: 'candidate-cv.pdf',
    })

    expect(stub.calls[0]?.path).toBe(ADMIN_CV_VERSION_DOWNLOAD_PATH)
    expect(stub.calls[0]?.init).toMatchObject({
      params: { path: { candidate_id: 'acc-1', variant_id: 'v1', version_number: 3 } },
    })
    expect(file.filename).toBe('candidate-cv.pdf')
  })
})

// ── Delivery (AC16) ───────────────────────────────────────────────────────────

describe('deliverFile (Req 11 AC16)', () => {
  it('hands the blob to the browser under the original filename and releases the URL', () => {
    const revoked: string[] = []
    const scheduled: (() => void)[] = []
    const anchor = document.createElement('a')
    const clicked = vi.spyOn(anchor, 'click').mockImplementation(() => undefined)

    const host: DownloadHost = {
      document: {
        createElement: (() => anchor) as Document['createElement'],
        body: document.body,
      },
      createObjectURL: () => 'blob:cv',
      revokeObjectURL: (url) => revoked.push(url),
      schedule: (callback) => scheduled.push(callback),
    }

    deliverFile({ blob: new Blob(['x']), filename: 'cv.pdf', supportReference: null }, host)

    expect(clicked).toHaveBeenCalledOnce()
    expect(anchor.getAttribute('download')).toBe('cv.pdf')
    expect(anchor.getAttribute('href')).toBe('blob:cv')
    expect(anchor.isConnected).toBe(false)

    expect(revoked).toEqual([])
    scheduled.forEach((callback) => callback())
    expect(revoked).toEqual(['blob:cv'])
  })
})
