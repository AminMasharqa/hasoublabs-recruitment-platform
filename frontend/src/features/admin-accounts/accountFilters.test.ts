/**
 * Unit tests for the account-list filters, the keyset cursor and the view switch
 * (task 22.1).
 *
 * Requirement 16:
 * - AC2 each applied filter is sent as a query parameter, and is read back out of
 *   the address so it stays on screen through an empty result.
 * - AC3 at most 20 accounts per page, and the next-page control sends the last
 *   returned account identifier as `after_id`.
 * - AC17 the pending-skill review is addressable.
 */

import { describe, expect, it } from 'vitest'

import { DEFAULT_PAGE_SIZE } from '../../lib/cursor'

import {
  accountsQueryParams,
  ACCOUNTS_PARAM,
  EMPTY_ACCOUNT_FILTERS,
  hasActiveAccountFilters,
  nextAccountsPage,
  PENDING_SKILLS_VIEW,
  pendingSkillsSearch,
  readAccountCursor,
  readAccountFilters,
  readAccountsView,
  writeAccountFilters,
} from './accountFilters'
import type { Account } from './accountRules'

function params(query: string): URLSearchParams {
  return new URLSearchParams(query)
}

function account(id: string): Account {
  return {
    id,
    email: `${id}@example.com`,
    roles: ['CANDIDATE'],
    status: 'Approved',
    language_preference: 'en',
    mfa_enrolled: false,
    created_at: '2025-01-01T00:00:00Z',
  }
}

function page(size: number): Account[] {
  return Array.from({ length: size }, (_unused, index) => account(`a${index + 1}`))
}

// ── AC2: the filters ──────────────────────────────────────────────────────────

describe('readAccountFilters (Req 16 AC2)', () => {
  it('reads the status and role filters out of the address', () => {
    expect(readAccountFilters(params('status=PendingApproval&role=SENIOR'))).toEqual({
      status: 'PendingApproval',
      role: 'SENIOR',
    })
  })

  it('reads no filter from an empty address', () => {
    expect(readAccountFilters(params(''))).toEqual(EMPTY_ACCOUNT_FILTERS)
  })

  it('drops a value the contract does not declare rather than forwarding it', () => {
    expect(readAccountFilters(params('status=Archived&role=MODERATOR'))).toEqual(
      EMPTY_ACCOUNT_FILTERS,
    )
  })

  it('round-trips an applied filter set through the address', () => {
    const applied = { status: 'Suspended', role: 'ADMIN' } as const
    expect(readAccountFilters(writeAccountFilters(applied))).toEqual(applied)
  })

  it('writes only what is applied, so two equal sets produce one address', () => {
    expect(writeAccountFilters({ status: 'Approved', role: null }).toString()).toBe(
      'status=Approved',
    )
    expect(writeAccountFilters(EMPTY_ACCOUNT_FILTERS).toString()).toBe('')
  })

  it('never writes the cursor, so applying a filter restarts the keyset walk', () => {
    expect(writeAccountFilters({ status: 'Approved', role: null }).has(ACCOUNTS_PARAM.afterId)).toBe(
      false,
    )
  })

  it('reports whether a filter is applied at all', () => {
    expect(hasActiveAccountFilters(EMPTY_ACCOUNT_FILTERS)).toBe(false)
    expect(hasActiveAccountFilters({ status: 'Approved', role: null })).toBe(true)
    expect(hasActiveAccountFilters({ status: null, role: 'ADMIN' })).toBe(true)
  })
})

// ── AC3: the page and its cursor ──────────────────────────────────────────────

describe('accountsQueryParams (Req 16 AC2, AC3)', () => {
  it('requests at most twenty accounts', () => {
    expect(accountsQueryParams(EMPTY_ACCOUNT_FILTERS)).toEqual({ limit: DEFAULT_PAGE_SIZE })
    expect(DEFAULT_PAGE_SIZE).toBe(20)
  })

  it('sends each applied filter as a query parameter', () => {
    expect(accountsQueryParams({ status: 'PendingApproval', role: 'CANDIDATE' })).toEqual({
      limit: DEFAULT_PAGE_SIZE,
      status: 'PendingApproval',
      role: 'CANDIDATE',
    })
  })

  it('sends the cursor as after_id and omits a blank one', () => {
    expect(accountsQueryParams(EMPTY_ACCOUNT_FILTERS, 'a20')).toEqual({
      limit: DEFAULT_PAGE_SIZE,
      after_id: 'a20',
    })
    expect(accountsQueryParams(EMPTY_ACCOUNT_FILTERS, '   ')).toEqual({ limit: DEFAULT_PAGE_SIZE })
    expect(accountsQueryParams(EMPTY_ACCOUNT_FILTERS, null)).toEqual({ limit: DEFAULT_PAGE_SIZE })
  })
})

describe('readAccountCursor (Req 16 AC3)', () => {
  it('reads the cursor the address carries, and null for none', () => {
    expect(readAccountCursor(params('after_id=a20'))).toBe('a20')
    expect(readAccountCursor(params('after_id=%20%20'))).toBeNull()
    expect(readAccountCursor(params(''))).toBeNull()
  })
})

describe('nextAccountsPage (Req 16 AC3)', () => {
  it('reports the last returned identifier while a full page came back', () => {
    expect(nextAccountsPage(page(DEFAULT_PAGE_SIZE))).toEqual({
      hasNextPage: true,
      nextCursor: `a${DEFAULT_PAGE_SIZE}`,
    })
  })

  it('reports no further page for a partial page', () => {
    expect(nextAccountsPage(page(DEFAULT_PAGE_SIZE - 1)).hasNextPage).toBe(false)
    expect(nextAccountsPage([]).hasNextPage).toBe(false)
    expect(nextAccountsPage(undefined).hasNextPage).toBe(false)
  })
})

// ── AC17: the pending-skill review view ───────────────────────────────────────

describe('the view switch (Req 16 AC17)', () => {
  it('renders the account list unless the address names the review', () => {
    expect(readAccountsView(params(''))).toBe('accounts')
    expect(readAccountsView(params('view=something-else'))).toBe('accounts')
  })

  it('renders the review when the address names it', () => {
    expect(readAccountsView(params('view=pending-skills'))).toBe(PENDING_SKILLS_VIEW)
    expect(readAccountsView(pendingSkillsSearch())).toBe(PENDING_SKILLS_VIEW)
  })
})
