/**
 * Layout-direction resolution for the Web_Client (pure logic, no React).
 *
 * Requirement 19 AC6/AC7: the direction is `rtl` when the active Locale is `ar`
 * or `he`, and `ltr` when it is `en`. The Direction_Provider (task 6.5) applies
 * this value to `document.documentElement.dir` and to Mantine; this module only
 * decides it.
 */

import { localeFromLanguageTag, type Locale } from './locale'

/** The two layout directions the Web_Client supports. */
export type Direction = 'rtl' | 'ltr'

/** The Locales written right-to-left. */
export const RTL_LOCALES = ['ar', 'he'] as const satisfies readonly Locale[]

/** The direction used for any Locale that is not right-to-left. */
export const DEFAULT_DIRECTION: Direction = 'ltr'

/** Reports whether a Locale is written right-to-left. */
export function isRtlLocale(locale: Locale): boolean {
  return (RTL_LOCALES as readonly string[]).includes(locale)
}

/**
 * Resolves the layout direction of an active Locale.
 *
 * Returns `rtl` if and only if the Locale is `ar` or `he`; otherwise `ltr`.
 */
export function resolveDirection(locale: Locale): Direction {
  return isRtlLocale(locale) ? 'rtl' : DEFAULT_DIRECTION
}

/**
 * Resolves the layout direction of an arbitrary language tag.
 *
 * Unrecognized tags resolve to {@link DEFAULT_DIRECTION}, matching the fallback
 * Locale `en`.
 */
export function resolveDirectionForLanguageTag(tag: unknown): Direction {
  const locale = localeFromLanguageTag(tag)
  return locale === null ? DEFAULT_DIRECTION : resolveDirection(locale)
}
