import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  REQUEST_ID_HEADER,
  UNEXPECTED_RESPONSE_ERROR,
  decodeApiError,
  decodeErrorEnvelope,
  type HeaderSource,
} from './errors'

/**
 * The four members every decoded Error_Envelope exposes (Requirement 3 AC4).
 */
const ENVELOPE_MEMBERS = ['details', 'error', 'message', 'request_id'] as const

/** Lookup form of {@link ENVELOPE_MEMBERS}, used to keep generated members distinct. */
const ENVELOPE_MEMBER_NAMES: ReadonlySet<string> = new Set(ENVELOPE_MEMBERS)

/** The decodable members a generated body is expected to preserve unchanged. */
interface DecodedMembers {
  readonly error: string
  readonly message: string | null
  readonly details: unknown
}

/**
 * A generated 400–599 response body paired with what the decoder must produce.
 *
 * `decoded` is `null` when the body is undecodable — i.e. when it is not a JSON
 * object carrying a string `error` member — in which case the envelope must be
 * the synthesized `unexpected_response` one (AC5). `bodyRequestId` is the string
 * `request_id` the body itself supplies, or `null` when it supplies none.
 */
interface BodyCase {
  readonly label: string
  readonly body: unknown
  readonly decoded: DecodedMembers | null
  readonly bodyRequestId: string | null
}

/** A generated header collection paired with its `X-Request-ID` value. */
interface HeaderCase {
  readonly label: string
  readonly headers: HeaderSource
  readonly expected: string | null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The decodability rule: a JSON object carrying a string `error` member (AC4, AC5). */
function isDecodableEnvelopeBody(value: unknown): boolean {
  return isPlainObject(value) && typeof value.error === 'string'
}

/** Whether a raw string body would parse into a decodable envelope. */
function parsesToDecodableEnvelope(text: string): boolean {
  try {
    return isDecodableEnvelopeBody(JSON.parse(text) as unknown)
  } catch {
    return false
  }
}

const jsonValue = fc.jsonValue() as fc.Arbitrary<unknown>

/** A JSON value that is not a string, used for wrongly-typed envelope members. */
const nonStringJson = jsonValue.filter((value) => typeof value !== 'string')

/** A stable machine key, either a real taxonomy key or an arbitrary string. */
const errorKey = fc.oneof(
  fc.constantFrom(
    'validation_failed',
    'validation_error',
    'not_authorized',
    'authentication_required',
    'rate_limited',
    'conflicting_state',
    'precondition_unmet',
    'upstream_unavailable',
    UNEXPECTED_RESPONSE_ERROR,
  ),
  fc.string({ maxLength: 24 }),
)

/** Members the envelope must ignore: anything outside the four known names. */
const extraMembers = fc
  .dictionary(fc.string({ maxLength: 8 }), jsonValue, { maxKeys: 3 })
  .map((entries) =>
    Object.fromEntries(
      Object.entries(entries).filter(([key]) => !ENVELOPE_MEMBER_NAMES.has(key)),
    ),
  )

/**
 * A body that is a valid Error_Envelope: a JSON object with a string `error`,
 * optionally carrying `message`, `details` and `request_id` members of either
 * the contracted or a wrong type, delivered either already-parsed or as the raw
 * JSON text the Backend_Api would put on the wire.
 */
const decodableBodyCase: fc.Arbitrary<BodyCase> = fc
  .record({
    error: errorKey,
    message: fc.option(fc.oneof(fc.string({ maxLength: 40 }), nonStringJson), { nil: undefined }),
    details: fc.option(jsonValue, { nil: undefined }),
    requestId: fc.option(fc.oneof(fc.string({ maxLength: 24 }), nonStringJson), { nil: undefined }),
    extra: extraMembers,
    serialize: fc.boolean(),
  })
  .map(({ error, message, details, requestId, extra, serialize }) => {
    const raw: Record<string, unknown> = { ...extra, error }
    if (message !== undefined) {
      raw.message = message
    }
    if (details !== undefined) {
      raw.details = details
    }
    if (requestId !== undefined) {
      raw.request_id = requestId
    }

    const body = serialize ? JSON.stringify(raw) : raw
    // A serialized body reaches the decoder as text, so the members it must
    // preserve are the ones `JSON.parse` yields (JSON collapses `-0` to `0`).
    const parsed = serialize ? (JSON.parse(body as string) as Record<string, unknown>) : raw

    return {
      label: serialize ? 'decodable-text' : 'decodable-object',
      body,
      decoded: {
        error: parsed.error as string,
        message: typeof parsed.message === 'string' ? parsed.message : null,
        details: parsed.details === undefined ? null : parsed.details,
      },
      bodyRequestId: typeof parsed.request_id === 'string' ? parsed.request_id : null,
    }
  })

function undecodable(label: string, body: unknown): BodyCase {
  return { label, body, decoded: null, bodyRequestId: null }
}

/** A JSON value that is not a valid envelope: an array, a primitive, or a wrongly-shaped object. */
const nonEnvelopeJson = jsonValue.filter((value) => !isDecodableEnvelopeBody(value))

/**
 * A body the decoder cannot read as an Error_Envelope: malformed JSON, an empty
 * body, no body at all, or well-formed JSON of the wrong shape (AC5).
 */
const undecodableBodyCase: fc.Arbitrary<BodyCase> = fc.oneof(
  nonEnvelopeJson.map((value) => undecodable('wrong-shape', value)),
  nonEnvelopeJson.map((value) => undecodable('wrong-shape-text', JSON.stringify(value))),
  fc
    .constantFrom<unknown[]>(
      undefined,
      null,
      '',
      '   ',
      '<html><body>502 Bad Gateway</body></html>',
      '{"error":',
      '[{"error":"x"}',
      'Internal Server Error',
      new Date(0),
    )
    .map((value) => undecodable('malformed', value)),
  fc
    .string({ maxLength: 40 })
    .filter((text) => !parsesToDecodableEnvelope(text))
    .map((text) => undecodable('arbitrary-text', text)),
)

const bodyCase: fc.Arbitrary<BodyCase> = fc.oneof(decodableBodyCase, undecodableBodyCase)

/** Spellings of the Support_Reference header; reading it is case-insensitive (AC6). */
const requestIdSpelling = fc.constantFrom(
  REQUEST_ID_HEADER,
  REQUEST_ID_HEADER.toLowerCase(),
  REQUEST_ID_HEADER.toUpperCase(),
  'x-Request-Id',
)

/** Unrelated headers that must never be mistaken for the Support_Reference. */
const otherHeaderName = fc.constantFrom('Content-Type', 'Retry-After', 'X-Trace-Id', 'Date')

/**
 * A header value that survives `Headers` normalization unchanged, so the same
 * generated value can be asserted across every header collection shape.
 */
const headerValue = fc.string({ maxLength: 20 }).map((value) => value.trim())

const stringHeaderEntries = fc.record({
  requestId: fc.option(fc.record({ name: requestIdSpelling, value: headerValue }), { nil: null }),
  others: fc.uniqueArray(fc.record({ name: otherHeaderName, value: headerValue }), {
    maxLength: 3,
    selector: (entry) => entry.name.toLowerCase(),
  }),
})

/** `Headers` and `Map` collections, whose values are always strings. */
const stringHeaderCase: fc.Arbitrary<HeaderCase> = fc
  .record({
    kind: fc.constantFrom('headers' as const, 'map' as const),
    entries: stringHeaderEntries,
  })
  .map(({ kind, entries }) => {
    const pairs: [string, string][] = [
      ...entries.others.map((entry): [string, string] => [entry.name, entry.value]),
      ...(entries.requestId ? [[entries.requestId.name, entries.requestId.value] as [string, string]] : []),
    ]
    return {
      label: kind,
      headers: kind === 'headers' ? new Headers(pairs) : new Map(pairs),
      expected: entries.requestId ? entries.requestId.value : null,
    }
  })

/** A plain-record header value, which may also be a list, `null` or absent. */
const recordHeaderValue = fc.oneof<fc.Arbitrary<string | readonly string[] | null | undefined>[]>(
  headerValue,
  fc.array(headerValue, { maxLength: 3 }),
  fc.constant(null),
  fc.constant(undefined),
)

function firstStringOf(value: string | readonly string[] | null | undefined): string | null {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === 'string')
    return first ?? null
  }
  return null
}

/** A plain-record header collection, as a non-`fetch` transport might supply. */
const recordHeaderCase: fc.Arbitrary<HeaderCase> = fc
  .record({
    requestId: fc.option(fc.record({ name: requestIdSpelling, value: recordHeaderValue }), {
      nil: null,
    }),
    others: fc.uniqueArray(fc.record({ name: otherHeaderName, value: recordHeaderValue }), {
      maxLength: 3,
      selector: (entry) => entry.name.toLowerCase(),
    }),
  })
  .map(({ requestId, others }) => {
    const headers: Record<string, string | readonly string[] | null | undefined> = {}
    for (const entry of others) {
      headers[entry.name] = entry.value
    }
    if (requestId) {
      headers[requestId.name] = requestId.value
    }
    return {
      label: 'record',
      headers,
      expected: requestId ? firstStringOf(requestId.value) : null,
    }
  })

const headerCase: fc.Arbitrary<HeaderCase> = fc.oneof(
  stringHeaderCase,
  recordHeaderCase,
  fc
    .constantFrom<HeaderSource[]>(undefined, null, new Headers(), {})
    .map((headers) => ({ label: 'absent', headers, expected: null })),
)

describe('error envelope decoding properties', () => {
  // Feature: frontend-web-application, Property 1: Error decoding always yields a
  // well-formed envelope — For any HTTP response with a status code in 400–599 and
  // any response body (a valid Error_Envelope, malformed JSON, or a wrongly-shaped
  // object), the Api_Client decoder produces an Error_Envelope that exposes
  // `error`, `message`, `details` and `request_id`; when the body is a valid
  // envelope its members are preserved unchanged, and otherwise the `error` member
  // is `unexpected_response`; in every case the `request_id` member equals the
  // `X-Request-ID` header value when present and is `null` when absent.
  //
  // Spec resolution: the design prose reads as though `request_id` always equals
  // the header value, while Requirement 3 AC5/AC6 and the task text specify the
  // header as the source when the *body* lacks one. This test follows the
  // requirement text — `request_id` is body-preferred with a header fallback — and
  // additionally asserts the member that does hold the design's stronger reading,
  // `supportReference`, which always equals the header value or `null` (AC6).
  //
  // **Validates: Requirements 3.4, 3.5, 3.6**
  it('exposes all four members, preserves a valid envelope and synthesizes unexpected_response otherwise', () => {
    fc.assert(
      fc.property(
        bodyCase,
        headerCase,
        fc.integer({ min: 400, max: 599 }),
        (body, headers, status) => {
          const envelope = decodeErrorEnvelope(body.body, headers.headers)

          // AC4: the envelope exposes exactly the four contracted members, and
          // nothing the body carried alongside them.
          expect(Object.keys(envelope).sort()).toEqual([...ENVELOPE_MEMBERS])
          expect(typeof envelope.error).toBe('string')
          expect(envelope.message === null || typeof envelope.message === 'string').toBe(true)
          expect(envelope.request_id === null || typeof envelope.request_id === 'string').toBe(true)

          if (body.decoded === null) {
            // AC5: an undecodable body yields the synthesized envelope.
            expect(envelope.error).toBe(UNEXPECTED_RESPONSE_ERROR)
            expect(envelope.message).toBeNull()
            expect(envelope.details).toBeNull()
          } else {
            // AC4: a valid envelope keeps its members unchanged.
            expect(envelope.error).toBe(body.decoded.error)
            expect(envelope.message).toBe(body.decoded.message)
            expect(envelope.details).toStrictEqual(body.decoded.details)
          }

          // AC5, AC6: the header supplies `request_id` whenever the body does not.
          expect(envelope.request_id).toBe(body.bodyRequestId ?? headers.expected)

          // The full decode over the whole 400–599 range agrees with the envelope
          // and always records the header value as the Support_Reference (AC6).
          const decoded = decodeApiError({ status, body: body.body, headers: headers.headers })
          expect(decoded.error).toBe(envelope.error)
          expect(decoded.message).toBe(envelope.message)
          expect(decoded.details).toStrictEqual(envelope.details)
          expect(decoded.request_id).toBe(envelope.request_id)
          expect(decoded.supportReference).toBe(headers.expected)
        },
      ),
      { numRuns: 300 },
    )
  })
})
