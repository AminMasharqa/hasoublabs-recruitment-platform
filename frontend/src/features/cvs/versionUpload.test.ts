/**
 * Unit tests for the multipart upload (task 17.2).
 *
 * Requirement 11 AC10 asks for two things this module is responsible for: a body
 * submitted as multipart form data, and a progress indicator reporting the
 * transferred byte percentage. Both are checked here without a network: the framing
 * is inspected byte by byte, the streamed body is drained by the test in place of a
 * transport, and the request itself goes through a stub Api_Client.
 *
 * The filename escaping is checked with Arabic text because Requirement 19 AC11
 * requires what the Candidate selected to be submitted byte-identically.
 */

import { describe, expect, it, vi } from 'vitest'

import type { ApiClient, ApiSuccess } from '../../api/client'

import type { CvUploadAccepted, UploadProgress } from './versionRules'
import {
  CV_VERSIONS_PATH,
  escapeMultipartFilename,
  multipartParts,
  newBoundary,
  streamedMultipartBody,
  UPLOAD_FIELD_NAME,
  UPLOAD_TIMEOUT_MS,
  uploadCvVersion,
} from './versionUpload'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PDF = 'application/pdf'

function fileOf(bytes: number, name = 'cv.pdf'): File {
  const content = new Uint8Array(bytes)
  for (let index = 0; index < bytes; index += 1) {
    content[index] = index % 256
  }
  return new File([content], name, { type: PDF })
}

function accepted(): CvUploadAccepted {
  return {
    message: 'Upload accepted, scan pending',
    version: {
      id: 'ver-1',
      variant_id: 'v1',
      version_number: 1,
      state: 'PendingScan',
      original_filename: 'cv.pdf',
      mime_type: PDF,
      size_bytes: 10,
      created_at: '2025-01-01T00:00:00Z',
    },
  }
}

/** An Api_Client that answers the upload with a 202, recording the init it got. */
function backend(): {
  readonly calls: { method: string; path: string; init: Record<string, unknown> }[]
  readonly api: ApiClient
} {
  const calls: { method: string; path: string; init: Record<string, unknown> }[] = []
  const request = vi.fn((method: string, path: string, init: Record<string, unknown>) => {
    calls.push({ method, path, init })
    return Promise.resolve({
      data: accepted(),
      response: new Response(null, { status: 202 }),
      supportReference: 'req-ok',
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

// ── Framing ───────────────────────────────────────────────────────────────────

describe('multipart framing (Req 11 AC10, Req 19 AC11)', () => {
  it('escapes only the three characters the header cannot carry', () => {
    expect(escapeMultipartFilename('quarterly "report".pdf')).toBe('quarterly %22report%22.pdf')
    expect(escapeMultipartFilename('two\r\nlines.pdf')).toBe('two%0D%0Alines.pdf')
  })

  it('carries an Arabic filename through byte-identically', () => {
    const name = 'السيرة الذاتية.pdf'
    expect(escapeMultipartFilename(name)).toBe(name)
    const parts = multipartParts({ name, size: 4, type: PDF })
    expect(new TextDecoder().decode(parts.head)).toContain(`filename="${name}"`)
  })

  it('declares the boundary in the Content-Type and counts the whole body', () => {
    const parts = multipartParts({ name: 'cv.pdf', size: 100, type: PDF }, 'abc123')
    expect(parts.contentType).toBe('multipart/form-data; boundary=abc123')
    expect(new TextDecoder().decode(parts.head)).toBe(
      `--abc123\r\nContent-Disposition: form-data; name="${UPLOAD_FIELD_NAME}"; ` +
        'filename="cv.pdf"\r\nContent-Type: application/pdf\r\n\r\n',
    )
    expect(new TextDecoder().decode(parts.tail)).toBe('\r\n--abc123--\r\n')
    expect(parts.totalBytes).toBe(parts.head.byteLength + 100 + parts.tail.byteLength)
  })

  it('names a media type even when the platform reported none', () => {
    const parts = multipartParts({ name: 'cv', size: 1, type: '' })
    expect(new TextDecoder().decode(parts.head)).toContain('Content-Type: application/octet-stream')
  })

  it('mints a distinct boundary per body', () => {
    expect(newBoundary()).not.toBe(newBoundary())
  })
})

// ── The streamed body and its progress ────────────────────────────────────────

describe('streamedMultipartBody (Req 11 AC10)', () => {
  it('reports the transferred byte percentage as the transport pulls the body', async () => {
    const file = fileOf(300)
    const parts = multipartParts(file, 'abc123')
    const observed: UploadProgress[] = []
    const stream = streamedMultipartBody(file, parts, (progress) => observed.push(progress), 100)

    const chunks: Uint8Array[] = []
    const reader = stream.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      if (value !== undefined) {
        chunks.push(value)
      }
    }

    // head + three 100-byte slices + tail
    expect(chunks).toHaveLength(5)
    const sent = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
    expect(sent).toBe(parts.totalBytes)

    // Monotonic, ending at exactly 100 percent of the whole body.
    expect(observed.map((progress) => progress.transferredBytes)).toEqual(
      chunks.reduce<number[]>((running, chunk) => {
        running.push((running.at(-1) ?? 0) + chunk.byteLength)
        return running
      }, []),
    )
    expect(observed.at(-1)).toMatchObject({
      transferredBytes: parts.totalBytes,
      totalBytes: parts.totalBytes,
      percentage: 100,
    })
    expect(observed.some((progress) => progress.percentage > 0 && progress.percentage < 100)).toBe(
      true,
    )
  })

  it('streams the file bytes unchanged between the head and the tail', async () => {
    const file = fileOf(8)
    const parts = multipartParts(file, 'abc123')
    const stream = streamedMultipartBody(file, parts, () => undefined, 4)

    const body: number[] = []
    const reader = stream.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      if (value !== undefined) {
        body.push(...value)
      }
    }

    const expected = [
      ...parts.head,
      ...new Uint8Array(await file.arrayBuffer()),
      ...parts.tail,
    ]
    expect(body).toEqual(expected)
  })
})

// ── The request ───────────────────────────────────────────────────────────────

describe('uploadCvVersion (Req 11 AC10, AC11)', () => {
  it('posts to the variant versions path with an upload budget', async () => {
    const stub = backend()
    const file = fileOf(16)

    const response = await uploadCvVersion(stub.api, {
      variantId: 'v1',
      file,
      withoutStreaming: true,
    })

    expect(response.version.state).toBe('PendingScan')
    expect(stub.calls).toHaveLength(1)
    expect(stub.calls[0]?.method).toBe('post')
    expect(stub.calls[0]?.path).toBe(CV_VERSIONS_PATH)
    expect(stub.calls[0]?.init).toMatchObject({
      params: { path: { variant_id: 'v1' } },
      timeoutMs: UPLOAD_TIMEOUT_MS,
    })
  })

  it('submits the file as multipart form data on the non-streaming path', async () => {
    const stub = backend()
    const file = fileOf(16, 'résumé.pdf')

    await uploadCvVersion(stub.api, { variantId: 'v1', file, withoutStreaming: true })

    const serialize = stub.calls[0]?.init.bodySerializer as () => unknown
    const body = serialize()
    expect(body).toBeInstanceOf(FormData)
    const submitted = (body as FormData).get(UPLOAD_FIELD_NAME)
    expect(submitted).toBeInstanceOf(File)
    expect((submitted as File).name).toBe('résumé.pdf')
    // The platform sets the boundary for a FormData body, so none is declared.
    expect(stub.calls[0]?.init.headers).toBeUndefined()
  })

  it('reports nothing transferred before the request and everything after it', async () => {
    const stub = backend()
    const observed: UploadProgress[] = []

    await uploadCvVersion(stub.api, {
      variantId: 'v1',
      file: fileOf(16),
      withoutStreaming: true,
      onProgress: (progress) => observed.push(progress),
    })

    expect(observed[0]?.percentage).toBe(0)
    expect(observed.at(-1)?.percentage).toBe(100)
    expect(observed.at(-1)?.transferredBytes).toBe(observed.at(-1)?.totalBytes)
  })

  it('builds a fresh body per attempt, so a replayed request is not a drained one', async () => {
    const stub = backend()
    await uploadCvVersion(stub.api, {
      variantId: 'v1',
      file: fileOf(16),
      withoutStreaming: true,
    })

    const serialize = stub.calls[0]?.init.bodySerializer as () => unknown
    expect(serialize()).not.toBe(serialize())
  })
})
