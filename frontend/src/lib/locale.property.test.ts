import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { FALLBACK_LOCALE, resolveLocale, SUPPORTED_LOCALES, type Locale } from './locale'

/**
 * A single generated browser language preference entry, paired with the Locale
 * it names (Requirement 19 AC4) or `null` when it names none. The generator
 * builds `names` while it builds `value`, so the oracle never calls back into
 * the unit under test.
 */
interface PreferenceEntry {
  readonly value: unknown
  readonly names: Locale | null
}

/** Region, script and variant subtags browsers actually append to a language. */
const subtags = fc.constantFrom('SA', 'IL', 'US', 'GB', 'EG', 'Arab', 'Hebr', 'Latn', '419')

/** The separators seen in the wild: BCP 47 uses `-`, some platforms emit `_`. */
const separators = fc.constantFrom('-', '_')

/** Browsers and OS settings are inconsistent about case (`he-IL`, `he-il`, `HE`). */
const recasings = fc.constantFrom<(tag: string) => string>(
  (tag) => tag,
  (tag) => tag.toLowerCase(),
  (tag) => tag.toUpperCase(),
)

/** Surrounding whitespace, which a preference list may carry through. */
const paddings = fc.constantFrom<(tag: string) => string>(
  (tag) => tag,
  (tag) => ` ${tag}`,
  (tag) => `${tag} `,
  (tag) => `  ${tag}  `,
)

/** An exact supported code, recased and possibly padded: names that Locale. */
const exactSupported: fc.Arbitrary<PreferenceEntry> = fc
  .record({
    locale: fc.constantFrom(...SUPPORTED_LOCALES),
    recase: recasings,
    pad: paddings,
  })
  .map(({ locale, recase, pad }) => ({ value: pad(recase(locale)), names: locale }))

/** A regional or script variant of a supported code: still names that Locale. */
const variantSupported: fc.Arbitrary<PreferenceEntry> = fc
  .record({
    locale: fc.constantFrom(...SUPPORTED_LOCALES),
    extra: fc.array(subtags, { minLength: 1, maxLength: 2 }),
    separator: separators,
    recase: recasings,
    pad: paddings,
  })
  .map(({ locale, extra, separator, recase, pad }) => ({
    value: pad(recase([locale, ...extra].join(separator))),
    names: locale,
  }))

/**
 * A well-formed tag whose primary subtag is unambiguously not a supported
 * Locale — including right-to-left languages the Web_Client does not ship, so a
 * script resemblance alone never counts as a match.
 */
const unsupportedTag: fc.Arbitrary<PreferenceEntry> = fc
  .record({
    language: fc.constantFrom('fr', 'de', 'es', 'ru', 'tr', 'zh', 'ja', 'ko', 'fa', 'ur', 'und'),
    extra: fc.array(subtags, { maxLength: 2 }),
    separator: separators,
    recase: recasings,
    pad: paddings,
  })
  .map(({ language, extra, separator, recase, pad }) => ({
    value: pad(recase([language, ...extra].join(separator))),
    names: null,
  }))

/** Malformed strings and non-string junk: an entry that names nothing at all. */
const junkEntry: fc.Arbitrary<PreferenceEntry> = fc
  .oneof<fc.Arbitrary<unknown>[]>(
    fc.constantFrom('', '   ', '-', '-ar', '_he', 'arabic', 'hebrew', 'english'),
    fc.constantFrom(null, undefined, true, 42, Number.NaN),
    fc.constantFrom({ language: 'ar' }, ['he'], () => 'en'),
  )
  .map((value) => ({ value, names: null }))

const preferenceEntry: fc.Arbitrary<PreferenceEntry> = fc.oneof(
  { arbitrary: exactSupported, weight: 3 },
  { arbitrary: variantSupported, weight: 3 },
  { arbitrary: unsupportedTag, weight: 3 },
  { arbitrary: junkEntry, weight: 2 },
)

/** An ordered preference list, most preferred first; the empty list included. */
const preferenceList: fc.Arbitrary<readonly PreferenceEntry[]> = fc.array(preferenceEntry, {
  maxLength: 8,
})

describe('unauthenticated locale resolution properties', () => {
  // Feature: frontend-web-application, Property 9: Unauthenticated locale
  // resolution — For any ordered list of browser language preferences, the
  // resolved active Locale is a supported Locale; it equals the first entry that
  // names a supported Locale when one is present, and is `en` otherwise.
  //
  // **Validates: Requirements 19.4**
  it('resolves to the first preference naming a supported locale, and to en otherwise', () => {
    fc.assert(
      fc.property(preferenceList, (entries) => {
        const resolved = resolveLocale(entries.map((entry) => entry.value))

        // The result is always a supported Locale, so a catalogue always exists.
        expect(SUPPORTED_LOCALES).toContain(resolved)

        const firstNamed = entries.find((entry) => entry.names !== null)?.names ?? null
        if (firstNamed === null) {
          // No entry names a supported Locale: `en`.
          expect(resolved).toBe(FALLBACK_LOCALE)
        } else {
          // Order is honoured: the most preferred naming entry wins.
          expect(resolved).toBe(firstNamed)
        }
      }),
      { numRuns: 300 },
    )
  })
})
