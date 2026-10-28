/**
 * Bidi-safe text passthrough and Locale-aware date/number formatting.
 *
 * Requirement 19:
 * - AC10 Arabic and Hebrew content retrieved from the Backend_Api is rendered
 *   byte-identically to the retrieved value ({@link textForDisplay}).
 * - AC11 Arabic and Hebrew text entered by a user is submitted byte-identically
 *   to the entered value ({@link textForSubmission}).
 * - AC12 dates, times and numbers use the conventions of the active Locale while
 *   UTC remains the authoritative value for every Backend_Api timestamp
 *   ({@link formatDateTime}, {@link formatNumber}, {@link utcTimestamp}).
 *
 * Every function here is pure and free of React, so Property 11 can target the
 * passthrough pair directly.
 *
 * ## Why a passthrough function at all
 *
 * The byte-identical guarantee is a guarantee about what the Web_Client does
 * *not* do. A string in JavaScript is a sequence of UTF-16 code units and React
 * renders a text child verbatim, so the risk is never the rendering itself — it
 * is the "helpful" transformation someone reaches for on the way: `trim()`,
 * `normalize('NFC')`, a locale-aware `toLowerCase()`, a `replace` that strips
 * "invisible" characters, or a display-only reordering of a bidirectional run.
 * Any of those silently rewrites stored Arabic or Hebrew content.
 *
 * {@link textForDisplay} and {@link textForSubmission} are therefore the named,
 * tested seam every feature slice routes Backend_Api text and user-entered text
 * through: a single place that is documented and property-tested as
 * transformation-free, and a single place a reviewer can point at when a
 * transformation is proposed. Visual bidi isolation — the one part of "do not
 * reorder" that is a rendering concern — is applied with the `dir="auto"` plus
 * `unicode-bidi: isolate` convention of `BidiText` in `DirectionProvider.tsx`,
 * which changes how the surrounding run is laid out without touching a
 * character.
 */

import type { Locale } from '../lib/locale'

/**
 * Text as it is rendered, byte-identical to the value received (AC10).
 *
 * Applies no transliteration, no Unicode normalization, no character
 * substitution, no case mapping, no trimming and no reordering. `null` and
 * `undefined` — an absent Backend_Api member — render as the empty string; every
 * string is returned unchanged, including one that is empty, is whitespace only,
 * or carries combining marks, bidirectional controls or astral code points.
 */
export function textForDisplay(value: string | null | undefined): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Text as it is submitted, byte-identical to the value entered (AC11).
 *
 * The counterpart of {@link textForDisplay}: what a control displays is read
 * back for submission unchanged, so `textForSubmission(textForDisplay(s))`
 * equals `s` for every string `s` (Property 11).
 */
export function textForSubmission(value: string | null | undefined): string {
  return typeof value === 'string' ? value : ''
}

/** Encodes a string to its UTF-8 bytes, for a byte-level comparison. */
export function toUtf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

/**
 * Reports whether two strings are identical byte for byte in UTF-8.
 *
 * JavaScript string equality already compares UTF-16 code units exactly, so this
 * only restates that in the terms Requirement 19 AC10 and AC11 use — and it
 * catches the case where one side has been normalized into a canonically
 * equivalent but differently encoded form.
 */
export function isByteIdentical(left: string, right: string): boolean {
  const a = toUtf8Bytes(left)
  const b = toUtf8Bytes(right)
  if (a.length !== b.length) {
    return false
  }
  return a.every((byte, index) => byte === b[index])
}

/** The authoritative time zone for every Backend_Api timestamp (AC12). */
export const UTC_TIME_ZONE = 'UTC'

/** Rendered for a value that names no instant or no finite number. */
export const EMPTY_FORMATTED_VALUE = ''

/**
 * The BCP 47 tag an `Intl` formatter is constructed with for a Locale.
 *
 * The supported Locales are already well-formed language tags, so the mapping is
 * the identity; it exists so a future region-specific tag is changed in one
 * place.
 */
export function localeTag(locale: Locale): string {
  return locale
}

/**
 * Parses a Backend_Api timestamp into the instant it denotes, or `null`.
 *
 * Accepts an ISO-8601 string, epoch milliseconds or a `Date`. The result is an
 * absolute instant — the authoritative UTC value — independent of the host time
 * zone; rendering decides which zone it is *presented* in.
 */
export function parseInstant(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined) {
    return null
  }
  const instant = value instanceof Date ? value : new Date(value)
  return Number.isNaN(instant.getTime()) ? null : instant
}

/**
 * The canonical authoritative form of an instant: ISO-8601 UTC with
 * milliseconds.
 *
 * Locale-independent by design. Surfaces that must show the authoritative value
 * beside its localized equivalent — the Audit_Log_Viewer (Requirement 17 AC9) —
 * render this.
 */
export function utcTimestamp(value: Date | string | number | null | undefined): string {
  return parseInstant(value)?.toISOString() ?? EMPTY_FORMATTED_VALUE
}

/** Formatter options, minus the time zone this module owns a default for. */
export type DateFormatOptions = Omit<Intl.DateTimeFormatOptions, 'timeZone'> & {
  /** Presentation zone. Defaults to {@link UTC_TIME_ZONE}, the stored value. */
  readonly timeZone?: string
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>()
const numberFormatters = new Map<string, Intl.NumberFormat>()

function cacheKey(tag: string, options: object): string {
  return `${tag}\u0000${JSON.stringify(options, Object.keys(options).sort())}`
}

/** A cached `Intl.DateTimeFormat` for a Locale, defaulting to UTC (AC12). */
export function dateFormatter(locale: Locale, options: DateFormatOptions = {}): Intl.DateTimeFormat {
  const resolved: Intl.DateTimeFormatOptions = { timeZone: UTC_TIME_ZONE, ...options }
  const tag = localeTag(locale)
  const key = cacheKey(tag, resolved)
  const cached = dateFormatters.get(key)
  if (cached !== undefined) {
    return cached
  }
  const formatter = new Intl.DateTimeFormat(tag, resolved)
  dateFormatters.set(key, formatter)
  return formatter
}

/** A cached `Intl.NumberFormat` for a Locale. */
export function numberFormatter(
  locale: Locale,
  options: Intl.NumberFormatOptions = {},
): Intl.NumberFormat {
  const tag = localeTag(locale)
  const key = cacheKey(tag, options)
  const cached = numberFormatters.get(key)
  if (cached !== undefined) {
    return cached
  }
  const formatter = new Intl.NumberFormat(tag, options)
  numberFormatters.set(key, formatter)
  return formatter
}

/**
 * Formats the date part of an instant per the active Locale, in UTC by default.
 *
 * An unparsable or absent value renders as {@link EMPTY_FORMATTED_VALUE} rather
 * than as `Invalid Date`.
 */
export function formatDate(
  value: Date | string | number | null | undefined,
  locale: Locale,
  options: DateFormatOptions = {},
): string {
  const instant = parseInstant(value)
  if (instant === null) {
    return EMPTY_FORMATTED_VALUE
  }
  return dateFormatter(locale, { dateStyle: 'medium', ...options }).format(instant)
}

/** Formats the time part of an instant per the active Locale, in UTC by default. */
export function formatTime(
  value: Date | string | number | null | undefined,
  locale: Locale,
  options: DateFormatOptions = {},
): string {
  const instant = parseInstant(value)
  if (instant === null) {
    return EMPTY_FORMATTED_VALUE
  }
  return dateFormatter(locale, { timeStyle: 'short', ...options }).format(instant)
}

/** Formats a full timestamp per the active Locale, in UTC by default (AC12). */
export function formatDateTime(
  value: Date | string | number | null | undefined,
  locale: Locale,
  options: DateFormatOptions = {},
): string {
  const instant = parseInstant(value)
  if (instant === null) {
    return EMPTY_FORMATTED_VALUE
  }
  return dateFormatter(locale, { dateStyle: 'medium', timeStyle: 'short', ...options }).format(
    instant,
  )
}

/**
 * Formats a number per the active Locale (AC12).
 *
 * A non-finite value renders as {@link EMPTY_FORMATTED_VALUE}: `NaN` and
 * `Infinity` are defects in the caller, not values to show a user.
 */
export function formatNumber(
  value: number | null | undefined,
  locale: Locale,
  options: Intl.NumberFormatOptions = {},
): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return EMPTY_FORMATTED_VALUE
  }
  return numberFormatter(locale, options).format(value)
}

/** Formats a fraction of one as a Locale-appropriate percentage (AC12). */
export function formatPercent(
  value: number | null | undefined,
  locale: Locale,
  options: Intl.NumberFormatOptions = {},
): string {
  return formatNumber(value, locale, { style: 'percent', maximumFractionDigits: 0, ...options })
}
