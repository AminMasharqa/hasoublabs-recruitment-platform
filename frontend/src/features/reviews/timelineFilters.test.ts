/**
 * Unit tests for the Review_Timeline filter and cursor round trip (task 21.1).
 *
 * Requirement 15:
 * - AC8 each applied filter — reviewer, Job_Description, lower creation bound,
 *   upper creation bound — is sent as a query parameter, and the address is the
 *   applied set.
 * - AC9 the Senior own-timeline query carries no filter, because the endpoint
 *   declares none.
 * - AC11 the page is bounded at twenty rows and the next request carries the last
 *   returned `seq`.
 */

import { describe, expect, it } from 'vitest'

import { REVIEW_PAGE_SIZE } from './reviewRules'
import {
  EMPTY_TIMELINE_FILTERS,
  endOfDayUtc,
  hasActiveTimelineFilters,
  ownTimelineQueryParams,
  readTimelineCursor,
  readTimelineFilters,
  startOfDayUtc,
  TIMELINE_PARAM,
  timelineQueryParams,
  writeTimelineCursor,
  writeTimelineFilters,
  type TimelineFilters,
} from './timelineFilters'

function params(query: string): URLSearchParams {
  return new URLSearchParams(query)
}

// ── AC8: reading the applied set out of the address ───────────────────────────

describe('reading the applied filters (Req 15 AC8)', () => {
  it('reads every filter the address carries', () => {
    expect(
      readTimelineFilters(
        params('reviewer_id=rev-1&jd_id=jd-2&date_from=2025-01-01&date_to=2025-03-31'),
      ),
    ).toEqual({
      reviewerId: 'rev-1',
      jdId: 'jd-2',
      dateFrom: '2025-01-01',
      dateTo: '2025-03-31',
    })
  })

  it('reads no filter from an empty address', () => {
    expect(readTimelineFilters(params(''))).toEqual(EMPTY_TIMELINE_FILTERS)
  })

  it('drops a bound that is not a calendar day rather than forwarding it', () => {
    expect(readTimelineFilters(params('date_from=yesterday&date_to=2025-3-1'))).toEqual(
      EMPTY_TIMELINE_FILTERS,
    )
  })

  it('trims the identifier filters', () => {
    expect(readTimelineFilters(params('reviewer_id=%20rev-1%20')).reviewerId).toBe('rev-1')
  })
})

// ── AC8: writing the applied set back ─────────────────────────────────────────

describe('writing the applied filters (Req 15 AC8)', () => {
  const applied: TimelineFilters = {
    reviewerId: 'rev-1',
    jdId: 'jd-2',
    dateFrom: '2025-01-01',
    dateTo: '2025-03-31',
  }

  it('round-trips a filter set through the address', () => {
    expect(readTimelineFilters(writeTimelineFilters(applied))).toEqual(applied)
  })

  it('omits every blank filter', () => {
    expect(writeTimelineFilters(EMPTY_TIMELINE_FILTERS).toString()).toBe('')
  })

  it('writes no cursor, so applying a filter starts a new keyset walk', () => {
    expect(writeTimelineFilters(applied).has(TIMELINE_PARAM.afterSeq)).toBe(false)
  })

  it('reports whether anything is filtered', () => {
    expect(hasActiveTimelineFilters(EMPTY_TIMELINE_FILTERS)).toBe(false)
    expect(hasActiveTimelineFilters({ ...EMPTY_TIMELINE_FILTERS, jdId: 'jd-2' })).toBe(true)
    expect(hasActiveTimelineFilters({ ...EMPTY_TIMELINE_FILTERS, dateTo: '2025-01-01' })).toBe(true)
  })
})

// ── AC11: the keyset cursor ───────────────────────────────────────────────────

describe('the keyset cursor (Req 15 AC11)', () => {
  it('reads a seq cursor with its identifier complement', () => {
    expect(readTimelineCursor(params('after_seq=20&after_id=r20'))).toEqual({
      afterSeq: 20,
      afterId: 'r20',
    })
  })

  it('reads a seq cursor without a complement', () => {
    expect(readTimelineCursor(params('after_seq=7'))).toEqual({ afterSeq: 7, afterId: null })
  })

  it('reads no cursor from a complement alone or a non-numeric seq', () => {
    expect(readTimelineCursor(params('after_id=r20'))).toBeNull()
    expect(readTimelineCursor(params('after_seq=abc'))).toBeNull()
    expect(readTimelineCursor(params(''))).toBeNull()
  })

  it('round-trips a cursor alongside the applied filters', () => {
    const applied: TimelineFilters = {
      ...EMPTY_TIMELINE_FILTERS,
      reviewerId: 'rev-1',
    }
    const address = writeTimelineCursor(applied, { afterSeq: 20, afterId: 'r20' })

    expect(readTimelineFilters(address)).toEqual(applied)
    expect(readTimelineCursor(address)).toEqual({ afterSeq: 20, afterId: 'r20' })
  })
})

// ── AC8, AC11: the request query ──────────────────────────────────────────────

describe('the Admin timeline query (Req 15 AC8, AC11)', () => {
  it('bounds the page at twenty rows and sends nothing else when unfiltered', () => {
    expect(timelineQueryParams(EMPTY_TIMELINE_FILTERS)).toEqual({ limit: REVIEW_PAGE_SIZE })
    expect(REVIEW_PAGE_SIZE).toBe(20)
  })

  it('sends every applied filter as a query parameter', () => {
    expect(
      timelineQueryParams({
        reviewerId: 'rev-1',
        jdId: 'jd-2',
        dateFrom: '2025-01-01',
        dateTo: '2025-03-31',
      }),
    ).toEqual({
      limit: REVIEW_PAGE_SIZE,
      reviewer_id: 'rev-1',
      jd_id: 'jd-2',
      date_from: '2025-01-01T00:00:00.000Z',
      date_to: '2025-03-31T23:59:59.999Z',
    })
  })

  it('expands each calendar day into an inclusive UTC instant', () => {
    expect(startOfDayUtc('2025-02-09')).toBe('2025-02-09T00:00:00.000Z')
    expect(endOfDayUtc('2025-02-09')).toBe('2025-02-09T23:59:59.999Z')
    expect(startOfDayUtc('')).toBeNull()
    expect(endOfDayUtc('nonsense')).toBeNull()
  })

  it('sends the cursor pair when a cursor is held', () => {
    expect(timelineQueryParams(EMPTY_TIMELINE_FILTERS, { afterSeq: 20, afterId: 'r20' })).toEqual({
      limit: REVIEW_PAGE_SIZE,
      after_seq: 20,
      after_id: 'r20',
    })
  })

  it('sends the seq alone when no complement is held', () => {
    expect(timelineQueryParams(EMPTY_TIMELINE_FILTERS, { afterSeq: 20, afterId: null })).toEqual({
      limit: REVIEW_PAGE_SIZE,
      after_seq: 20,
    })
  })
})

describe('the Senior own-timeline query (Req 15 AC9, AC11)', () => {
  it('carries only the page size and the seq cursor the endpoint declares', () => {
    expect(ownTimelineQueryParams()).toEqual({ limit: REVIEW_PAGE_SIZE })
    expect(ownTimelineQueryParams({ afterSeq: 20, afterId: 'r20' })).toEqual({
      limit: REVIEW_PAGE_SIZE,
      after_seq: 20,
    })
  })
})
