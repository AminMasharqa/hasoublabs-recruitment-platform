/**
 * Unit tests for the browse filter round trip (Requirement 12 AC1–AC5).
 *
 * The address bar is the applied filter set, so these cover the three directions
 * that matters in: reading a location, writing one back, and turning one into the
 * query of `GET /api/v1/jobs` — including the keyset cursor of AC4, which is a
 * token that has to be decoded into the two parameters the endpoint declares.
 */

import { describe, expect, it } from 'vitest'

import { DEFAULT_PAGE_SIZE } from '../../lib/cursor'

import {
  browseQueryParams,
  decodeBrowseCursor,
  EMPTY_BROWSE_FILTERS,
  hasActiveFilters,
  nextBrowsePage,
  readBrowseCursor,
  readBrowseFilters,
  writeBrowseFilters,
} from './browseFilters'

/** A `next_cursor` token as the Backend_Api issues it: base64url of the keyset. */
function tokenFor(payload: unknown): string {
  return btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe('reading the applied filters out of a location (AC1, AC2)', () => {
  it('reads every filter the requirement names', () => {
    const params = new URLSearchParams(
      'search=platform+engineer&location=Haifa&skills=s-1&skills=s-2&work_model=Hybrid&employment_type=Full-time&experience_level=Mid-level',
    )

    expect(readBrowseFilters(params)).toEqual({
      search: 'platform engineer',
      location: 'Haifa',
      skillIds: ['s-1', 's-2'],
      workModel: 'Hybrid',
      employmentType: 'Full-time',
      experienceLevel: 'Mid-level',
    })
  })

  it('drops a value the contract does not declare rather than forwarding it', () => {
    const params = new URLSearchParams('work_model=Underwater&experience_level=&skills=+&skills=s-1')

    expect(readBrowseFilters(params)).toEqual({
      ...EMPTY_BROWSE_FILTERS,
      skillIds: ['s-1'],
    })
  })

  it('reads the keyset cursor separately from the filters', () => {
    const params = new URLSearchParams('search=api&cursor=abc')

    expect(readBrowseCursor(params)).toBe('abc')
    expect(readBrowseFilters(params).search).toBe('api')
    expect(hasActiveFilters(readBrowseFilters(params))).toBe(true)
  })

  it('reports no active filter for an unfiltered location (AC5)', () => {
    expect(hasActiveFilters(readBrowseFilters(new URLSearchParams('cursor=abc')))).toBe(false)
  })
})

describe('writing the applied filters back into a location (AC2)', () => {
  it('round-trips a filter set and omits what is not applied', () => {
    const filters = {
      search: 'שרת',
      location: '',
      skillIds: ['s-1', 's-1', 's-2'],
      workModel: 'Remote',
      employmentType: null,
      experienceLevel: 'Lead',
    } as const

    const written = writeBrowseFilters(filters)

    expect(written.toString()).toBe(
      'search=%D7%A9%D7%A8%D7%AA&skills=s-1&skills=s-2&work_model=Remote&experience_level=Lead',
    )
    expect(readBrowseFilters(written)).toEqual({ ...filters, skillIds: ['s-1', 's-2'] })
  })

  it('never writes the cursor: a changed filter set starts a new keyset walk', () => {
    const written = writeBrowseFilters({ ...EMPTY_BROWSE_FILTERS, search: 'api' })

    expect(written.has('cursor')).toBe(false)
  })
})

describe('the request query of GET /jobs (AC2, AC3, AC4)', () => {
  it('requests at most 20 rows and sends only the applied filters', () => {
    const query = browseQueryParams({ ...EMPTY_BROWSE_FILTERS, location: 'Haifa' })

    expect(query).toEqual({ limit: DEFAULT_PAGE_SIZE, location: 'Haifa' })
    expect(DEFAULT_PAGE_SIZE).toBe(20)
  })

  it('carries the cursor token as the keyset pair the endpoint declares', () => {
    const cursor = tokenFor({ after_published_at: '2024-05-01T00:00:00Z', after_id: 'jd-9' })

    expect(browseQueryParams(EMPTY_BROWSE_FILTERS, cursor)).toEqual({
      limit: DEFAULT_PAGE_SIZE,
      after_published_at: '2024-05-01T00:00:00Z',
      after_id: 'jd-9',
    })
  })

  it('ignores a cursor that does not decode into a usable keyset pair', () => {
    expect(browseQueryParams(EMPTY_BROWSE_FILTERS, 'not-a-token')).toEqual({
      limit: DEFAULT_PAGE_SIZE,
    })
    expect(decodeBrowseCursor(tokenFor({ after_id: 'jd-9' }))).toBeNull()
  })
})

describe('the next page of a browse response (AC4)', () => {
  it('offers the advertised token when it decodes', () => {
    const cursor = tokenFor({ after_published_at: '2024-05-01T00:00:00Z', after_id: 'jd-9' })

    expect(nextBrowsePage({ has_next: true, next_cursor: cursor })).toEqual({
      hasNextPage: true,
      nextCursor: cursor,
    })
  })

  it('offers no next page when none is advertised or the token is unusable', () => {
    expect(nextBrowsePage({ has_next: false, next_cursor: 'abc' }).hasNextPage).toBe(false)
    expect(nextBrowsePage({ has_next: true, next_cursor: null }).hasNextPage).toBe(false)
    expect(nextBrowsePage({ has_next: true, next_cursor: 'abc' }).hasNextPage).toBe(false)
    expect(nextBrowsePage(null).hasNextPage).toBe(false)
  })
})
