/**
 * Unit tests for the Audit_Log filter round trip (Requirement 17 AC2–AC4).
 *
 * The address bar is the applied filter set, so these cover the three directions
 * that matters in: reading a location, writing one back, and turning one into the
 * query of `GET /admin/audit` — including the keyset cursor of AC3, which the
 * endpoint takes verbatim as `after_id`, and the two time bounds, which have to
 * mean the same instant regardless of which machine the URL is opened on.
 */

import { describe, expect, it } from 'vitest'

import { DEFAULT_PAGE_SIZE } from '../../lib/cursor'

import {
  auditQueryParams,
  EMPTY_AUDIT_FILTERS,
  hasActiveAuditFilters,
  nextAuditPage,
  normalizeTimeBound,
  readAuditCursor,
  readAuditFilters,
  timeBoundInputValue,
  writeAuditFilters,
} from './auditFilters'

describe('reading the applied filters out of a location (AC2)', () => {
  it('reads every filter the requirement names', () => {
    const params = new URLSearchParams(
      'actor_account_id=acc-1&action=account.approve&entity_type=Account&entity_id=acc-9&from_dt=2024-04-01T00:00:00Z&to_dt=2024-04-30T23:59:59Z',
    )

    expect(readAuditFilters(params)).toEqual({
      actorAccountId: 'acc-1',
      action: 'account.approve',
      entityType: 'Account',
      entityId: 'acc-9',
      from: '2024-04-01T00:00:00.000Z',
      to: '2024-04-30T23:59:59.000Z',
    })
  })

  it('treats a blank or unparsable value as no filter at all', () => {
    const params = new URLSearchParams(
      'action=+&entity_type=&from_dt=not-a-timestamp&to_dt=&actor_account_id=++',
    )

    expect(readAuditFilters(params)).toEqual(EMPTY_AUDIT_FILTERS)
    expect(hasActiveAuditFilters(readAuditFilters(params))).toBe(false)
  })

  it('reads the keyset cursor separately from the filters', () => {
    const params = new URLSearchParams('action=login&after_id=417')

    expect(readAuditCursor(params)).toBe(417)
    expect(readAuditFilters(params).action).toBe('login')
    expect(hasActiveAuditFilters(readAuditFilters(params))).toBe(true)
  })

  it('ignores a cursor that names no entry identifier', () => {
    expect(readAuditCursor(new URLSearchParams('after_id=abc'))).toBeNull()
    expect(readAuditCursor(new URLSearchParams('after_id=-4'))).toBeNull()
    expect(readAuditCursor(new URLSearchParams('after_id=1.5'))).toBeNull()
    expect(readAuditCursor(new URLSearchParams())).toBeNull()
  })
})

describe('the time bounds are read as UTC (AC2, AC9)', () => {
  it('reads a value carrying no zone designator as UTC wall time', () => {
    // The same URL must mean the same search on every machine, so a zoneless
    // bound is UTC rather than the reader's local time.
    expect(normalizeTimeBound('2024-04-01T08:30')).toBe('2024-04-01T08:30:00.000Z')
    expect(normalizeTimeBound('2024-04-01T08:30:15')).toBe('2024-04-01T08:30:15.000Z')
    expect(normalizeTimeBound('2024-04-01 08:30')).toBe('2024-04-01T08:30:00.000Z')
  })

  it('canonicalizes a zoned value to the instant it denotes', () => {
    expect(normalizeTimeBound('2024-04-01T10:30:00+02:00')).toBe('2024-04-01T08:30:00.000Z')
  })

  it('yields no bound for a value that names no instant', () => {
    expect(normalizeTimeBound('')).toBe('')
    expect(normalizeTimeBound('   ')).toBe('')
    expect(normalizeTimeBound('2024-13-45T99:99')).toBe('')
    expect(normalizeTimeBound(null)).toBe('')
    expect(normalizeTimeBound(undefined)).toBe('')
  })

  it('round-trips through the control value it renders', () => {
    const bound = '2024-04-01T08:30:00.000Z'
    expect(timeBoundInputValue(bound)).toBe('2024-04-01T08:30')
    expect(normalizeTimeBound(timeBoundInputValue(bound))).toBe(bound)
    expect(timeBoundInputValue('')).toBe('')
  })

  it('keeps the seconds of a bound that carries some, so resubmitting does not move it', () => {
    const bound = '2024-04-30T23:59:59.000Z'
    expect(timeBoundInputValue(bound)).toBe('2024-04-30T23:59:59')
    expect(normalizeTimeBound(timeBoundInputValue(bound))).toBe(bound)
  })
})

describe('writing a filter set back into the address (AC2)', () => {
  it('omits everything that is not applied', () => {
    expect(writeAuditFilters(EMPTY_AUDIT_FILTERS).toString()).toBe('')
  })

  it('writes the applied values and drops the cursor', () => {
    const params = writeAuditFilters({
      actorAccountId: 'acc-1',
      action: 'account.reject',
      entityType: 'Account',
      entityId: 'acc-9',
      from: '2024-04-01T08:30',
      to: '',
    })

    expect(params.get('actor_account_id')).toBe('acc-1')
    expect(params.get('action')).toBe('account.reject')
    expect(params.get('entity_type')).toBe('Account')
    expect(params.get('entity_id')).toBe('acc-9')
    // Canonicalized on the way out, so the address carries one spelling per instant.
    expect(params.get('from_dt')).toBe('2024-04-01T08:30:00.000Z')
    expect(params.get('to_dt')).toBeNull()
    // Applying a filter starts a new keyset walk.
    expect(params.get('after_id')).toBeNull()
  })

  it('round-trips a read filter set back to the same address', () => {
    const original = new URLSearchParams(
      'action=login&actor_account_id=acc-1&entity_id=acc-9&entity_type=Account&from_dt=2024-04-01T00%3A00%3A00.000Z&to_dt=2024-04-30T00%3A00%3A00.000Z',
    )
    const rewritten = writeAuditFilters(readAuditFilters(original))

    expect([...rewritten.entries()].sort()).toEqual([...original.entries()].sort())
  })
})

describe('building the request query (AC2, AC3)', () => {
  it('requests the shared 20-row page and nothing else when unfiltered', () => {
    expect(auditQueryParams(EMPTY_AUDIT_FILTERS)).toEqual({ page_size: DEFAULT_PAGE_SIZE })
    expect(DEFAULT_PAGE_SIZE).toBe(20)
  })

  it('sends every applied filter as a query parameter', () => {
    expect(
      auditQueryParams({
        actorAccountId: 'acc-1',
        action: 'account.approve',
        entityType: 'Account',
        entityId: 'acc-9',
        from: '2024-04-01T08:30',
        to: '2024-04-02T08:30:00Z',
      }),
    ).toEqual({
      page_size: 20,
      actor_account_id: 'acc-1',
      action: 'account.approve',
      entity_type: 'Account',
      entity_id: 'acc-9',
      from_dt: '2024-04-01T08:30:00.000Z',
      to_dt: '2024-04-02T08:30:00.000Z',
    })
  })

  it('sends the cursor as `after_id`, verbatim (AC3)', () => {
    expect(auditQueryParams(EMPTY_AUDIT_FILTERS, 417)).toEqual({
      page_size: 20,
      after_id: 417,
    })
  })
})

describe('the next page of a response (AC3, AC4)', () => {
  it('carries `meta.next_after_id` while `meta.has_more` is true', () => {
    expect(nextAuditPage({ meta: { has_more: true, next_after_id: 417 } })).toEqual({
      hasNextPage: true,
      nextCursor: 417,
    })
  })

  it('reports no next page while `meta.has_more` is false (AC4)', () => {
    expect(nextAuditPage({ meta: { has_more: false, next_after_id: 417 } })).toEqual({
      hasNextPage: false,
      nextCursor: null,
    })
  })

  it('reports no next page when the continuation id is unusable', () => {
    expect(nextAuditPage({ meta: { has_more: true, next_after_id: null } }).hasNextPage).toBe(false)
    expect(nextAuditPage({ meta: { has_more: true } }).hasNextPage).toBe(false)
    expect(nextAuditPage(null).hasNextPage).toBe(false)
    expect(nextAuditPage(undefined).hasNextPage).toBe(false)
  })
})
