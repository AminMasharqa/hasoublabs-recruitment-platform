import { describe, expect, expectTypeOf, it } from 'vitest'

import type { components } from '../api/generated/schema'

import {
  DEFAULT_PAGE_SIZE,
  byId,
  deriveLastIdCursor,
  deriveMetaCursor,
  deriveNextPage,
  deriveTokenCursor,
  type MetaPagedResponse,
  type TokenPagedResponse,
} from './cursor'

/** The generated contract shapes must satisfy the deriver's structural inputs. */
describe('generated contract compatibility', () => {
  it('matches the advertised paginated response shapes', () => {
    expectTypeOf<components['schemas']['JdBrowsePage']>().toExtend<TokenPagedResponse>()
    expectTypeOf<components['schemas']['CandidateProgressReport']>().toExtend<TokenPagedResponse>()
    expectTypeOf<components['schemas']['AuditSearchResponse']>().toExtend<MetaPagedResponse>()
  })
})

describe('deriveTokenCursor', () => {
  it('derives the advertised next_cursor when has_next is true', () => {
    expect(deriveTokenCursor({ has_next: true, next_cursor: 'eyJpZCI6MX0' })).toEqual({
      hasNextPage: true,
      nextCursor: 'eyJpZCI6MX0',
    })
  })

  it('disables the control when has_next is false', () => {
    expect(deriveTokenCursor({ has_next: false, next_cursor: 'eyJpZCI6MX0' })).toEqual({
      hasNextPage: false,
      nextCursor: null,
    })
  })

  it('disables the control when no usable token is advertised', () => {
    expect(deriveTokenCursor({ has_next: true, next_cursor: null })).toEqual({
      hasNextPage: false,
      nextCursor: null,
    })
    expect(deriveTokenCursor({ has_next: true, next_cursor: '' })).toEqual({
      hasNextPage: false,
      nextCursor: null,
    })
    expect(deriveTokenCursor(undefined)).toEqual({ hasNextPage: false, nextCursor: null })
  })
})

describe('deriveMetaCursor', () => {
  it('derives meta.next_after_id when meta.has_more is true', () => {
    expect(deriveMetaCursor({ meta: { has_more: true, next_after_id: 4210 } })).toEqual({
      hasNextPage: true,
      nextCursor: 4210,
    })
  })

  it('disables the control when meta.has_more is false', () => {
    expect(deriveMetaCursor({ meta: { has_more: false, next_after_id: 4210 } })).toEqual({
      hasNextPage: false,
      nextCursor: null,
    })
  })

  it('accepts zero as a continuation id', () => {
    expect(deriveMetaCursor({ meta: { has_more: true, next_after_id: 0 } })).toEqual({
      hasNextPage: true,
      nextCursor: 0,
    })
  })

  it('disables the control when the continuation id is absent', () => {
    expect(deriveMetaCursor({ meta: { has_more: true } })).toEqual({
      hasNextPage: false,
      nextCursor: null,
    })
    expect(deriveMetaCursor({ meta: { has_more: true, next_after_id: null } })).toEqual({
      hasNextPage: false,
      nextCursor: null,
    })
  })
})

describe('deriveLastIdCursor', () => {
  const page = (size: number) => Array.from({ length: size }, (_, i) => ({ id: `id-${i}` }))

  it('derives the last returned identifier when a full page was returned', () => {
    expect(deriveLastIdCursor(page(DEFAULT_PAGE_SIZE), { cursorOf: byId })).toEqual({
      hasNextPage: true,
      nextCursor: `id-${DEFAULT_PAGE_SIZE - 1}`,
    })
  })

  it('disables the control on a partial or empty page', () => {
    expect(deriveLastIdCursor(page(DEFAULT_PAGE_SIZE - 1), { cursorOf: byId })).toEqual({
      hasNextPage: false,
      nextCursor: null,
    })
    expect(deriveLastIdCursor(page(0), { cursorOf: byId })).toEqual({
      hasNextPage: false,
      nextCursor: null,
    })
    expect(deriveLastIdCursor<{ id: string }, string>(undefined, { cursorOf: byId })).toEqual({
      hasNextPage: false,
      nextCursor: null,
    })
  })

  it('honours an explicit page size', () => {
    expect(deriveLastIdCursor(page(5), { limit: 5, cursorOf: byId })).toEqual({
      hasNextPage: true,
      nextCursor: 'id-4',
    })
    expect(deriveLastIdCursor(page(5), { limit: 0, cursorOf: byId })).toEqual({
      hasNextPage: false,
      nextCursor: null,
    })
  })

  it('supports a non-id cursor such as the review seq', () => {
    const reviews = Array.from({ length: 20 }, (_, i) => ({ seq: i + 1 }))
    expect(deriveLastIdCursor(reviews, { cursorOf: (review) => review.seq })).toEqual({
      hasNextPage: true,
      nextCursor: 20,
    })
  })
})

describe('deriveNextPage', () => {
  it('dispatches on the variant the endpoint dictates', () => {
    expect(
      deriveNextPage({ kind: 'token', response: { has_next: true, next_cursor: 'c1' } }),
    ).toEqual({ hasNextPage: true, nextCursor: 'c1' })
    expect(
      deriveNextPage({ kind: 'meta', response: { meta: { has_more: true, next_after_id: 7 } } }),
    ).toEqual({ hasNextPage: true, nextCursor: 7 })
    expect(
      deriveNextPage({
        kind: 'last-id',
        items: [{ id: 'a' }, { id: 'b' }],
        limit: 2,
        cursorOf: byId,
      }),
    ).toEqual({ hasNextPage: true, nextCursor: 'b' })
  })
})
