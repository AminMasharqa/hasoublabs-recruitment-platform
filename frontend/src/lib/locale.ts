/**
 * Locale resolution for the Web_Client (pure logic, no React and no i18next).
 *
 * Requirement 19 AC4: where no authenticated session exists, the active Locale
 * comes from the browser language preference when that preference names a
 * supported Locale, and is `en` otherwise.
 *
 * "Names a supported Locale" is interpreted against the BCP 47 primary language
 * subtag, case-insensitively: browsers report entries such as `he-IL` or `ar-SA`
 * in `navigator.languages`, and those name Hebrew and Arabic respectively.
 * Region, script and variant subtags are ignored because the Web_Client ships a
 * single catalogue per language.
 */

/** The three supported interface languages. `ar` and `he` are right-to-left. */
export type Locale = 'ar' | 'he' | 'en'

/** Every supported Locale, in catalogue order. */
export const SUPPORTED_LOCALES = ['ar', 'he', 'en'] as const satisfies readonly Locale[]

/** The Locale used when no browser preference names a supported Locale. */
export const FALLBACK_LOCALE: Locale = 'en'

/** Narrows an arbitrary value to a supported Locale. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/**
 * Extracts the supported Locale named by a single language tag, or `null`.
 *
 * Accepts full BCP 47 tags (`ar`, `ar-SA`, `he-IL`, `en-GB`) and tolerates the
 * underscore-separated form some platforms emit (`he_IL`). Matching is
 * case-insensitive and surrounding whitespace is ignored.
 */
export function localeFromLanguageTag(tag: unknown): Locale | null {
  if (typeof tag !== 'string') {
    return null
  }
  const primarySubtag = tag.trim().split(/[-_]/, 1)[0]?.toLowerCase() ?? ''
  return isLocale(primarySubtag) ? primarySubtag : null
}

/**
 * Resolves the unauthenticated active Locale from an ordered list of browser
 * language preferences (most preferred first).
 *
 * Returns the Locale named by the first entry that names a supported Locale, and
 * {@link FALLBACK_LOCALE} when no entry does. The result is always a supported
 * Locale, so callers never have to handle a missing catalogue.
 */
export function resolveLocale(preferences: readonly unknown[] | null | undefined): Locale {
  if (!preferences) {
    return FALLBACK_LOCALE
  }
  for (const preference of preferences) {
    const locale = localeFromLanguageTag(preference)
    if (locale !== null) {
      return locale
    }
  }
  return FALLBACK_LOCALE
}

/**
 * Resolves the Locale for an authenticated session.
 *
 * Requirement 19 AC3: the active Locale comes from the account's
 * `language_preference`. Falls back to the unauthenticated resolution when the
 * stored preference does not name a supported Locale.
 */
export function resolveLocaleForSession(
  languagePreference: unknown,
  browserPreferences: readonly unknown[] | null | undefined = [],
): Locale {
  return localeFromLanguageTag(languagePreference) ?? resolveLocale(browserPreferences)
}

/**
 * Reads the ordered browser language preferences from a Navigator-like object.
 *
 * `navigator.languages` is preferred; `navigator.language` is the single-entry
 * fallback for environments that do not expose the list.
 */
export function browserLanguagePreferences(
  navigatorLike: Pick<Navigator, 'language' | 'languages'> | undefined = typeof navigator ===
  'undefined'
    ? undefined
    : navigator,
): readonly string[] {
  const languages = navigatorLike?.languages
  if (Array.isArray(languages) && languages.length > 0) {
    return languages.filter((entry): entry is string => typeof entry === 'string')
  }
  const single = navigatorLike?.language
  return typeof single === 'string' && single.length > 0 ? [single] : []
}
