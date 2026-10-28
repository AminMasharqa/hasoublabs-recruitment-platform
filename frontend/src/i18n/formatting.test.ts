import { describe, expect, it } from 'vitest'

import {
  EMPTY_FORMATTED_VALUE,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatTime,
  isByteIdentical,
  localeTag,
  parseInstant,
  textForDisplay,
  textForSubmission,
  toUtf8Bytes,
  utcTimestamp,
  UTC_TIME_ZONE,
} from './formatting'

/** Values a transformation would visibly damage (Requirement 19 AC10, AC11). */
const HOSTILE_VALUES = [
  'محمد عبد الله',
  'יוסף בן־דוד',
  // Combining marks that NFC would compose away.
  'مُحَمَّد',
  'שָׁלוֹם',
  'e\u0301', // decomposed é
  // Bidirectional controls: LRM, RLM, isolates and the deprecated embeddings.
  'a\u200eب\u200fc',
  '\u2066english\u2069 \u2067عربي\u2069',
  '\u202bנטוע\u202c',
  // Zero-width joiner/non-joiner, which Arabic shaping depends on.
  'بـ\u200cـت',
  // Astral code points (surrogate pairs).
  '𐎠𐎣 🇸🇦 👨‍👩‍👧',
  // Whitespace a trim would eat, and an empty string.
  '  مرحبا  ',
  '\t\n',
  '',
]

describe('textForDisplay (Requirement 19 AC10)', () => {
  it('returns every string unchanged', () => {
    for (const value of HOSTILE_VALUES) {
      expect(textForDisplay(value)).toBe(value)
      expect(isByteIdentical(textForDisplay(value), value)).toBe(true)
    }
  })

  it('does not normalize a decomposed sequence into its composed form', () => {
    const decomposed = 'e\u0301'
    expect(textForDisplay(decomposed)).not.toBe(decomposed.normalize('NFC'))
    expect(textForDisplay(decomposed)).toHaveLength(2)
  })

  it('renders an absent value as the empty string', () => {
    expect(textForDisplay(null)).toBe('')
    expect(textForDisplay(undefined)).toBe('')
  })
})

describe('textForSubmission (Requirement 19 AC11)', () => {
  it('round-trips every displayed value byte-identically', () => {
    for (const value of HOSTILE_VALUES) {
      expect(textForSubmission(textForDisplay(value))).toBe(value)
    }
  })
})

describe('isByteIdentical', () => {
  it('holds for equal strings and fails for canonically equivalent ones', () => {
    expect(isByteIdentical('عربي', 'عربي')).toBe(true)
    expect(isByteIdentical('e\u0301', '\u00e9')).toBe(false)
    expect(isByteIdentical('a', 'a\u200e')).toBe(false)
  })
})

describe('toUtf8Bytes', () => {
  it('encodes Arabic as its UTF-8 bytes', () => {
    expect([...toUtf8Bytes('ب')]).toEqual([0xd8, 0xa8])
    expect(toUtf8Bytes('').length).toBe(0)
  })
})

describe('parseInstant', () => {
  it('accepts ISO-8601 strings, epoch milliseconds and Dates', () => {
    const expected = Date.UTC(2024, 0, 1, 23, 30, 0)
    expect(parseInstant('2024-01-01T23:30:00Z')?.getTime()).toBe(expected)
    expect(parseInstant(expected)?.getTime()).toBe(expected)
    expect(parseInstant(new Date(expected))?.getTime()).toBe(expected)
  })

  it('returns null for an absent or unparsable value', () => {
    expect(parseInstant(null)).toBeNull()
    expect(parseInstant(undefined)).toBeNull()
    expect(parseInstant('not a timestamp')).toBeNull()
    expect(parseInstant(new Date('nope'))).toBeNull()
  })
})

describe('utcTimestamp (Requirement 19 AC12)', () => {
  it('renders the authoritative UTC value with milliseconds', () => {
    expect(utcTimestamp('2024-01-01T23:30:00Z')).toBe('2024-01-01T23:30:00.000Z')
  })

  it('is independent of the offset the value was expressed in', () => {
    expect(utcTimestamp('2024-01-02T01:30:00+02:00')).toBe(utcTimestamp('2024-01-01T23:30:00Z'))
  })

  it('renders an unparsable value as empty', () => {
    expect(utcTimestamp('nope')).toBe(EMPTY_FORMATTED_VALUE)
  })
})

describe('date formatting (Requirement 19 AC12)', () => {
  const lateEvening = '2024-01-01T23:30:00Z'

  it('treats UTC as authoritative regardless of the host time zone', () => {
    expect(formatDate(lateEvening, 'en')).toBe('Jan 1, 2024')
    expect(formatTime(lateEvening, 'en')).toContain('11:30')
    expect(formatDateTime(lateEvening, 'en')).toContain('Jan 1, 2024')
  })

  it('resolves the UTC zone by default and honours an override', () => {
    const utcDay = formatDate(lateEvening, 'en')
    const tokyoDay = formatDate(lateEvening, 'en', { timeZone: 'Asia/Tokyo' })
    expect(utcDay).not.toBe(tokyoDay)
    expect(tokyoDay).toBe('Jan 2, 2024')
  })

  it('formats per the active Locale', () => {
    const en = formatDate(lateEvening, 'en')
    expect(formatDate(lateEvening, 'ar')).not.toBe(en)
    expect(formatDate(lateEvening, 'he')).not.toBe(en)
  })

  it('honours explicit field options', () => {
    expect(
      formatDate(lateEvening, 'en', { dateStyle: undefined, year: 'numeric', month: '2-digit', day: '2-digit' }),
    ).toBe('01/01/2024')
  })

  it('renders an absent or unparsable value as empty rather than Invalid Date', () => {
    expect(formatDate(null, 'en')).toBe(EMPTY_FORMATTED_VALUE)
    expect(formatDateTime('nope', 'he')).toBe(EMPTY_FORMATTED_VALUE)
    expect(formatTime(undefined, 'ar')).toBe(EMPTY_FORMATTED_VALUE)
  })

  it('exposes UTC as the default zone', () => {
    expect(UTC_TIME_ZONE).toBe('UTC')
  })
})

describe('number formatting (Requirement 19 AC12)', () => {
  it('groups and separates per the active Locale', () => {
    expect(formatNumber(1234.5, 'en')).toBe('1,234.5')
    expect(formatNumber(1234.5, 'en', { minimumFractionDigits: 2 })).toBe('1,234.50')
    expect(formatNumber(1234.5, 'ar')).toBe(new Intl.NumberFormat('ar').format(1234.5))
  })

  it('formats a fraction as a percentage', () => {
    expect(formatPercent(0.42, 'en')).toBe('42%')
  })

  it('renders a non-finite or absent value as empty', () => {
    expect(formatNumber(Number.NaN, 'en')).toBe(EMPTY_FORMATTED_VALUE)
    expect(formatNumber(Number.POSITIVE_INFINITY, 'en')).toBe(EMPTY_FORMATTED_VALUE)
    expect(formatNumber(null, 'en')).toBe(EMPTY_FORMATTED_VALUE)
  })
})

describe('localeTag', () => {
  it('maps every Locale onto a tag Intl accepts', () => {
    for (const locale of ['ar', 'he', 'en'] as const) {
      expect(Intl.DateTimeFormat.supportedLocalesOf([localeTag(locale)])).toEqual([locale])
    }
  })
})
