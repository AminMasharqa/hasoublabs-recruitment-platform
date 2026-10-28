import { describe, expect, it } from 'vitest'

// Read as text rather than imported as a module: the assertion below is about
// which message keys the Form_Validator source mentions, not about its exports.
import validatorsSource from '../forms/validators.ts?raw'

import {
  UNEXPECTED_RESPONSE_ERROR,
  UNKNOWN_VIOLATION_CODE,
  VALIDATION_ERROR_KEYS,
} from '../api/errors'
import { FALLBACK_LOCALE, SUPPORTED_LOCALES, type Locale } from '../lib/locale'
import {
  activeLocale,
  applySessionLocale,
  createI18n,
  DEFAULT_NAMESPACE,
  ERROR_FALLBACK_KEY,
  ERROR_NAMESPACE,
  FIELD_VIOLATION_KEY_PREFIX,
  I18N_NAMESPACES,
  resolveInitialLocale,
  RESOURCES,
  setActiveLocale,
  type I18nNamespace,
} from './index'

/** Flattens a catalogue into `dotted.key -> entry` pairs. */
function flatten(value: unknown, prefix = '', into = new Map<string, string>()): Map<string, string> {
  if (typeof value === 'string') {
    into.set(prefix, value)
    return into
  }
  if (typeof value === 'object' && value !== null) {
    for (const [member, nested] of Object.entries(value)) {
      flatten(nested, prefix === '' ? member : `${prefix}.${member}`, into)
    }
  }
  return into
}

function catalogue(locale: Locale, namespace: I18nNamespace): Map<string, string> {
  return flatten(RESOURCES[locale][namespace])
}

/** The `{{param}}` placeholders a catalogue entry interpolates. */
function placeholders(entry: string): string[] {
  return [...entry.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)]
    .map((match) => match[1] ?? '')
    .sort()
}

/**
 * Keys whose entry is intentionally identical across the three catalogues: the
 * Locale control names each language in that language, so the `en` and the `ar`
 * catalogue both spell Arabic `العربية`.
 */
const LOCALE_INDEPENDENT_KEYS = new Set(
  SUPPORTED_LOCALES.map((locale) => `shell:locale.${locale}`),
)

describe('catalogue key-set parity (Requirement 19 AC1)', () => {
  it('declares the same namespaces for every supported Locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(RESOURCES[locale]).sort()).toEqual([...I18N_NAMESPACES].sort())
    }
  })

  for (const namespace of I18N_NAMESPACES) {
    it(`holds an identical key set in ar/he/en for the ${namespace} namespace`, () => {
      const reference = [...catalogue(FALLBACK_LOCALE, namespace).keys()].sort()
      expect(reference.length).toBeGreaterThan(0)
      for (const locale of SUPPORTED_LOCALES) {
        expect([...catalogue(locale, namespace).keys()].sort()).toEqual(reference)
      }
    })

    it(`interpolates the same placeholders in ar/he/en for the ${namespace} namespace`, () => {
      const reference = catalogue(FALLBACK_LOCALE, namespace)
      for (const locale of SUPPORTED_LOCALES) {
        for (const [key, entry] of catalogue(locale, namespace)) {
          expect(placeholders(entry), `${locale}:${namespace}:${key}`).toEqual(
            placeholders(reference.get(key) ?? ''),
          )
        }
      }
    })

    it(`carries a non-blank entry for every ${namespace} key`, () => {
      for (const locale of SUPPORTED_LOCALES) {
        for (const [key, entry] of catalogue(locale, namespace)) {
          expect(entry.trim(), `${locale}:${namespace}:${key}`).not.toBe('')
        }
      }
    })

    it(`translates rather than copies the English ${namespace} entries into ar and he`, () => {
      const reference = catalogue(FALLBACK_LOCALE, namespace)
      for (const locale of ['ar', 'he'] as const) {
        for (const [key, entry] of catalogue(locale, namespace)) {
          if (LOCALE_INDEPENDENT_KEYS.has(`${namespace}:${key}`)) {
            continue
          }
          expect(entry, `${locale}:${namespace}:${key}`).not.toBe(reference.get(key))
        }
      }
    })
  }
})

describe('validation catalogue coverage (Requirement 19 AC1, AC2)', () => {
  /**
   * Reads the `validation.*` message keys straight out of the Form_Validator
   * source, so a rule added there without a catalogue entry fails here.
   */
  const emittedMessageKeys = (): string[] => {
    const keys = new Set<string>()
    for (const match of validatorsSource.matchAll(/'validation\.([A-Za-z0-9_]+)'/g)) {
      keys.add(match[1] ?? '')
    }
    return [...keys].sort()
  }

  it('finds the message keys the Form_Validator emits', () => {
    const keys = emittedMessageKeys()
    // Sanity check on the extraction itself before it is used as the expectation.
    expect(keys).toContain('required')
    expect(keys).toContain('passwordTooShort')
    expect(keys).toContain('dateRangeOrder')
    expect(keys.length).toBeGreaterThan(10)
  })

  it('resolves every emitted message key in all three Locales', () => {
    const keys = emittedMessageKeys()
    for (const locale of SUPPORTED_LOCALES) {
      const entries = catalogue(locale, 'validation')
      for (const key of keys) {
        expect(entries.get(key), `${locale}:validation:${key}`).toEqual(expect.any(String))
      }
    }
  })

  it('carries no validation entry the Form_Validator never emits', () => {
    const emitted = new Set(emittedMessageKeys())
    for (const key of catalogue(FALLBACK_LOCALE, 'validation').keys()) {
      expect(emitted.has(key), `validation:${key} is unused`).toBe(true)
    }
  })
})

describe('errors catalogue coverage (Requirement 21 AC1, AC2)', () => {
  it('resolves the error keys the Api_Client synthesizes and classifies', () => {
    const keys = [UNEXPECTED_RESPONSE_ERROR, ...VALIDATION_ERROR_KEYS, 'request_timeout']
    for (const locale of SUPPORTED_LOCALES) {
      const entries = catalogue(locale, ERROR_NAMESPACE)
      for (const key of keys) {
        expect(entries.get(key), `${locale}:errors:${key}`).toEqual(expect.any(String))
      }
    }
  })

  it('provides the generic fallback entry for an unrecognized error key', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(catalogue(locale, ERROR_NAMESPACE).get(ERROR_FALLBACK_KEY)).toEqual(expect.any(String))
    }
  })

  it('resolves the Field_Violation code used when a violation names none', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(
        catalogue(locale, ERROR_NAMESPACE).get(
          `${FIELD_VIOLATION_KEY_PREFIX}.${UNKNOWN_VIOLATION_CODE}`,
        ),
      ).toEqual(expect.any(String))
    }
  })
})

describe('createI18n', () => {
  it('initializes with the requested Locale and the baseline namespaces', () => {
    const instance = createI18n('he')
    expect(instance.isInitialized).toBe(true)
    expect(activeLocale(instance)).toBe('he')
    expect(instance.options.defaultNS).toBe(DEFAULT_NAMESPACE)
    expect(instance.t('errors:not_authorized')).toBe(RESOURCES.he.errors.not_authorized)
  })

  it('resolves a regional tag onto its language catalogue', () => {
    const instance = createI18n()
    return instance.changeLanguage('ar-SA').then(() => {
      expect(activeLocale(instance)).toBe('ar')
      expect(instance.t('shell:action.save')).toBe(RESOURCES.ar.shell.action.save)
    })
  })

  it('falls back to English for an entry a Locale is missing', () => {
    const instance = createI18n('ar')
    expect(instance.options.fallbackLng).toEqual([FALLBACK_LOCALE])
  })

  it('interpolates parameters without escaping, so Arabic values pass through unchanged', () => {
    const instance = createI18n('ar')
    const destination = 'الوظائف & "المفضّلة" <الجديدة>'
    expect(instance.t('shell:state.empty', { destination })).toContain(destination)
  })
})

describe('resolveInitialLocale (Requirement 19 AC4)', () => {
  it('takes the first browser preference that names a supported Locale', () => {
    expect(resolveInitialLocale({ language: 'fr-FR', languages: ['fr-FR', 'he-IL', 'en-GB'] })).toBe(
      'he',
    )
  })

  it('falls back to en when no preference names a supported Locale', () => {
    expect(resolveInitialLocale({ language: 'fr-FR', languages: ['fr-FR', 'de'] })).toBe('en')
    expect(resolveInitialLocale({ language: '', languages: [] })).toBe('en')
  })
})

describe('setActiveLocale (Requirement 19 AC5)', () => {
  it('switches the active Locale in place', async () => {
    const instance = createI18n('en')
    await expect(setActiveLocale('ar', instance)).resolves.toBe('ar')
    expect(activeLocale(instance)).toBe('ar')
    expect(instance.t('shell:action.cancel')).toBe(RESOURCES.ar.shell.action.cancel)
  })

  it('falls back to en for a value that names no supported Locale', async () => {
    const instance = createI18n('ar')
    await expect(setActiveLocale('fr', instance)).resolves.toBe('en')
    expect(activeLocale(instance)).toBe('en')
  })
})

describe('applySessionLocale (Requirement 19 AC3)', () => {
  it('uses the account language_preference', async () => {
    const instance = createI18n('en')
    await expect(
      applySessionLocale('he', {
        instance,
        navigatorLike: { language: 'ar', languages: ['ar'] },
      }),
    ).resolves.toBe('he')
    expect(activeLocale(instance)).toBe('he')
  })

  it('falls back to the browser preference when the account carries none', async () => {
    const instance = createI18n('en')
    await expect(
      applySessionLocale(null, {
        instance,
        navigatorLike: { language: 'ar-SA', languages: ['ar-SA'] },
      }),
    ).resolves.toBe('ar')
    expect(activeLocale(instance)).toBe('ar')
  })

  it('falls back to en when neither the account nor the browser names a Locale', async () => {
    const instance = createI18n('ar')
    await expect(
      applySessionLocale(undefined, {
        instance,
        navigatorLike: { language: 'fr-FR', languages: ['fr-FR'] },
      }),
    ).resolves.toBe('en')
  })
})
