/**
 * Error_Envelope decoding and Field_Violation mapping (Requirement 3 AC4–AC9).
 *
 * This module is pure logic: it issues no HTTP, holds no state and writes
 * nothing to any log or console. The Api_Client (`./client.ts`) feeds it the
 * status code, the raw body and the response headers of a 400–599 response and
 * receives a uniform {@link ApiError} in return.
 *
 * Decodability rule: a body is a decodable Error_Envelope when it is a JSON
 * object carrying a string `error` member. Anything else — malformed JSON, an
 * empty body, an array, a primitive, or an object whose `error` member is not a
 * string — is undecodable and yields the synthesized `unexpected_response`
 * envelope (AC5).
 */

import type { components } from './generated/schema'

/**
 * The `details` payload of a FastAPI `validation_error` body: an array of the
 * generated `ValidationError` element `{loc, msg, type}`. Taken from the
 * Backend_Api contract rather than hand-typed. A `validation_failed` body built
 * by the platform error taxonomy instead carries `{path, code, message}`
 * elements; {@link toFieldViolations} accepts either shape.
 */
export type ValidationErrorDetails = components['schemas']['ValidationError'][]

/** `error` key of the envelope synthesized for an undecodable body (AC5). */
export const UNEXPECTED_RESPONSE_ERROR = 'unexpected_response'

/** Response header carrying the Support_Reference (AC5, AC6). */
export const REQUEST_ID_HEADER = 'X-Request-ID'

/** The `error` keys whose 422 `details` member is a Field_Violation list (AC9). */
export const VALIDATION_ERROR_KEYS = ['validation_error', 'validation_failed'] as const

/** Union of the two validation `error` keys. */
export type ValidationErrorKey = (typeof VALIDATION_ERROR_KEYS)[number]

/** `code` used when a violation element names no machine sub-code. */
export const UNKNOWN_VIOLATION_CODE = 'unknown_violation'

/**
 * FastAPI `loc` prefixes that name the request part rather than a field. They
 * are dropped so a violation `path` addresses a rendered input.
 */
const LOC_SOURCE_PREFIXES = new Set(['body', 'query', 'path', 'header', 'cookie'])

/**
 * The uniform Backend_Api error body (AC4).
 *
 * Every member is always present. `message`, `details` and `request_id` are
 * `null` rather than absent when the response omits them, so a consumer can
 * read all four members without a shape check.
 */
export interface ErrorEnvelope {
  /** Stable machine key, e.g. `validation_failed`. Never localized. */
  readonly error: string
  /** Localized human-readable message, or `null` when the body carried none. */
  readonly message: string | null
  /** Machine-readable context, preserved exactly as the body carried it. */
  readonly details: unknown
  /** Body `request_id`, falling back to the `X-Request-ID` header. */
  readonly request_id: string | null
}

/** One entry of a 422 validation `details` list, addressed by `path` (AC9). */
export interface FieldViolation {
  /** Form-addressable path, e.g. `education[2].start_date`. */
  readonly path: string
  /** Stable machine sub-code, e.g. `end_before_start`. */
  readonly code: string
  /** Localized field message when the Backend_Api supplied one. */
  readonly message: string | null
}

/**
 * How a failure is classified for the Session_Manager (AC7, AC8).
 *
 * - `authentication_failure` — 401; the refresh path runs.
 * - `authorization_denial` — 403; the refresh path never runs.
 * - `other` — every remaining status; the refresh path never runs.
 */
export type AuthOutcome = 'authentication_failure' | 'authorization_denial' | 'other'

/** A decoded 400–599 response: the envelope plus transport-level facts. */
export interface ApiError extends ErrorEnvelope {
  /** The response status code. */
  readonly httpStatus: number
  /** The `X-Request-ID` of this response, surfaced to the user on failure (AC6). */
  readonly supportReference: string | null
  /** `true` only for 401 (AC7, AC8). */
  readonly refreshEligible: boolean
  /** Authentication-versus-authorization classification (AC7, AC8). */
  readonly authOutcome: AuthOutcome
  /** Complete violation list for a 422 validation failure; empty otherwise (AC9). */
  readonly fieldViolations: readonly FieldViolation[]
}

/** A raw 400–599 response, as the Api_Client observes it. */
export interface RawErrorResponse {
  /** The response status code. */
  readonly status: number
  /** Parsed JSON, raw response text, or `undefined` when there was no body. */
  readonly body?: unknown
  /** Response headers, as a `Headers`, a `Map` or a plain record. */
  readonly headers?: HeaderSource
}

/** Header collections this module can read a value out of. */
export type HeaderSource =
  | Headers
  | Map<string, string>
  | Record<string, string | readonly string[] | null | undefined>
  | null
  | undefined

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function headerEntries(headers: NonNullable<HeaderSource>): Iterable<[string, unknown]> {
  const iterable = headers as { entries?: () => Iterable<[string, unknown]> }
  if (typeof iterable.entries === 'function') {
    // Covers both `Headers` and `Map`, which yield `[key, value]` pairs.
    return iterable.entries()
  }
  return Object.entries(headers as Record<string, unknown>)
}

/**
 * Reads a header value case-insensitively from any supported header collection.
 *
 * Returns the value verbatim; an array value resolves to its first string
 * element. Returns `null` when the header is absent or carries no string value.
 */
export function readHeader(headers: HeaderSource, name: string): string | null {
  if (headers == null) {
    return null
  }
  const wanted = name.toLowerCase()
  for (const [key, value] of headerEntries(headers)) {
    if (typeof key !== 'string' || key.toLowerCase() !== wanted) {
      continue
    }
    if (typeof value === 'string') {
      return value
    }
    if (Array.isArray(value)) {
      const first = value.find((entry) => typeof entry === 'string')
      return typeof first === 'string' ? first : null
    }
    return null
  }
  return null
}

/** Reads the Support_Reference of a response from its `X-Request-ID` header (AC6). */
export function readSupportReference(headers: HeaderSource): string | null {
  return readHeader(headers, REQUEST_ID_HEADER)
}

/**
 * Coerces a raw body into parsed JSON.
 *
 * A string body is parsed; an unparseable or blank string becomes `undefined`,
 * which the decoder treats as undecodable. A non-string body is assumed to be
 * already-parsed JSON and passes through unchanged.
 */
export function parseErrorBody(body: unknown): unknown {
  if (typeof body !== 'string') {
    return body
  }
  if (body.trim().length === 0) {
    return undefined
  }
  try {
    return JSON.parse(body) as unknown
  } catch {
    return undefined
  }
}

/** Whether a status code is in the 400–599 error range (AC4). */
export function isErrorStatus(status: number): boolean {
  return Number.isFinite(status) && status >= 400 && status <= 599
}

/**
 * Whether the outcome may be retried after a Refresh_Token exchange.
 *
 * True for 401 and for no other status, so 403 is never refreshed (AC7, AC8).
 */
export function isRefreshEligible(status: number): boolean {
  return status === 401
}

/** Classifies a status code as authentication failure, denial or neither (AC7, AC8). */
export function classifyAuthOutcome(status: number): AuthOutcome {
  if (status === 401) {
    return 'authentication_failure'
  }
  if (status === 403) {
    return 'authorization_denial'
  }
  return 'other'
}

/** Whether an `error` key marks a body whose `details` is a violation list (AC9). */
export function isValidationErrorKey(error: string): error is ValidationErrorKey {
  return (VALIDATION_ERROR_KEYS as readonly string[]).includes(error)
}

/**
 * Decodes a 400–599 body into an Error_Envelope (AC4, AC5, AC6).
 *
 * A decodable body keeps its `error`, `message` and `details` members unchanged.
 * An undecodable body yields `error: "unexpected_response"` with a `null`
 * `message` and `details`. In both cases `request_id` comes from the body when
 * it carries a string one and from the `X-Request-ID` header otherwise, and is
 * `null` when neither supplies a value.
 */
export function decodeErrorEnvelope(body: unknown, headers?: HeaderSource): ErrorEnvelope {
  const headerRequestId = readSupportReference(headers)
  const parsed = parseErrorBody(body)

  if (!isRecord(parsed) || typeof parsed.error !== 'string') {
    return {
      error: UNEXPECTED_RESPONSE_ERROR,
      message: null,
      details: null,
      request_id: headerRequestId,
    }
  }

  return {
    error: parsed.error,
    message: typeof parsed.message === 'string' ? parsed.message : null,
    details: parsed.details === undefined ? null : parsed.details,
    request_id: typeof parsed.request_id === 'string' ? parsed.request_id : headerRequestId,
  }
}

function locToPath(loc: unknown): string | null {
  if (!Array.isArray(loc)) {
    return null
  }
  let path = ''
  for (const [index, segment] of (loc as readonly unknown[]).entries()) {
    if (typeof segment === 'number' && Number.isFinite(segment)) {
      path += `[${segment}]`
      continue
    }
    if (typeof segment !== 'string' || segment.length === 0) {
      continue
    }
    if (index === 0 && LOC_SOURCE_PREFIXES.has(segment)) {
      // FastAPI names the request part first; it addresses no rendered input.
      continue
    }
    path += path.length === 0 ? segment : `.${segment}`
  }
  return path.length === 0 ? null : path
}

function toFieldViolation(element: unknown, index: number): FieldViolation {
  const fallbackPath = `details[${index}]`
  if (!isRecord(element)) {
    return {
      path: fallbackPath,
      code: UNKNOWN_VIOLATION_CODE,
      message: nonEmptyString(element),
    }
  }
  return {
    path: nonEmptyString(element.path) ?? locToPath(element.loc) ?? fallbackPath,
    code: nonEmptyString(element.code) ?? nonEmptyString(element.type) ?? UNKNOWN_VIOLATION_CODE,
    message: nonEmptyString(element.message) ?? nonEmptyString(element.msg),
  }
}

function violationSource(envelope: ErrorEnvelope, rawBody: unknown): readonly unknown[] {
  if (Array.isArray(envelope.details)) {
    return envelope.details as readonly unknown[]
  }
  // The Backend_Api also publishes field-level violations as a sibling `fields`
  // member; read it only when `details` is not itself the list.
  const parsed = parseErrorBody(rawBody)
  if (isRecord(parsed) && Array.isArray(parsed.fields)) {
    return parsed.fields as readonly unknown[]
  }
  if (isRecord(envelope.details) && Array.isArray(envelope.details.fields)) {
    return envelope.details.fields as readonly unknown[]
  }
  return []
}

/**
 * Maps the `details` member of a 422 validation envelope to a complete
 * Field_Violation list (AC9).
 *
 * Produces exactly one entry per source element, each exposing a non-empty
 * `path` and `code`. `path` comes from an explicit `path` member, else from a
 * FastAPI `loc` array, else from the element's position. `code` comes from a
 * `code` member, else from a FastAPI `type` member, else from
 * {@link UNKNOWN_VIOLATION_CODE}. Returns an empty list for any response that
 * is not a 422 carrying a {@link VALIDATION_ERROR_KEYS} `error` key.
 *
 * @param rawBody Optional raw body, consulted only for a sibling `fields` list
 *   when `details` is not an array.
 */
export function toFieldViolations(
  status: number,
  envelope: ErrorEnvelope,
  rawBody?: unknown,
): readonly FieldViolation[] {
  if (status !== 422 || !isValidationErrorKey(envelope.error)) {
    return []
  }
  return violationSource(envelope, rawBody).map(toFieldViolation)
}

/**
 * Decodes a 400–599 response into the uniform {@link ApiError} every Web_Client
 * feature consumes (AC4–AC9).
 */
export function decodeApiError(response: RawErrorResponse): ApiError {
  const { status, body, headers } = response
  const envelope = decodeErrorEnvelope(body, headers)
  return {
    ...envelope,
    httpStatus: status,
    supportReference: readSupportReference(headers),
    refreshEligible: isRefreshEligible(status),
    authOutcome: classifyAuthOutcome(status),
    fieldViolations: toFieldViolations(status, envelope, body),
  }
}
