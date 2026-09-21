import { describe, expect, it } from 'vitest'

import {
  DEFAULT_DIRECTION,
  isRtlLocale,
  resolveDirection,
  resolveDirectionForLanguageTag,
} from './direction'

describe('resolveDirection', () => {
  it('resolves rtl for ar and he', () => {
    expect(resolveDirection('ar')).toBe('rtl')
    expect(resolveDirection('he')).toBe('rtl')
  })

  it('resolves ltr for en', () => {
    expect(resolveDirection('en')).toBe('ltr')
    expect(DEFAULT_DIRECTION).toBe('ltr')
  })
})

describe('isRtlLocale', () => {
  it('holds for exactly ar and he', () => {
    expect(isRtlLocale('ar')).toBe(true)
    expect(isRtlLocale('he')).toBe(true)
    expect(isRtlLocale('en')).toBe(false)
  })
})

describe('resolveDirectionForLanguageTag', () => {
  it('resolves rtl for regional ar/he tags', () => {
    expect(resolveDirectionForLanguageTag('ar-SA')).toBe('rtl')
    expect(resolveDirectionForLanguageTag('he_IL')).toBe('rtl')
  })

  it('resolves ltr for en and for unrecognized tags', () => {
    expect(resolveDirectionForLanguageTag('en-GB')).toBe('ltr')
    expect(resolveDirectionForLanguageTag('fr-FR')).toBe('ltr')
    expect(resolveDirectionForLanguageTag('')).toBe('ltr')
    expect(resolveDirectionForLanguageTag(undefined)).toBe('ltr')
  })
})
