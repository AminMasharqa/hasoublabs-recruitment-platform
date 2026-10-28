/**
 * Downloading one CV_Version and delivering it to the browser
 * (Requirement 11 AC16, AC17, AC18, AC19).
 *
 * - **AC16** an `Available` version is requested from the download endpoint and
 *   handed to the browser as a file download under its original filename
 *   ({@link downloadCvVersion}, {@link deliverFile}).
 * - **AC17** a response whose Error_Envelope reports `integrity_violation` rejects
 *   with that envelope, which the Error_Presenter maps to the localized
 *   alerted-administrator message — the mapping is the catalogue's, not this
 *   module's.
 * - **AC18** a response that stops before its declared `Content-Length` is
 *   discarded rather than saved, and rejects with the synthesized
 *   {@link import('./versionRules').IncompleteDownloadFailure} carrying the
 *   Support_Reference of the response that failed.
 * - **AC19** the same two behaviours for the Admin download path, which differs
 *   only in the endpoint it asks.
 *
 * ## Why the body is read here rather than parsed by the client
 *
 * AC18 is a statement about the *transfer*: the file must be discarded when fewer
 * bytes arrive than the response declared. That is only decidable if the body is
 * read as a stream and counted, so the request asks the Api_Client for the body
 * unparsed (`parseAs: 'stream'`) and counts it. Letting the client parse it into a
 * `Blob` instead would surface a truncated transfer as an undecodable-response
 * failure — true, but it would say nothing about a partial file, and nothing would
 * guarantee the partial bytes were never handed to the browser.
 *
 * Reading the response is what {@link ApiSuccess.response} is published for; no
 * request is issued here except through the Api_Client (Requirement 3 AC1).
 *
 * ## Why delivery is a separate function
 *
 * {@link deliverFile} is the only part of the slice that touches the DOM outside a
 * component, and it is where the original filename of AC16 is applied. Keeping it
 * apart from the request means the request is testable without a document, and the
 * delivery is testable without a network.
 *
 * Requirements: 11.16, 11.17, 11.18, 11.19.
 */

import type { ApiClient } from '../../api/client'

import {
  ADMIN_CV_VERSION_DOWNLOAD_PATH,
  CV_VERSION_DOWNLOAD_PATH,
} from './versionApi'
import {
  declaredContentLength,
  incompleteDownloadFailure,
  isTruncatedTransfer,
  type CvVersion,
} from './versionRules'

/** Media type applied when the response declared none. */
const FALLBACK_MEDIA_TYPE = 'application/octet-stream'

/** One downloaded file, ready to be handed to the browser (AC16). */
export interface DownloadedFile {
  /** The complete bytes. Never a partial body — a short read rejects instead (AC18). */
  readonly blob: Blob
  /** The original filename the browser saves it under (AC16). */
  readonly filename: string
  /** The Support_Reference of the response that delivered it. Never rendered on success. */
  readonly supportReference: string | null
}

/** One version's bytes, as the read loop accumulates them. */
interface ReadBody {
  readonly chunks: readonly Uint8Array[]
  readonly receivedBytes: number
  /** `true` when the stream itself errored, which is a truncated transfer (AC18). */
  readonly interrupted: boolean
}

/**
 * Joins the read chunks into one contiguous buffer.
 *
 * Allocated here rather than handing the chunk list to `Blob` so the bytes live in
 * a buffer this module owns: a chunk a stream handed over may be backed by a
 * pooled or shared buffer, and a `Blob` built over it would be defined by memory
 * someone else may reuse.
 */
function joinChunks(chunks: readonly Uint8Array[], totalBytes: number): Uint8Array<ArrayBuffer> {
  const joined = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return joined
}

/**
 * Drains a response body, counting it.
 *
 * A stream error is reported rather than thrown, because a connection that drops
 * mid-body is the same outcome as one that ends early: an incomplete download
 * (AC18).
 */
async function readBody(stream: ReadableStream<Uint8Array> | null): Promise<ReadBody> {
  if (stream === null) {
    return { chunks: [], receivedBytes: 0, interrupted: false }
  }
  const chunks: Uint8Array[] = []
  let receivedBytes = 0
  const reader = stream.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      if (value !== undefined) {
        chunks.push(value)
        receivedBytes += value.byteLength
      }
    }
  } catch {
    return { chunks, receivedBytes, interrupted: true }
  } finally {
    reader.releaseLock()
  }
  return { chunks, receivedBytes, interrupted: false }
}

/** What one download names. */
export interface DownloadVersionRequest {
  readonly variantId: string
  readonly version: CvVersion
  readonly signal?: AbortSignal
}

/** What one Admin download names (AC19). */
export interface AdminDownloadVersionRequest {
  readonly candidateId: string
  readonly variantId: string
  readonly versionNumber: number
  /** The filename to save under, when the Admin surface knows one. */
  readonly filename?: string
  readonly signal?: AbortSignal
}

/**
 * Turns a read response into a complete file, or rejects (AC16, AC18).
 *
 * The `Blob` is built only after the length check passes, so a partial body is
 * never materialized as a file — "discard the partial file" is enforced by never
 * having assembled one.
 */
function toDownloadedFile(options: {
  readonly response: Response
  readonly supportReference: string | null
  readonly body: ReadBody
  readonly filename: string
}): DownloadedFile {
  const { response, supportReference, body, filename } = options
  const declaredBytes = declaredContentLength(response.headers)

  if (body.interrupted || isTruncatedTransfer(declaredBytes, body.receivedBytes)) {
    throw incompleteDownloadFailure({
      declaredBytes,
      receivedBytes: body.receivedBytes,
      httpStatus: response.status,
      supportReference,
    })
  }

  const mediaType = response.headers.get('Content-Type') ?? FALLBACK_MEDIA_TYPE
  return {
    blob: new Blob([joinChunks(body.chunks, body.receivedBytes)], { type: mediaType }),
    filename,
    supportReference,
  }
}

/**
 * `GET /me/cv-variants/{variant_id}/versions/{version_number}/download` (AC16).
 *
 * Rejects with the decoded Error_Envelope for every 4xx/5xx — including the
 * `integrity_violation` of AC17 — and with the incomplete-download failure for a
 * body that stopped short (AC18).
 */
export async function downloadCvVersion(
  api: ApiClient,
  request: DownloadVersionRequest,
): Promise<DownloadedFile> {
  const { variantId, version, signal } = request
  const { data, response, supportReference } = await api.request('get', CV_VERSION_DOWNLOAD_PATH, {
    params: { path: { variant_id: variantId, version_number: version.version_number } },
    parseAs: 'stream',
    ...(signal === undefined ? {} : { signal }),
  })
  return toDownloadedFile({
    response,
    supportReference,
    body: await readBody(data),
    filename: version.original_filename,
  })
}

/** The Admin download of any Candidate's version (AC19). */
export async function adminDownloadCvVersion(
  api: ApiClient,
  request: AdminDownloadVersionRequest,
): Promise<DownloadedFile> {
  const { candidateId, variantId, versionNumber, filename, signal } = request
  const { data, response, supportReference } = await api.request(
    'get',
    ADMIN_CV_VERSION_DOWNLOAD_PATH,
    {
      params: {
        path: {
          candidate_id: candidateId,
          variant_id: variantId,
          version_number: versionNumber,
        },
      },
      parseAs: 'stream',
      ...(signal === undefined ? {} : { signal }),
    },
  )
  return toDownloadedFile({
    response,
    supportReference,
    body: await readBody(data),
    filename: filename ?? `cv-${variantId}-v${versionNumber}`,
  })
}

/**
 * How long the object URL of a delivered file is held before it is revoked.
 *
 * Revoking it in the same tick as the click races the browser's own fetch of the
 * URL in some engines; a short delay removes the race without leaving the blob
 * alive for the lifetime of the document.
 */
export const OBJECT_URL_LIFETIME_MS = 60

/** The parts of the DOM {@link deliverFile} needs, so a test can supply them. */
export interface DownloadHost {
  readonly document: Pick<Document, 'createElement' | 'body'>
  readonly createObjectURL: (blob: Blob) => string
  readonly revokeObjectURL: (url: string) => void
  readonly schedule?: (callback: () => void, delayMs: number) => void
}

function defaultHost(): DownloadHost {
  return {
    document,
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => {
      URL.revokeObjectURL(url)
    },
  }
}

/**
 * Hands a downloaded file to the browser under its original filename (AC16).
 *
 * A `download`-carrying anchor rather than a navigation: the bytes are already in
 * memory — they had to be, to check the declared length (AC18) — so there is
 * nothing left to request, and an anchor is the one mechanism that both saves
 * rather than renders and names the file.
 *
 * The anchor is removed and the object URL revoked afterwards, so a Candidate who
 * downloads every version of a variant does not accumulate one live blob per
 * download for the lifetime of the document.
 */
export function deliverFile(file: DownloadedFile, host: DownloadHost = defaultHost()): void {
  const url = host.createObjectURL(file.blob)
  const anchor = host.document.createElement('a')
  anchor.href = url
  anchor.download = file.filename
  anchor.rel = 'noopener'
  anchor.hidden = true
  host.document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()

  const schedule =
    host.schedule ??
    ((callback: () => void, delayMs: number) => {
      setTimeout(callback, delayMs)
    })
  schedule(() => {
    host.revokeObjectURL(url)
  }, OBJECT_URL_LIFETIME_MS)
}
