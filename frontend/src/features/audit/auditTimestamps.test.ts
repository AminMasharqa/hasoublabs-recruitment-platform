/**
 * Unit tests for the Audit_Log timestamp pair (Requirement 17 AC9).
 *
 * AC9 asks for two renderings of one instant: the authoritative UTC value with
 * millisecond precision, and the reader's local-time equivalent. These pin down
 * that the milliseconds survive both renderings and that the two never describe
 * different moments.
 */

import { describe, expect, it } from 'vitest'

import {
  auditLocalTimestamp,
  auditTimestampParts,
  auditUtcTimestamp,
  localTimeZone,
} from './auditTimestamps'

const INSTANT = '2024-04-02T09:30:15.472Z'

describe('the authoritative UTC rendering (AC9)', () => {
  it('renders ISO-8601 UTC with milliseconds', () => {
    expect(auditUtcTimestamp(INSTANT)).toBe('2024-04-02T09:30:15.472Z')
  })

  it('renders the same value whatever the Locale', () => {
    // Locale-independent by design: two people quoting it quote the same characters.
    expect(auditUtcTimestamp(new Date(INSTANT))).toBe(auditUtcTimestamp(INSTANT))
  })

  it('renders nothing for a value that names no instant', () => {
    expect(auditUtcTimestamp(null)).toBe('')
    expect(auditUtcTimestamp('not-a-timestamp')).toBe('')
  })
})

describe('the local-time equivalent (AC9)', () => {
  it('keeps millisecond precision', () => {
    expect(auditLocalTimestamp(INSTANT, 'en', 'UTC')).toContain('472')
  })

  it('renders the instant in the zone it is given', () => {
    const utc = auditLocalTimestamp(INSTANT, 'en', 'UTC')
    const kolkata = auditLocalTimestamp(INSTANT, 'en', 'Asia/Kolkata')

    expect(utc).not.toBe(kolkata)
    // 09:30:15.472Z is 15:00:15.472 in Asia/Kolkata (UTC+05:30), which `en`
    // renders on a 12-hour clock.
    expect(kolkata).toContain('03:00:15.472')
    expect(utc).toContain('09:30:15.472')
  })

  it('formats per the active Locale', () => {
    const en = auditLocalTimestamp(INSTANT, 'en', 'UTC')
    const ar = auditLocalTimestamp(INSTANT, 'ar', 'UTC')

    expect(en).not.toBe('')
    expect(ar).not.toBe('')
    expect(ar).not.toBe(en)
  })

  it('renders nothing for a value that names no instant', () => {
    expect(auditLocalTimestamp(undefined, 'en')).toBe('')
    expect(auditLocalTimestamp('', 'en')).toBe('')
  })
})

describe('both renderings together (AC9)', () => {
  it('produces the UTC value, the local value and the zone from one instant', () => {
    const parts = auditTimestampParts(INSTANT, 'en', 'UTC')

    expect(parts).toEqual({
      utc: '2024-04-02T09:30:15.472Z',
      local: auditLocalTimestamp(INSTANT, 'en', 'UTC'),
      timeZone: 'UTC',
    })
  })

  it('defaults to the zone the environment reports', () => {
    expect(auditTimestampParts(INSTANT, 'en').timeZone).toBe(localTimeZone())
    expect(localTimeZone()).not.toBe('')
  })
})
