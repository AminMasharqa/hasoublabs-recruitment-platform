/**
 * `POST /me/cv-variants/{variant_id}/versions` — the multipart upload and the
 * byte-percentage progress it reports (Requirement 11 AC10, AC11).
 *
 * The request itself goes through the Api_Client like every other one
 * (Requirement 3 AC1), so the Access_Token, the `Accept-Language`, the 401
 * refresh-and-replay path, the Error_Envelope decoding and the Support_Reference
 * are not restated here. What *is* here is the request body, because AC10 asks
 * for something the platform only exposes one way.
 *
 * ## Why the body is encoded and streamed rather than handed over as `FormData`
 *
 * `fetch` publishes no upload-progress event. The transferred byte count AC10
 * asks for is observable in exactly one place: a request body that is a
 * `ReadableStream`, whose chunks the transport pulls as it has capacity to send
 * them. So the multipart body is encoded here ({@link multipartParts}) and handed
 * over as a stream that counts what the transport takes
 * ({@link streamedMultipartBody}).
 *
 * Request streaming is a Chromium-only capability at the time of writing, and a
 * browser without it rejects a stream body outright — so the transport is chosen
 * per platform ({@link supportsRequestStreaming}): where streaming is
 * unavailable the body is a plain `FormData`, which every browser encodes
 * natively, and progress then reports the two counts that platform does make
 * observable — nothing transferred before the request, everything transferred
 * when the Backend_Api accepts it. No figure between them is invented, because a
 * progress bar that moves on a timer rather than on bytes tells the Candidate
 * something untrue about a 10 MB upload on a slow connection.
 *
 * The capability is decided by reading `duplex` off `Request.prototype`, which
 * allocates nothing, issues nothing and reads no `Response` — this module makes
 * no HTTP call of its own (Requirement 3 AC1).
 *
 * ## Why the body is built by a serializer rather than passed as a value
 *
 * A stream can be consumed once. The Api_Client replays a request whose 401 the
 * Session_Manager recovered from (Requirement 3 AC7), and a replay of an
 * already-drained stream would fail. The body is therefore produced by a
 * *serializer* the underlying client calls once per attempt, so each attempt gets
 * a fresh stream and a progress count that restarts from zero.
 *
 * ## The filename is encoded, never rewritten
 *
 * `Content-Disposition` is built with the escaping the multipart form-data
 * serialization defines — CR, LF and `"` become their percent forms, everything
 * else is UTF-8 — so an Arabic or Hebrew filename reaches the Backend_Api
 * byte-identically to the one the Candidate selected (Requirement 19 AC11).
 *
 * Requirements: 11.10, 11.11, 19.11.
 */

import type { ApiClient, ApiInit, ApiRequestExtras } from '../../api/client'

import { uploadProgress, type CvUploadAccepted, type UploadProgressListener } from './versionRules'

/** The multipart field name the Backend_Api reads the file from. */
export const UPLOAD_FIELD_NAME = 'file'

/** `GET`/`POST` path of one variant's versions. */
export const CV_VERSIONS_PATH = '/api/v1/me/cv-variants/{variant_id}/versions'

/**
 * Request budget for one upload.
 *
 * The Api_Client's default 30 seconds is a read budget; 10 MB over a slow mobile
 * connection legitimately takes longer than that, and aborting a transfer that is
 * making progress would be a defect rather than a timeout. Five minutes is long
 * enough for the largest accepted file on a poor connection and still bounded.
 */
export const UPLOAD_TIMEOUT_MS = 300_000

/** Bytes handed to the transport per pull. */
export const UPLOAD_CHUNK_BYTES = 64 * 1024

const CRLF = '\r\n'

/** The encoded head, tail and framing of one multipart body. */
export interface MultipartParts {
  /** The boundary token, without the leading dashes. */
  readonly boundary: string
  /** The `Content-Type` header value, boundary included. */
  readonly contentType: string
  /** Everything before the file's bytes. */
  readonly head: Uint8Array
  /** Everything after them. */
  readonly tail: Uint8Array
  /** `head` + the file's size + `tail`: the denominator of the progress percentage. */
  readonly totalBytes: number
}

/** What {@link multipartParts} needs of a selected file. */
export interface EncodableFile {
  readonly name: string
  readonly size: number
  readonly type: string
}

/**
 * A boundary token no body can contain by accident.
 *
 * 32 hex characters from the platform CSPRNG where one is available, falling back
 * to `Math.random` — the token needs to be *unique*, not unguessable, so the
 * fallback is adequate and never a security decision.
 */
export function newBoundary(): string {
  const randomSource = globalThis.crypto
  if (randomSource !== undefined && typeof randomSource.getRandomValues === 'function') {
    const bytes = randomSource.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2).padStart(16, '0')}`
}

/**
 * A filename as `Content-Disposition` carries it.
 *
 * The three characters that would break the header — CR, LF and the quote that
 * delimits the value — become their percent-encoded forms, exactly as the
 * multipart form-data serialization defines. Nothing else is touched: no
 * transliteration, no normalization, no trimming, so the name arrives
 * byte-identically (Req 19 AC11).
 */
export function escapeMultipartFilename(name: string): string {
  return name.replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/"/g, '%22')
}

/** Encodes the multipart framing of one file upload (AC10). */
export function multipartParts(file: EncodableFile, boundary = newBoundary()): MultipartParts {
  const encoder = new TextEncoder()
  const mediaType = file.type === '' ? 'application/octet-stream' : file.type
  const head = encoder.encode(
    `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${UPLOAD_FIELD_NAME}"; ` +
      `filename="${escapeMultipartFilename(file.name)}"${CRLF}` +
      `Content-Type: ${mediaType}${CRLF}${CRLF}`,
  )
  const tail = encoder.encode(`${CRLF}--${boundary}--${CRLF}`)
  return {
    boundary,
    contentType: `multipart/form-data; boundary=${boundary}`,
    head,
    tail,
    totalBytes: head.byteLength + file.size + tail.byteLength,
  }
}

/** A file this module can both frame and read. */
export type UploadableFile = EncodableFile & Pick<Blob, 'slice'>

/**
 * The multipart body as a stream that reports what the transport takes (AC10).
 *
 * The head, then the file in {@link UPLOAD_CHUNK_BYTES} slices, then the tail. The
 * listener is called after each chunk is enqueued, with the cumulative byte count
 * — and because a stream is pulled rather than pushed, that count tracks what the
 * transport has room to *send* rather than what this module has managed to read.
 */
export function streamedMultipartBody(
  file: UploadableFile,
  parts: MultipartParts,
  onProgress: UploadProgressListener,
  chunkBytes: number = UPLOAD_CHUNK_BYTES,
): ReadableStream<Uint8Array> {
  let offset = 0
  let transferred = 0
  let headSent = false

  const report = (bytes: number): void => {
    transferred += bytes
    onProgress(uploadProgress(transferred, parts.totalBytes))
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!headSent) {
        headSent = true
        controller.enqueue(parts.head)
        report(parts.head.byteLength)
        return
      }
      if (offset < file.size) {
        const end = Math.min(offset + chunkBytes, file.size)
        const chunk = new Uint8Array(await file.slice(offset, end).arrayBuffer())
        offset = end
        controller.enqueue(chunk)
        report(chunk.byteLength)
        return
      }
      controller.enqueue(parts.tail)
      report(parts.tail.byteLength)
      controller.close()
    },
  })
}

/** Whether this platform accepts a `ReadableStream` as a request body (AC10). */
export function supportsRequestStreaming(): boolean {
  return (
    typeof ReadableStream === 'function' &&
    typeof Request === 'function' &&
    'duplex' in Request.prototype
  )
}

/** What one upload names. */
export interface UploadVersionRequest {
  readonly variantId: string
  readonly file: File
  /** Receives every transfer observation (AC10). */
  readonly onProgress?: UploadProgressListener
  /** Cancels the upload, e.g. when the screen unmounts. */
  readonly signal?: AbortSignal
  /**
   * Forces the non-streaming body. Set by a caller that knows streaming is
   * unavailable — a test, or a platform probe that was answered elsewhere.
   */
  readonly withoutStreaming?: boolean
}

/** The init the Api_Client accepts for this operation. */
type UploadInit = ApiInit<'post', typeof CV_VERSIONS_PATH> & ApiRequestExtras

/**
 * Uploads one file as a new CV_Version (AC10, AC11).
 *
 * Resolves with the 202 body — the accepted version and the server's
 * scan-pending message — and rejects with an `ApiFailure` for every other
 * outcome. Never retried by the Api_Client, because it is a mutation: a retry
 * would store the same CV twice (Requirement 21 AC10).
 */
export async function uploadCvVersion(
  api: ApiClient,
  request: UploadVersionRequest,
): Promise<CvUploadAccepted> {
  const { variantId, file, onProgress, signal, withoutStreaming = false } = request
  const report: UploadProgressListener = onProgress ?? (() => undefined)
  const streaming = !withoutStreaming && supportsRequestStreaming()
  const parts = multipartParts(file)

  /**
   * Built per attempt rather than once, so the Api_Client's 401 replay
   * (Requirement 3 AC7) gets a stream that has not been drained — and a progress
   * count that starts again from zero.
   */
  const buildBody = (): ReadableStream<Uint8Array> | FormData => {
    if (!streaming) {
      const form = new FormData()
      form.append(UPLOAD_FIELD_NAME, file, file.name)
      report(uploadProgress(0, parts.totalBytes))
      return form
    }
    return streamedMultipartBody(file, parts, report)
  }

  report(uploadProgress(0, parts.totalBytes))

  const init = {
    params: { path: { variant_id: variantId } },
    // Never sent: the serializer below ignores it. It exists because the
    // underlying client only calls a body serializer when a body was supplied.
    body: { [UPLOAD_FIELD_NAME]: '' },
    bodySerializer: buildBody,
    // A `FormData` body must have its `Content-Type` set by the platform, so the
    // boundary matches the one it generated; a stream body must carry the one
    // encoded above.
    ...(streaming ? { headers: { 'Content-Type': parts.contentType }, duplex: 'half' } : {}),
    timeoutMs: UPLOAD_TIMEOUT_MS,
    ...(signal === undefined ? {} : { signal }),
  } as unknown as UploadInit

  const { data } = await api.request('post', CV_VERSIONS_PATH, init)
  report(uploadProgress(parts.totalBytes, parts.totalBytes))
  return data
}
