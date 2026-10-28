import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { RTL_LOCALES, resolveDirection, resolveDirectionForLanguageTag } from './direction'
import { SUPPORTED_LOCALES, localeFromLanguageTag, type Locale } from './locale'

/** The complete Locale domain: three values, so the property covers it exhaustively. */
const locale: fc.Arbitrary<Locale> = fc.constantFrom(...SUPPORTED_LOCALES)

/** The right-to-left Locales, as a plain set for an independent membership check. */
const rtlLocales: ReadonlySet<string> = new Set(RTL_LOCALES)

/** A subtag casing variant, since browsers and stored preferences are inconsistent. */
const recased = (value: string): fc.Arbitrary<string> =>
  fc.constantFrom(value, value.toUpperCase(), `${value.charAt(0).toUpperCase()}${value.slice(1)}`)

/** A region/script suffix appended to a primary subtag (`ar-SA`, `he_IL`, `en-Latn-GB`). */
const suffix: fc.Arbitrary<string> = fc.constantFrom(
  '',
  '-SA',
  '-EG',
  '_IL',
  '-GB',
  '-US',
  '-Latn-GB',
  '-x-private',
)

/** A language tag whose primary subtag names a supported Locale, in any casing. */
const supportedTag: fc.Arbitrary<string> = fc
  .tuple(locale.chain(recased), suffix)
  .map(([primary, region]) => `${primary}${region}`)

/** A tag naming a language the Web_Client does not ship, including RTL ones. */
const unsupportedTag: fc.Arbitrary<string> = fc
  .tuple(fc.constantFrom('fr', 'de', 'fa', 'ur', 'zh', 'arabic', 'hebrew', 'e', 'a'), suffix)
  .map(([primary, region]) => `${primary}${region}`)

/** Junk: arbitrary strings, whitespace, separators and non-string values. */
const junkTag: fc.Arbitrary<unknown> = fc.oneof(
  fc.string(),
  fc.constantFrom('', ' ', '-', '_', '--', 'ar ab', 'he!', '123', 'null'),
  fc.constantFrom<unknown[]>(null, undefined, 0, 42, true, false, {}, [], ['ar']),
)

/** Any language tag the Direction_Provider could be handed. */
const anyTag: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 3, arbitrary: supportedTag },
  { weight: 2, arbitrary: unsupportedTag },
  { weight: 2, arbitrary: junkTag },
)

describe('direction resolution properties', () => {
  // Feature: frontend-web-application, Property 10: Direction resolution —
  // For any active Locale, the Direction_Provider resolves the direction to
  // `rtl` if and only if the Locale is `ar` or `he`, and to `ltr` otherwise.
  //
  // **Validates: Requirements 19.6, 19.7**
  it('resolves rtl iff the Locale is ar or he, and ltr otherwise', () => {
    fc.assert(
      fc.property(locale, anyTag, (activeLocale, tag) => {
        const direction = resolveDirection(activeLocale)

        // The result is always exactly one of the two supported directions.
        expect(['rtl', 'ltr']).toContain(direction)
        // The biconditional over the full Locale domain.
        expect(direction === 'rtl').toBe(rtlLocales.has(activeLocale))
        expect(direction).toBe(rtlLocales.has(activeLocale) ? 'rtl' : 'ltr')

        // The same biconditional holds for arbitrary language tags, via the
        // Locale the tag names; a tag naming no supported Locale is `ltr`.
        const tagDirection = resolveDirectionForLanguageTag(tag)
        const namedLocale = localeFromLanguageTag(tag)

        expect(['rtl', 'ltr']).toContain(tagDirection)
        expect(tagDirection === 'rtl').toBe(namedLocale !== null && rtlLocales.has(namedLocale))
        if (namedLocale === null) {
          expect(tagDirection).toBe('ltr')
        } else {
          expect(tagDirection).toBe(resolveDirection(namedLocale))
        }
      }),
      { numRuns: 500 },
    )
  })
})
