/**
 * Unit tests for the Admin listing's filter round trip and its keyset cursor
 * (Requirement 13 AC17).
 *
 * The listing paginates on `after_id` while reporting `has_next` and always
 * answering `next_cursor: null`, so the cursor derivation is the one piece of paging
 * logic that cannot be borrowed from `lib/cursor.ts` — and therefore the one worth
 * pinning down here.
 */

import { describe, expect, it } from 'vitest'

import type { JdStatus } from '../../api/enums'

import {
  ADMIN_JOBS_PARAM,
  readAdminJobsCursor,
  readAdminJobStatus,
  writeAdminJobsParams,
} from './adminJobFilters'
import { adminJobsQuery, nextAdminJobsPage } from './authoringApi'
import type { JobBrowsePage, JobDescription } from './jobsApi'

function row(id: string): JobDescription {
  return {
    id,
    title: 'Role',
    company: 'Company',
    location: null,
    work_model: null,
    employment_type: null,
    experience_level: null,
    description: null,
    application_channel: null,
    external_url: null,
    required_skill_ids: [],
    status: 'Draft',
    creator_account_id: '9c1e8d7b-6a5f-4e3d-2f4a-1c8e6b3d4f5a',
    created_at: '2026-01-01T10:00:00Z',
    updated_at: '2026-01-01T10:00:00Z',
    published_at: null,
    closed_at: null,
  }
}

function page(items: readonly JobDescription[], hasNext: boolean): JobBrowsePage {
  return { items: [...items], has_next: hasNext, next_cursor: null }
}

describe('the status filter round trip (AC17)', () => {
  it('reads a declared status and ignores anything else', () => {
    expect(readAdminJobStatus(new URLSearchParams('status=Closed'))).toBe('Closed')
    expect(readAdminJobStatus(new URLSearchParams('status=Archived'))).toBeNull()
    expect(readAdminJobStatus(new URLSearchParams())).toBeNull()
  })

  it('writes the applied filter and omits an unapplied one', () => {
    expect(writeAdminJobsParams('Open').toString()).toBe(`${ADMIN_JOBS_PARAM.status}=Open`)
    expect(writeAdminJobsParams(null).toString()).toBe('')
  })

  it('round-trips a filter and a cursor', () => {
    const written = writeAdminJobsParams('Draft', 'abc')

    expect(readAdminJobStatus(written)).toBe('Draft')
    expect(readAdminJobsCursor(written)).toBe('abc')
  })

  it('reports a blank cursor as no cursor', () => {
    expect(readAdminJobsCursor(new URLSearchParams('after_id=%20'))).toBeNull()
  })
})

describe('the Admin listing query (AC17)', () => {
  it('requests at most 20 rows and omits an unapplied filter', () => {
    expect(adminJobsQuery()).toEqual({ limit: 20 })
    expect(adminJobsQuery('Closed' as JdStatus, 'abc')).toEqual({
      limit: 20,
      status: 'Closed',
      after_id: 'abc',
    })
  })
})

describe('the Admin listing cursor (AC17)', () => {
  it('addresses the next page by the identifier of the last row returned', () => {
    expect(nextAdminJobsPage(page([row('one'), row('two')], true))).toEqual({
      hasNextPage: true,
      nextCursor: 'two',
    })
  })

  it('reports no next page when the response reports none', () => {
    expect(nextAdminJobsPage(page([row('one')], false)).hasNextPage).toBe(false)
    expect(nextAdminJobsPage(null).hasNextPage).toBe(false)
  })

  it('reports no next page for a successor claimed without a row to continue from', () => {
    expect(nextAdminJobsPage(page([], true)).hasNextPage).toBe(false)
  })
})
