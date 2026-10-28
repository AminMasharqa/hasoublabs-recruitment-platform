import fc from 'fast-check'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'

import { BidiText } from './DirectionProvider'
import { isByteIdentical, textForDisplay, textForSubmission, toUtf8Bytes } from './formatting'

/**
 * Property 11 targets the passthrough pair in `formatting.ts`, which is where the
 * byte-identical guarantee of Requirement 19 AC10 and AC11 is implemented. The
 * generators below are built out of single code points whose identity is known by
 * construction, so the expected value is always the generated value itself and
 * never something recomputed with the same machinery the unit uses.
 */

/** Latin letters and digits: unremarkable content the round-trip must not disturb. */
const latin = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCXYZ0123456789.,-')

/** Arabic letters, including ones whose shaping depends on their neighbours. */
const arabicLetter = fc.constantFrom(...'أبتثجحخدذرزسشصضطظعغفقكلمنهوىيء')

/** Hebrew letters and the final forms. */
const hebrewLetter = fc.constantFrom(...'אבגדהוזחטיכלמנסעפצקרשתךםןףץ')

/**
 * Combining marks: Arabic harakat, Hebrew niqqud and accents, and Latin
 * diacritics. Each is a code point of its own that NFC may compose into its
 * base, which is exactly the transformation AC10 forbids.
 */
const combiningMark = fc.constantFrom(
  '\u064B', // Arabic fathatan
  '\u064E', // Arabic fatha
  '\u0650', // Arabic kasra
  '\u0651', // Arabic shadda
  '\u0652', // Arabic sukun
  '\u0670', // Arabic letter superscript alef
  '\u05B4', // Hebrew point hiriq
  '\u05B8', // Hebrew point qamats
  '\u05BC', // Hebrew point dagesh
  '\u0591', // Hebrew accent etnahta
  '\u05C1', // Hebrew point shin dot
  '\u0301', // combining acute accent
  '\u0308', // combining diaeresis
  '\u0327', // combining cedilla
)

/**
 * Bidirectional control characters: the marks, the isolates and the deprecated
 * embeddings. They are invisible, so a `replace` that "cleans up" a value drops
 * them without a trace — and they change how the run reads.
 */
const bidiControl = fc.constantFrom(
  '\u200E', // LEFT-TO-RIGHT MARK
  '\u200F', // RIGHT-TO-LEFT MARK
  '\u2066', // LEFT-TO-RIGHT ISOLATE
  '\u2067', // RIGHT-TO-LEFT ISOLATE
  '\u2068', // FIRST STRONG ISOLATE
  '\u2069', // POP DIRECTIONAL ISOLATE
  '\u202A', // LEFT-TO-RIGHT EMBEDDING
  '\u202B', // RIGHT-TO-LEFT EMBEDDING
  '\u202C', // POP DIRECTIONAL FORMATTING
  '\u202D', // LEFT-TO-RIGHT OVERRIDE
  '\u202E', // RIGHT-TO-LEFT OVERRIDE
)

/** Zero-width joiner and non-joiner, which Arabic shaping and emoji depend on. */
const zeroWidthJoiner = fc.constantFrom('\u200C', '\u200D')

/**
 * Astral code points: a single character above the BMP, so two UTF-16 code units
 * that must survive as a pair. Drawn from emoji and pictographs, ancient scripts
 * and the regional indicators flags are built from.
 */
const astral = fc
  .oneof(
    fc.integer({ min: 0x1f300, max: 0x1faff }),
    fc.integer({ min: 0x10380, max: 0x1039d }),
    fc.integer({ min: 0x1f1e6, max: 0x1f1ff }),
  )
  .map((codePoint) => String.fromCodePoint(codePoint))

/** Pre-built sequences whose meaning lives in their exact code-point order. */
const sequence = fc.constantFrom(
  '👨\u200D👩\u200D👧', // ZWJ family
  '👩🏽\u200D💻', // ZWJ with a skin-tone modifier
  '🇸🇦', // regional indicator pair
  '🇮🇱',
  'بـ\u200Cـت', // ZWNJ between Arabic letters
  'مُحَمَّد',
  'שָׁלוֹם',
  'e\u0301',
  'a\u200Eب\u200Fc',
  '\u2066english\u2069 \u2067عربي\u2069',
  '\u202Bנטוע\u202C',
)

/** Whitespace a `trim()` would eat, at either end or in the interior. */
const whitespace = fc.constantFrom(' ', '  ', '\t', '\n', '\r\n', '\u00A0', '\u2009')

/** Any single piece of a generated value. */
const piece: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: latin, weight: 3 },
  { arbitrary: arabicLetter, weight: 4 },
  { arbitrary: hebrewLetter, weight: 4 },
  { arbitrary: combiningMark, weight: 4 },
  { arbitrary: bidiControl, weight: 4 },
  { arbitrary: zeroWidthJoiner, weight: 2 },
  { arbitrary: astral, weight: 3 },
  { arbitrary: sequence, weight: 3 },
  { arbitrary: whitespace, weight: 2 },
)

/** Mixed Arabic/Hebrew/Latin runs, from the empty string upward. */
const mixedRun: fc.Arbitrary<string> = fc
  .array(piece, { maxLength: 20 })
  .map((pieces) => pieces.join(''))

/** A value padded with whitespace at both ends, so trimming is always visible. */
const whitespacePadded: fc.Arbitrary<string> = fc
  .tuple(whitespace, mixedRun, whitespace)
  .map(([lead, body, trail]) => `${lead}${body}${trail}`)

/**
 * A decomposed value: a base letter followed by at least one combining mark, so
 * its NFC form is strictly shorter than the value itself. This is the input that
 * makes "is not normalized" an assertion rather than a claim.
 */
const decomposed: fc.Arbitrary<string> = fc
  .tuple(
    fc.array(fc.tuple(fc.oneof(latin, arabicLetter, hebrewLetter), combiningMark), {
      minLength: 1,
      maxLength: 6,
    }),
    mixedRun,
  )
  .map(([pairs, tail]) => `${pairs.map(([base, mark]) => `${base}${mark}`).join('')}${tail}`)

/**
 * Every string the passthrough pair could be handed. Composed only of
 * well-formed code points: a lone surrogate is not a value the Backend_Api or a
 * text input can produce, and UTF-8 encoding has no representation for one, so
 * including it would test `TextEncoder` rather than the unit.
 */
const anyText: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: mixedRun, weight: 5 },
  { arbitrary: whitespacePadded, weight: 3 },
  { arbitrary: decomposed, weight: 3 },
  { arbitrary: sequence, weight: 2 },
  { arbitrary: fc.string({ unit: 'grapheme' }), weight: 2 },
  { arbitrary: fc.constantFrom('', ' ', '\t\n', '\u200F', '\u0651'), weight: 1 },
)

/** The UTF-8 bytes of a string as a plain array, for a readable diff on failure. */
const bytes = (value: string): number[] => [...toUtf8Bytes(value)]

describe('bidirectional text passthrough properties', () => {
  // Feature: frontend-web-application, Property 11: Bidirectional text
  // round-trips byte-identically — For any string, including Arabic and Hebrew
  // content, combining marks and bidirectional control characters, the value
  // obtained by rendering it and then reading it back for submission is
  // byte-identical to the original, with no transliteration, normalization,
  // character substitution or reordering.
  //
  // **Validates: Requirements 19.10, 19.11**
  it('round-trips every string byte-identically, without normalizing or reordering it', () => {
    fc.assert(
      fc.property(anyText, (original) => {
        // AC10: what is rendered is the retrieved value itself.
        const displayed = textForDisplay(original)
        // AC11: what is read back for submission is the entered value itself.
        const submitted = textForSubmission(displayed)

        // The round-trip law, asserted at the byte level and not only by `===`.
        expect(isByteIdentical(submitted, original)).toBe(true)
        expect(bytes(submitted)).toEqual(bytes(original))
        expect(isByteIdentical(displayed, original)).toBe(true)
        expect(submitted).toBe(original)

        // No transformation of any kind was applied on either leg: the code-unit
        // length is preserved (so no trim, no substitution, no composition) and
        // the code-point order is preserved (so no reordering).
        expect(submitted.length).toBe(original.length)
        expect([...submitted]).toEqual([...original])
        expect(submitted.codePointAt(0)).toBe(original.codePointAt(0))

        // The round-trip is idempotent, so no transformation hides in a second
        // pass through the pair.
        expect(textForSubmission(textForDisplay(submitted))).toBe(original)

        // Not normalized: for a value that is not already in a normal form, the
        // result differs from every normalization of it — including at the byte
        // level, where an NFC composition is a different encoding of the same
        // canonical text.
        for (const form of ['NFC', 'NFKC', 'NFD', 'NFKD'] as const) {
          const normalized = original.normalize(form)
          if (normalized !== original) {
            expect(submitted).not.toBe(normalized)
            expect(isByteIdentical(submitted, normalized)).toBe(false)
            expect(bytes(submitted)).not.toEqual(bytes(normalized))
          }
        }

        // Not case mapped, and not stripped of its invisible characters: where
        // such a transformation would change the value, the result is not it.
        for (const mangled of [
          original.toLowerCase(),
          original.toUpperCase(),
          original.trim(),
          original.replaceAll(/[\u200B-\u200F\u2066-\u2069\u202A-\u202E]/gu, ''),
        ]) {
          if (mangled !== original) {
            expect(submitted).not.toBe(mangled)
          }
        }

        // The rendering half of the law: `BidiText` isolates the run visually
        // with `dir="auto"` and `unicode-bidi: isolate`, and the text it puts in
        // the DOM is still byte-identical to the value it was given.
        const { container, unmount } = render(createElement(BidiText, { value: original }))
        const span = container.firstElementChild
        expect(span?.getAttribute('dir')).toBe('auto')
        expect(textForSubmission(span?.textContent)).toBe(original)
        expect(isByteIdentical(span?.textContent ?? '', original)).toBe(true)
        unmount()
      }),
      { numRuns: 300 },
    )
  })
})
