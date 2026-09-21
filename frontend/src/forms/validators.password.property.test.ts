import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { BOUNDS, countCodePoints, isPasswordLongEnough, validatePassword } from './validators'

/**
 * Independent oracle for the number of Unicode code points in a string.
 *
 * Deliberately implemented by scanning UTF-16 code units and pairing a high
 * surrogate with the low surrogate that follows it, so it shares no machinery
 * with {@link countCodePoints} (which iterates the string). If the unit under
 * test ever regressed to `value.length`, this oracle would still be right.
 */
function codePointCountByUtf16Scan(value: string): number {
  let count = 0
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    const isHighSurrogate = unit >= 0xd800 && unit <= 0xdbff
    if (isHighSurrogate && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        // A surrogate pair: two code units, one code point.
        index += 1
      }
    }
    count += 1
  }
  return count
}

/** Latin letters, digits and punctuation: one code unit, one code point each. */
const asciiCodePoint = fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&*+-_?',
)

/**
 * Astral characters — emoji and pictographs above the BMP. Each is a surrogate
 * pair, so it contributes two UTF-16 code units but only one code point: this is
 * the divergence the requirement is about.
 */
const astralCodePoint = fc
  .integer({ min: 0x1f300, max: 0x1faff })
  .map((codePoint) => String.fromCodePoint(codePoint))

/** Combining marks: separate code points that render as part of a neighbour. */
const combiningMarkCodePoint = fc.constantFrom(
  '\u0301', // combining acute accent
  '\u0308', // combining diaeresis
  '\u064B', // Arabic fathatan
  '\u0651', // Arabic shadda
  '\u05B4', // Hebrew point hiriq
  '\u0591', // Hebrew accent etnahta
  '\u200D', // zero-width joiner
)

/** Arabic letters, and the Hebrew letters and final forms. */
const arabicCodePoint = fc.constantFrom(...'أبتثجحخدذرزسشصضطظعغفقكلمنهوىي')
const hebrewCodePoint = fc.constantFrom(...'אבגדהוזחטיכלמנסעפצקרשתךםןףץ')

/** Any single code point drawn from the mixed script and plane pools above. */
const anyCodePoint: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: asciiCodePoint, weight: 4 },
  { arbitrary: astralCodePoint, weight: 4 },
  { arbitrary: combiningMarkCodePoint, weight: 2 },
  { arbitrary: arabicCodePoint, weight: 3 },
  { arbitrary: hebrewCodePoint, weight: 3 },
)

/**
 * A candidate password together with the number of code points it holds, known
 * by construction: the generator joins single-code-point pieces, so the expected
 * count is the number of pieces and never has to be recomputed from the value.
 */
interface CandidatePassword {
  readonly value: string
  readonly codePoints: number
}

function toCandidate(pieces: readonly string[]): CandidatePassword {
  return { value: pieces.join(''), codePoints: pieces.length }
}

/** Mixed content of any length, from empty to comfortably past the minimum. */
const mixedCandidate: fc.Arbitrary<CandidatePassword> = fc
  .array(anyCodePoint, { maxLength: 24 })
  .map(toCandidate)

/**
 * Lengths that straddle the 10 code-point minimum, so the boundary itself is
 * hit rather than only approached.
 */
const boundaryCandidate: fc.Arbitrary<CandidatePassword> = fc
  .integer({ min: 7, max: 13 })
  .chain((length) => fc.array(anyCodePoint, { minLength: length, maxLength: length }))
  .map(toCandidate)

/**
 * Astral-only content of 5–9 code points: UTF-16 `.length` is 10–18 and so
 * clears the minimum, while the code-point count does not. A validator counting
 * code units would wrongly accept every one of these.
 */
const shortButLongInCodeUnits: fc.Arbitrary<CandidatePassword> = fc
  .array(astralCodePoint, { minLength: 5, maxLength: 9 })
  .map(toCandidate)

/**
 * Astral-heavy content of 10–14 code points, whose `.length` (up to 28) stays
 * well clear of the 128 maximum: accepted on code points, and the counterpart to
 * the case above.
 */
const longEnoughAstral: fc.Arbitrary<CandidatePassword> = fc
  .array(fc.oneof(astralCodePoint, asciiCodePoint), { minLength: 10, maxLength: 14 })
  .map(toCandidate)

const candidatePassword: fc.Arbitrary<CandidatePassword> = fc.oneof(
  { arbitrary: mixedCandidate, weight: 3 },
  { arbitrary: boundaryCandidate, weight: 3 },
  { arbitrary: shortButLongInCodeUnits, weight: 2 },
  { arbitrary: longEnoughAstral, weight: 2 },
)

describe('password length properties', () => {
  // Feature: frontend-web-application, Property 12: Password length is counted
  // in Unicode code points — For any string, the Form_Validator's
  // password-length count equals the number of Unicode code points in the string
  // (not the number of UTF-16 code units), and the password is accepted if and
  // only if that count is at least 10.
  //
  // **Validates: Requirements 22.2, 22.3**
  it('counts code points, not code units, and accepts iff the count is at least 10', () => {
    fc.assert(
      fc.property(candidatePassword, ({ value, codePoints }) => {
        // AC3: the count is the code-point count, by construction and by an
        // independent UTF-16 scan.
        expect(countCodePoints(value)).toBe(codePoints)
        expect(countCodePoints(value)).toBe(codePointCountByUtf16Scan(value))

        // AC2/AC3: acceptance is the biconditional on that count. Because
        // surrogate pairs and combining marks are in play, `value.length` differs
        // from the count for much of this input space, so this also pins down
        // that a code-unit count is not what decides acceptance.
        const longEnough = isPasswordLongEnough(value)
        expect(longEnough).toBe(codePoints >= BOUNDS.password.minCodePoints)

        // The field rule agrees with the predicate wherever the separate maximum
        // bound is not in play: a non-empty value within 128 code points is
        // reported as a policy failure exactly when it is too short.
        if (value !== '' && codePoints <= BOUNDS.password.maxCodePoints) {
          const reported = validatePassword(value)
          expect(reported === null).toBe(longEnough)
          if (reported !== null) {
            expect(reported.code).toBe('password_policy')
            expect(reported.params?.actual).toBe(codePoints)
          }
        }
      }),
      { numRuns: 300 },
    )
  })
})
