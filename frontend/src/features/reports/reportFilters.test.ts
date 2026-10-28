/**
 * Unit tests for the report filter round trip (task 24.1).
 *
 * Requirement 18:
 * - AC2 the date range and the Job_Description are read from and written to the
 *   address, and each applied value becomes a query parameter of the activity
 *   report.
 * - AC4 at most 20 candidate-progress rows are requested per page and the
 *   response's `next_cursor` is sent as `after_id`.
 * - AC6 the export request body carries the currently applied filters.
 */

import { describe, expect, it } from 'vitest'

import { DEFAULT_PAGE_SIZE } from '../../lib/cursor'

import {
  activityQueryParams,
  calendarDate,
  EMPTY_REPORT_FILTERS,
  exportRequestBody,
  hasActiveReportFilters,
  isReversedRange,
  nextProgressPage,
  progressQueryParams,
  readProgressCursor,
  readReportFilters,
  writeReportFilters,
} from './reportFilters'

const APPLIED = {
  dateFrom: '2024-04-01',
  dateTo: '2024-04-30',
  jdId: 'jd-7',
} as const

describe('reading the applied filters (Req 18 AC2)', () => {
  it('reads the date range and the Job_Description out of the query string', () => {
    const params = new URLSearchParams('date_from=2024-04-01&date_to=2024-04-30&jd_id=jd-7')
    expect(readReportFilters(params)).toEqual(APPLIED)
  })

  it('reads an absent filter as unapplied', () => {
    expect(readReportFilters(new URLSearchParams())).toEqual(EMPTY_REPORT_FILTERS)
  })

  it('drops a value that names no calendar date', () => {
    const params = new URLSearchParams('date_from=yesterday&date_to=2024-02-31')
    expect(readReportFilters(params)).toEqual(EMPTY_REPORT_FILTERS)
  })

  it('accepts a real date and refuses one that only looks like one', () => {
    expect(calendarDate('2024-02-29')).toBe('2024-02-29')
    expect(calendarDate('2023-02-29')).toBe('')
    expect(calendarDate('2024-13-01')).toBe('')
    expect(calendarDate(null)).toBe('')
  })
})

describe('writing the applied filters back (Req 18 AC2)', () => {
  it('round-trips an applied set through the address', () => {
    expect(readReportFilters(writeReportFilters(APPLIED))).toEqual(APPLIED)
  })

  it('omits an unapplied filter rather than writing it empty', () => {
    expect(writeReportFilters(EMPTY_REPORT_FILTERS).toString()).toBe('')
  })

  it('reports whether any filter is applied', () => {
    expect(hasActiveReportFilters(EMPTY_REPORT_FILTERS)).toBe(false)
    expect(hasActiveReportFilters({ ...EMPTY_REPORT_FILTERS, jdId: 'jd-1' })).toBe(true)
  })

  it('reports a range that runs backwards without correcting it', () => {
    expect(isReversedRange(APPLIED)).toBe(false)
    expect(isReversedRange({ ...APPLIED, dateFrom: '2024-05-01' })).toBe(true)
    expect(isReversedRange({ ...EMPTY_REPORT_FILTERS, dateFrom: '2024-05-01' })).toBe(false)
  })
})

describe('the activity report query (Req 18 AC1, AC2)', () => {
  it('sends each applied value, bounding whole days in UTC', () => {
    expect(activityQueryParams(APPLIED)).toEqual({
      date_from: '2024-04-01T00:00:00.000Z',
      date_to: '2024-04-30T23:59:59.999Z',
      jd_id: 'jd-7',
    })
  })

  it('sends nothing for an unfiltered report', () => {
    expect(activityQueryParams(EMPTY_REPORT_FILTERS)).toEqual({})
  })
})

describe('the candidate-progress query (Req 18 AC3, AC4)', () => {
  it('requests at most 20 rows and no cursor on the first page', () => {
    expect(progressQueryParams()).toEqual({ limit: DEFAULT_PAGE_SIZE })
    expect(DEFAULT_PAGE_SIZE).toBe(20)
  })

  it('sends the advertised cursor as after_id', () => {
    expect(progressQueryParams('acc-20')).toEqual({ limit: DEFAULT_PAGE_SIZE, after_id: 'acc-20' })
  })

  it('derives the next page from has_next and next_cursor', () => {
    expect(nextProgressPage({ has_next: true, next_cursor: 'acc-20' })).toEqual({
      hasNextPage: true,
      nextCursor: 'acc-20',
    })
    expect(nextProgressPage({ has_next: false, next_cursor: 'acc-20' }).hasNextPage).toBe(false)
    // A claimed further page with no usable token leaves no request to form.
    expect(nextProgressPage({ has_next: true, next_cursor: null }).hasNextPage).toBe(false)
    expect(nextProgressPage(undefined).hasNextPage).toBe(false)
  })

  it('reads the cursor the address carries', () => {
    expect(readProgressCursor(new URLSearchParams('after_id=acc-20'))).toBe('acc-20')
    expect(readProgressCursor(new URLSearchParams())).toBeNull()
  })
})

describe('the export request body (Req 18 AC6)', () => {
  it('carries the same bounds the activity report is read with', () => {
    expect(exportRequestBody(APPLIED)).toEqual(activityQueryParams(APPLIED))
  })

  it('carries nothing when no filter is applied', () => {
    expect(exportRequestBody(EMPTY_REPORT_FILTERS)).toEqual({})
  })
})
