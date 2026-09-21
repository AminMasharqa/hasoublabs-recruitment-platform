import { describe, expect, it } from 'vitest'

import {
  browserLanguagePreferences,
  FALLBACK_LOCALE,
  isLocale,
  localeFromLanguageTag,
  resolveLocale,
  resolveLocaleForSession,
  SUPPORTED_LOCALES,
} from './locale'

describe('isLocale', () => {
  it('accepts exactly the supported locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(isLocale(locale)).toBe(true)
    }
    expect(isLocale('ar-SA')).toBe(false)
    expect(isLocale('fr')).toBe(false)
    expect(isLocale('')).toBe(false)
    expect(isLocale(undefined)).toBe(false)
    expect(isLocale(null)).toBe(false)
    expect(isLocale(7)).toBe(false)
  })
})

describe('localeFromLanguageTag', () => {
  it('reads the primary subtag case-insensitively', () => {
    expect(localeFromLanguageTag('ar')).toBe('ar')
    expect(localeFromLanguageTag('ar-SA')).toBe('ar')
    expect(localeFromLanguageTag('he-IL')).toBe('he')
    expect(localeFromLanguageTag('he_IL')).toBe('he')
    expect(localeFromLanguageTag('EN-gb')).toBe('en')
    expect(localeFromLanguageTag('  en  ')).toBe('en')
  })

  it('returns null for unsupported or malformed tags', () => {
    expect(localeFromLanguageTag('fr-FR')).toBeNull()
    expect(localeFromLanguageTag('arabic')).toBeNull()
    expect(localeFromLanguageTag('')).toBeNull()
    expect(localeFromLanguageTag('-ar')).toBeNull()
    expect(localeFromLanguageTag(42)).toBeNull()
    expect(localeFromLanguageTag(null)).toBeNull()
  })
})

describe('resolveLocale', () => {
  it('returns the first preference that names a supported locale', () => {
    expect(resolveLocale(['he-IL', 'ar', 'en'])).toBe('he')
    expect(resolveLocale(['fr-FR', 'de', 'ar-SA', 'en-US'])).toBe('ar')
  })

  it('falls back to en when no preference names a supported locale', () => {
    expect(resolveLocale(['fr-FR', 'de-DE'])).toBe(FALLBACK_LOCALE)
    expect(resolveLocale([])).toBe(FALLBACK_LOCALE)
    expect(resolveLocale(undefined)).toBe(FALLBACK_LOCALE)
    expect(resolveLocale(null)).toBe(FALLBACK_LOCALE)
  })

  it('ignores non-string entries', () => {
    expect(resolveLocale([null, undefined, 3, { language: 'ar' }, 'he'])).toBe('he')
  })
})

describe('resolveLocaleForSession', () => {
  it('prefers the account language_preference', () => {
    expect(resolveLocaleForSession('ar', ['en-US'])).toBe('ar')
    expect(resolveLocaleForSession('he-IL', ['en-US'])).toBe('he')
  })

  it('falls back to the browser preferences then en', () => {
    expect(resolveLocaleForSession(null, ['fr', 'he'])).toBe('he')
    expect(resolveLocaleForSession('fr', ['de'])).toBe(FALLBACK_LOCALE)
    expect(resolveLocaleForSession(undefined)).toBe(FALLBACK_LOCALE)
  })
})

describe('browserLanguagePreferences', () => {
  it('prefers the ordered languages list', () => {
    expect(browserLanguagePreferences({ language: 'en-US', languages: ['he-IL', 'en-US'] })).toEqual(
      ['he-IL', 'en-US'],
    )
  })

  it('falls back to the single language and then to an empty list', () => {
    expect(
      browserLanguagePreferences({ language: 'ar-SA', languages: [] as unknown as string[] }),
    ).toEqual(['ar-SA'])
    expect(
      browserLanguagePreferences({ language: '', languages: [] as unknown as string[] }),
    ).toEqual([])
  })

  it('reads the ambient navigator when no argument is supplied', () => {
    expect(resolveLocale(browserLanguagePreferences())).toBe(
      resolveLocale(browserLanguagePreferences(navigator)),
    )
  })
})
