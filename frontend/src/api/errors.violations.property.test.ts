import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  UNKNOWN_VIOLATION_CODE,
  VALIDATION_ERROR_KEYS,
  decodeErrorEnvelope,
  toFieldViolations,
} from './errors'

/**
 * One generated `details` element paired with the violation it must produce.
 *
 * `expectedPath` is `null` for an element that addresses no field at all; the
 * mapper must then fall back to the element's position, which only the property
 * body knows because it depends on the index in the generated list.
 */
interface ViolationCase {
  /** The element as it appears inside the response `details` array. */
  readonly element: unknown
  /** The `path` the mapper must expose, or `null` for the positional fallback. */
  readonly expectedPath: string | null
  /** The `code` the mapper must expose. */
  readonly expectedCode: string
}

/** One step of a FastAPI `loc` array after the request-part prefix. */
type LocStep = { readonly kind: 'field'; readonly name: string } | { readonly kind: 'index'; readonly at: number }

/**
 * Field names as the Backend_Api emits them. None of them collides with a
 * request-part prefix, so a generated `loc` head is never dropped as one.
 */
const fieldName = fc.constantFrom(
  'email',
  'phone_number',
  'education',
  'work_history',
  'start_year',
  'end_year',
  'rating',
  'password',
  'linkedin_url',
  'entries',
)

/** Machine sub-codes: platform `code` values and FastAPI `type` values. */
const violationCode = fc.constantFrom(
  'missing',
  'string_too_short',
  'end_before_start',
  'invalid_email',
  'int_parsing',
  'value_error',
)

/** The request part FastAPI names first in `loc`; it addresses no input. */
const requestPart = fc.constantFrom('body', 'query', 'path', 'header', 'cookie')

/** A platform `validation_failed` element: `{path, code, message}`. */
const platformCase: fc.Arbitrary<ViolationCase> = fc
  .record({
    path: fc.string({ minLength: 1, maxLength: 40 }),
    code: fc.option(violationCode, { nil: null }),
    message: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: null }),
  })
  .map(({ path, code, message }) => {
    const element: Record<string, unknown> = { path }
    if (code !== null) {
      element.code = code
    }
    if (message !== null) {
      element.message = message
    }
    return { element, expectedPath: path, expectedCode: code ?? UNKNOWN_VIOLATION_CODE }
  })

/**
 * A FastAPI `validation_error` element: `{loc, msg, type}`. The `loc` array and
 * the expected form-addressable path are built from the same generated steps,
 * so the expectation is constructed rather than re-derived from the array.
 */
const locCase: fc.Arbitrary<ViolationCase> = fc
  .record({
    prefix: fc.option(requestPart, { nil: null }),
    head: fieldName,
    steps: fc.array(
      fc.oneof(
        fieldName.map((name): LocStep => ({ kind: 'field', name })),
        fc.nat({ max: 20 }).map((at): LocStep => ({ kind: 'index', at })),
      ),
      { maxLength: 3 },
    ),
    type: fc.option(violationCode, { nil: null }),
    msg: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: null }),
  })
  .map(({ prefix, head, steps, type, msg }) => {
    const loc: (string | number)[] = prefix === null ? [head] : [prefix, head]
    let path = head
    for (const step of steps) {
      if (step.kind === 'index') {
        loc.push(step.at)
        path += `[${step.at}]`
      } else {
        loc.push(step.name)
        path += `.${step.name}`
      }
    }
    const element: Record<string, unknown> = { loc }
    if (type !== null) {
      element.type = type
    }
    if (msg !== null) {
      element.msg = msg
    }
    return { element, expectedPath: path, expectedCode: type ?? UNKNOWN_VIOLATION_CODE }
  })

/**
 * An element that addresses no field: a non-object, an object carrying neither
 * `path` nor a usable `loc`, or a `loc` that reduces to nothing once the
 * request-part prefix is dropped. Such an element must still yield exactly one
 * violation, addressed by its position.
 */
const unaddressedCase: fc.Arbitrary<ViolationCase> = fc
  .record({
    shape: fc.constantFrom(
      'null',
      'text',
      'number',
      'array',
      'empty-object',
      'blank-path',
      'empty-loc',
      'non-array-loc',
      'prefix-only-loc',
    ),
    code: fc.option(violationCode, { nil: null }),
    text: fc.string({ maxLength: 20 }),
    prefix: requestPart,
  })
  .map(({ shape, code, text, prefix }) => {
    const carriesCode = code !== null
    const withCode = (base: Record<string, unknown>): Record<string, unknown> =>
      carriesCode ? { ...base, code } : base
    const elementOf = (): unknown => {
      switch (shape) {
        case 'null':
          return null
        case 'text':
          return text
        case 'number':
          return 42
        case 'array':
          return [text]
        case 'empty-object':
          return withCode({})
        case 'blank-path':
          return withCode({ path: '' })
        case 'empty-loc':
          return withCode({ loc: [] })
        case 'non-array-loc':
          return withCode({ loc: text })
        default:
          return withCode({ loc: [prefix] })
      }
    }
    const isRecordShape = shape !== 'null' && shape !== 'text' && shape !== 'number' && shape !== 'array'
    return {
      element: elementOf(),
      expectedPath: null,
      expectedCode: isRecordShape && code !== null ? code : UNKNOWN_VIOLATION_CODE,
    }
  })

const violationCase: fc.Arbitrary<ViolationCase> = fc.oneof(platformCase, locCase, unaddressedCase)

/**
 * A `details` array, optionally repeated so identical elements appear twice: a
 * mapper that deduplicated or collapsed equal elements would lose entries.
 */
const detailsCase: fc.Arbitrary<readonly ViolationCase[]> = fc
  .record({
    cases: fc.array(violationCase, { maxLength: 8 }),
    repeated: fc.boolean(),
  })
  .map(({ cases, repeated }) => (repeated ? [...cases, ...cases] : cases))

describe('Field_Violation mapping properties', () => {
  // Feature: frontend-web-application, Property 3: Validation details map to a
  // complete Field_Violation list — For any 422 response whose `error` member is
  // `validation_error` or `validation_failed` and any `details` array, the
  // produced Field_Violation list has one entry per details element, and every
  // entry exposes a `path` and a `code`.
  //
  // **Validates: Requirements 3.9**
  it('produces one addressed violation per details element, in order', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VALIDATION_ERROR_KEYS),
        detailsCase,
        fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: null }),
        (errorKey, cases, message) => {
          const body = { error: errorKey, message, details: cases.map((entry) => entry.element) }
          const violations = toFieldViolations(422, decodeErrorEnvelope(body), body)

          // Total: one entry per source element, nothing dropped or collapsed.
          expect(violations).toHaveLength(cases.length)

          cases.forEach((source, index) => {
            const violation = violations[index]
            // Positionally faithful: the nth violation describes the nth element.
            expect(violation.path).toBe(source.expectedPath ?? `details[${index}]`)
            expect(violation.code).toBe(source.expectedCode)
            // Every entry is addressable and carries a machine sub-code.
            expect(violation.path.length).toBeGreaterThan(0)
            expect(violation.code.length).toBeGreaterThan(0)
          })
        },
      ),
      { numRuns: 300 },
    )
  })
})
