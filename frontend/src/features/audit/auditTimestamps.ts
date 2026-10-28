/**
 * Audit_Log timestamps: the authoritative UTC value with millisecond precision,
 * and the viewer's local-time equivalent beside it (Requirement 17 AC9).
 *
 * Pure: no React. Built on `i18n/formatting.ts`, which already owns
 * {@link import('../../i18n/formatting').utcTimestamp} — ISO-8601 UTC with
 * milliseconds — and the cached `Intl` formatters. What this module adds is the
 * *second* half of AC9: the same instant in the reader's own zone.
 *
 * ## Why the local equivalent names its zone explicitly
 *
 * The shared formatters default to UTC, which is right everywhere else in the
 * application: UTC is the authoritative value for every Backend_Api timestamp
 * (Req 19 AC12). AC9 is the one place that also needs the other rendering, so the
 * local zone is resolved once through `Intl` ({@link localTimeZone}) and passed in
 * explicitly. Passing it rather than omitting the option keeps the two renderings
 * distinct entries in the shared formatter cache, and keeps the zone *visible* —
 * the screen renders its name, so a reader can tell which zone "local" turned out
 * to be on the machine they are reading from.
 *
 * ## Why the local rendering uses explicit components
 *
 * `Intl.DateTimeFormat` refuses `fractionalSecondDigits` together with
 * `dateStyle`/`timeStyle`, and dropping the milliseconds from the local rendering
 * would make the two values on screen disagree about what they denote — two entries
 * 40 ms apart would read as the same instant locally and as different instants in
 * UTC. So the local form is spelled out component by component, to the same
 * millisecond precision AC9 requires of the UTC form.
 *
 * Requirements: 17.9, 19.12.
 */

import {
  dateFormatter,
  EMPTY_FORMATTED_VALUE,
  parseInstant,
  utcTimestamp,
  type DateFormatOptions,
} from '../../i18n/formatting'
import type { Locale } from '../../lib/locale'

/** A Backend_Api timestamp, in any of the forms `parseInstant` accepts. */
export type TimestampInput = Date | string | number | null | undefined

/**
 * Date and time components rendered to millisecond precision.
 *
 * Fixed-width fields rather than `dateStyle`/`timeStyle`, both because the
 * fractional seconds AC9 requires cannot be combined with those, and because a
 * column of audit timestamps is read by scanning it — which ragged-width values
 * defeat.
 */
export const MILLISECOND_FORMAT_OPTIONS: DateFormatOptions = Object.freeze({
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
})

/**
 * The reader's own time zone, as `Intl` resolves it.
 *
 * Falls back to `UTC` where the environment reports no zone, so the local
 * rendering degrades to a second UTC rendering rather than to `Invalid Date`.
 */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * The authoritative UTC form of an Audit_Log timestamp, with milliseconds (AC9).
 *
 * Locale-independent by design: this is the stored value, and it is rendered the
 * same way in `ar`, `he` and `en` so that two people quoting it to each other are
 * quoting the same characters.
 */
export function auditUtcTimestamp(value: TimestampInput): string {
  return utcTimestamp(value)
}

/**
 * The same instant in the reader's zone, in the active Locale's conventions
 * (AC9, Req 19 AC12).
 *
 * An unparsable or absent value renders as the empty string rather than as
 * `Invalid Date`.
 */
export function auditLocalTimestamp(
  value: TimestampInput,
  locale: Locale,
  timeZone: string = localTimeZone(),
): string {
  const instant = parseInstant(value)
  if (instant === null) {
    return EMPTY_FORMATTED_VALUE
  }
  return dateFormatter(locale, { ...MILLISECOND_FORMAT_OPTIONS, timeZone }).format(instant)
}

/** Both renderings of one Audit_Log timestamp (AC9). */
export interface AuditTimestampParts {
  /** ISO-8601 UTC with milliseconds — the authoritative value. */
  readonly utc: string
  /** The same instant in {@link AuditTimestampParts.timeZone}, localized. */
  readonly local: string
  /** The zone the local rendering used, so the screen can name it. */
  readonly timeZone: string
}

/**
 * The UTC value and its local equivalent, for one timestamp (AC9).
 *
 * Both are produced from one parse of one instant, so the two renderings on
 * screen cannot describe different moments.
 */
export function auditTimestampParts(
  value: TimestampInput,
  locale: Locale,
  timeZone: string = localTimeZone(),
): AuditTimestampParts {
  return {
    utc: auditUtcTimestamp(value),
    local: auditLocalTimestamp(value, locale, timeZone),
    timeZone,
  }
}
