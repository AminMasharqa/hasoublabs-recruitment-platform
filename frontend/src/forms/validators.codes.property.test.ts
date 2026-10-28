import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  BOUNDS,
  isSixDigitCode,
  isValidRating,
  validateMfaCode,
  validateRating,
  validateSixDigitCode,
  validateVerificationCode,
} from './validators'

/**
 * One generated input, tagged with the rule it is offered to: a Verification_Code
 * / multi-factor code input, or a rating input. Both halves of Property 16 are
 * exercised by the same run so the biconditionals are checked against the same
 * breadth of shapes.
 */
type ValidatorCase =
  | { readonly kind: 'code'; readonly value: unknown }
  | { readonly kind: 'rating'; readonly value: unknown }

// ── Independent oracles ───────────────────────────────────────────────────────

/**
 * Oracle for the code half: exactly six ASCII digits.
 *
 * Stated independently of the implementation — no regular expression, code
 * points counted with the string iterator and each one compared against the
 * ASCII `0`–`9` range (U+0030–U+0039) by ordinal. A localized digit shape such
 * as `"١٢٣٤٥٦"` therefore falls outside the range even though it reads as six
 * digits, and an astral digit such as `"𝟏"` counts as one code point rather than
 * as its two UTF-16 code units.
 */
function isExactlySixAsciiDigits(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false
  }
  const codePoints = Array.from(value)
  if (codePoints.length !== 6) {
    return false
  }
  return codePoints.every((codePoint) => {
    const ordinal = codePoint.codePointAt(0) ?? -1
    return ordinal >= 0x30 && ordinal <= 0x39
  })
}

/**
 * Oracle for the rating half, enumerated rather than computed: the integers 1
 * through 5 are exactly the accepted values, and only as `number`s. A numeric
 * string is not a member, which is what "a caller coerces before validating"
 * means in practice.
 */
const ACCEPTED_RATINGS: ReadonlySet<unknown> = new Set([1, 2, 3, 4, 5])

function isAcceptedRating(value: unknown): boolean {
  return typeof value === 'number' && ACCEPTED_RATINGS.has(value)
}

// ── Code generators ───────────────────────────────────────────────────────────

const ASCII_DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

const asciiDigit = fc.constantFrom(...ASCII_DIGITS)

/** Digit shapes that read as digits but are not ASCII digits. */
const localizedDigit = fc.constantFrom(
  // Arabic-Indic U+0660–U+0669.
  '٠',
  '١',
  '٢',
  '٣',
  '٤',
  '٥',
  '٦',
  '٧',
  '٨',
  '٩',
  // Extended Arabic-Indic (Persian) U+06F0–U+06F9.
  '۰',
  '۱',
  '۲',
  '۳',
  '۴',
  '۵',
  // Devanagari U+0966–U+096F.
  '०',
  '१',
  '२',
  '३',
  // Fullwidth U+FF10–U+FF19.
  '０',
  '１',
  '２',
  '３',
  // Mathematical bold, astral: one code point, two UTF-16 code units.
  '𝟏',
  '𝟐',
  '𝟑',
)

/** Characters that are not digits of any shape. */
const nonDigit = fc.constantFrom('a', 'Z', '+', '-', '.', '_', '/', ' ', '\t', 'é', '٫', '𝔸')

const joined = (characters: readonly string[]): string => characters.join('')

/** Exactly six ASCII digits — the accepted shape. */
const wellFormedCode = fc.array(asciiDigit, { minLength: 6, maxLength: 6 }).map(joined)

/** ASCII digits at any length from 0 to 10, straddling the six-digit bound. */
const anyLengthDigits = fc.array(asciiDigit, { minLength: 0, maxLength: 10 }).map(joined)

/** Any mixture of digit and non-digit characters, at any length from 0 to 10. */
const mixedCharacters = fc
  .array(fc.oneof(asciiDigit, localizedDigit, nonDigit), { minLength: 0, maxLength: 10 })
  .map(joined)

/** Six digits in a non-ASCII shape: reads as a code, is not one. */
const localizedDigitCode = fc.array(localizedDigit, { minLength: 6, maxLength: 6 }).map(joined)

/** A sign in front of five or six digits. */
const signedCode = fc
  .tuple(
    fc.constantFrom('+', '-'),
    fc.array(asciiDigit, { minLength: 5, maxLength: 6 }).map(joined),
  )
  .map(([sign, digits]) => `${sign}${digits}`)

const padding = fc.constantFrom('', ' ', '  ', '\t', '\n', '\u00a0', '\u200b')

/** A well-formed code with whitespace around it; the empty padding keeps the accepted case in reach. */
const paddedCode = fc
  .tuple(padding, wellFormedCode, padding)
  .map(([before, code, after]) => `${before}${code}${after}`)

/** Inputs that are not strings at all, including the numeric form of a code. */
const nonStringCode = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.constant(123_456),
  fc.integer({ min: -10, max: 1_000_000 }),
  fc.boolean(),
  fc.constant({}),
  fc.constant({ code: '123456' }),
  fc.constant([]),
  fc.constant(['123456']),
  fc.constant(['1', '2', '3', '4', '5', '6']),
)

const codeCase: fc.Arbitrary<ValidatorCase> = fc
  .oneof(
    wellFormedCode,
    anyLengthDigits,
    mixedCharacters,
    localizedDigitCode,
    signedCode,
    paddedCode,
    nonStringCode,
  )
  .map((value) => ({ kind: 'code', value }) as const)

// ── Rating generators ─────────────────────────────────────────────────────────

/** Integers across a wide range, so the 0/1 and 5/6 boundaries are hit often. */
const integerRating = fc.integer({ min: -20, max: 25 })

/** The boundaries themselves, plus values that sit just outside them. */
const boundaryRating = fc.constantFrom(
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  -1,
  -0,
  0.999_999,
  1.000_000_1,
  4.999_999,
  5.000_000_1,
  1.5,
  2.5,
  4.5,
)

/** Arbitrary finite numbers, fractional ones included. */
const fractionalRating = fc.double({ min: -20, max: 25, noNaN: true })

/** Numbers with no integer reading at all. */
const specialRating = fc.constantFrom(
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  Number.MAX_SAFE_INTEGER,
  Number.MIN_SAFE_INTEGER,
  Number.EPSILON,
)

/** The string form of a rating: rejected here, a caller coerces before validating. */
const numericStringRating = fc.oneof(
  fc.integer({ min: -20, max: 25 }).map(String),
  fc.constantFrom('1', '2', '5', '5.0', ' 3 ', '0', '6', '', '+3', '1e0'),
)

/** Inputs that are not numbers. */
const nonNumberRating = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.boolean(),
  fc.constant({}),
  fc.constant({ rating: 3 }),
  fc.constant([]),
  fc.constant([3]),
  fc.constant('three'),
)

const ratingCase: fc.Arbitrary<ValidatorCase> = fc
  .oneof(
    integerRating,
    boundaryRating,
    fractionalRating,
    specialRating,
    numericStringRating,
    nonNumberRating,
  )
  .map((value) => ({ kind: 'rating', value }) as const)

const validatorCase: fc.Arbitrary<ValidatorCase> = fc.oneof(codeCase, ratingCase)

describe('fixed-format code and rating properties', () => {
  // Feature: frontend-web-application, Property 16: Fixed-format code and rating
  // bounds — For any input, the Form_Validator accepts a Verification_Code or
  // multi-factor code if and only if it is exactly six ASCII digits, and accepts
  // a rating if and only if it is an integer between 1 and 5 inclusive.
  //
  // **Validates: Requirements 22.7, 22.8**
  it('accepts a code iff it is exactly six ASCII digits, and a rating iff it is an integer 1–5', () => {
    // The oracles above are stated against the literal bounds the requirement
    // names; these anchor them to the mirrored Backend_Api bounds.
    expect(BOUNDS.code.length).toBe(6)
    expect(BOUNDS.rating).toEqual({ min: 1, max: 5 })

    fc.assert(
      fc.property(validatorCase, (subject) => {
        if (subject.kind === 'code') {
          const accepted = isExactlySixAsciiDigits(subject.value)

          // The acceptance predicate is the biconditional itself.
          expect(isSixDigitCode(subject.value)).toBe(accepted)

          // Every code rule agrees with it: an issue is reported iff the input
          // is not exactly six ASCII digits.
          const codeIssue = validateSixDigitCode(subject.value)
          expect(codeIssue === null).toBe(accepted)
          expect(validateVerificationCode(subject.value) === null).toBe(accepted)

          const mfaIssue = validateMfaCode(subject.value)
          expect(mfaIssue === null).toBe(accepted)

          if (codeIssue !== null) {
            expect(codeIssue.path).toBe('code')
            expect(['required', 'invalid_code_format']).toContain(codeIssue.code)
            if (codeIssue.code === 'invalid_code_format') {
              // The rejection names the required length.
              expect(codeIssue.messageKey).toBe('validation.codeSixDigits')
              expect(codeIssue.params?.length).toBe(BOUNDS.code.length)
            }
          }
          if (mfaIssue !== null) {
            expect(mfaIssue.path).toBe('mfa_code')
          }
          return
        }

        const accepted = isAcceptedRating(subject.value)

        expect(isValidRating(subject.value)).toBe(accepted)

        const ratingIssue = validateRating(subject.value)
        expect(ratingIssue === null).toBe(accepted)

        if (ratingIssue !== null) {
          expect(ratingIssue.path).toBe('rating')
          expect(['required', 'out_of_range']).toContain(ratingIssue.code)
          if (ratingIssue.code === 'out_of_range') {
            // The rejection names the inclusive range.
            expect(ratingIssue.messageKey).toBe('validation.ratingRange')
            expect(ratingIssue.params?.min).toBe(BOUNDS.rating.min)
            expect(ratingIssue.params?.max).toBe(BOUNDS.rating.max)
          }
        }
      }),
      { numRuns: 1000 },
    )
  })
})
