import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PAGE_SIZE,
  byId,
  deriveNextPage,
  type CursorValue,
  type MetaPagedResponse,
  type PaginatedSource,
  type TokenPagedResponse,
} from './cursor'

/**
 * An item of a bare-array page. The `last-id` endpoints key their keyset cursor
 * either on the returned `id` (`GET /me/applications`, `GET /admin/accounts`,
 * applicants) or on the review `seq` (review timelines), so a generated item
 * carries both and the endpoint's selector picks the one it advertises.
 */
interface PageItem {
  readonly id: string | number
  readonly seq: number
}

/**
 * A generated paginated read paired with what the response itself advertises:
 * whether a further page exists, and the continuation token the next request
 * would have to carry.
 */
interface PageCase {
  /** The endpoint variant, carried for shrink-report readability. */
  readonly variant: 'token' | 'meta' | 'last-id'
  readonly source: PaginatedSource<PageItem, CursorValue>
  readonly reportsFurtherPage: boolean
  readonly advertisedToken: CursorValue | null
}

/** An opaque `next_cursor`: the Backend_Api never advertises an empty token. */
const opaqueToken = fc.string({ minLength: 1, maxLength: 32 })

/** A continuation identifier (`meta.next_after_id`, an account id, a review seq). */
const continuationId = fc.nat({ max: 1_000_000 })

/** An identifier of a bare-array page row: an opaque id or a numeric id. */
const rowId = fc.oneof(opaqueToken, continuationId)

const pageItem: fc.Arbitrary<PageItem> = fc.record({ id: rowId, seq: continuationId })

/** `GET /jobs`, `GET /admin/reports/candidate-progress`: `has_next` + `next_cursor`. */
const tokenCase: fc.Arbitrary<PageCase> = fc
  .record({
    hasNext: fc.boolean(),
    activeToken: opaqueToken,
    // On a last page the contract leaves the token unused; a stale value must
    // not enable the control either.
    idleToken: fc.option(opaqueToken, { nil: null }),
  })
  .map(({ hasNext, activeToken, idleToken }) => {
    const response: TokenPagedResponse = hasNext
      ? { has_next: true, next_cursor: activeToken }
      : { has_next: false, next_cursor: idleToken }
    return {
      variant: 'token',
      source: { kind: 'token', response },
      reportsFurtherPage: hasNext,
      advertisedToken: hasNext ? activeToken : null,
    }
  })

/** `GET /admin/audit`: `meta.has_more` + `meta.next_after_id`. */
const metaCase: fc.Arbitrary<PageCase> = fc
  .record({
    hasMore: fc.boolean(),
    activeId: continuationId,
    idleId: fc.oneof<fc.Arbitrary<number | null | undefined>[]>(
      continuationId,
      fc.constant(null),
      fc.constant(undefined),
    ),
  })
  .map(({ hasMore, activeId, idleId }) => {
    const response: MetaPagedResponse = hasMore
      ? { meta: { has_more: true, next_after_id: activeId } }
      : { meta: { has_more: false, next_after_id: idleId } }
    return {
      variant: 'meta',
      source: { kind: 'meta', response },
      reportsFurtherPage: hasMore,
      advertisedToken: hasMore ? activeId : null,
    }
  })

/**
 * `GET /me/applications`, `GET /admin/accounts`, applicants, review timelines:
 * a bare array whose further page is reported by a full page being returned,
 * with the last returned identifier as the token (Assumption 8).
 */
const lastIdCase: fc.Arbitrary<PageCase> = fc
  .oneof(fc.constant(DEFAULT_PAGE_SIZE), fc.integer({ min: 1, max: 24 }))
  .chain((limit) =>
    fc.record({
      limit: fc.constant(limit),
      // A page never exceeds the requested size, so a full page means exactly `limit`.
      items: fc.array(pageItem, { minLength: 0, maxLength: limit }),
      keyedBySeq: fc.boolean(),
      // The default page size is also reachable by omitting `limit` entirely.
      omitLimit: limit === DEFAULT_PAGE_SIZE ? fc.boolean() : fc.constant(false),
    }),
  )
  .map(({ limit, items, keyedBySeq, omitLimit }) => {
    const cursorOf = keyedBySeq ? (item: PageItem) => item.seq : byId
    const full = items.length === limit
    const last = items[items.length - 1]
    return {
      variant: 'last-id',
      source: omitLimit
        ? { kind: 'last-id', items, cursorOf }
        : { kind: 'last-id', items, limit, cursorOf },
      reportsFurtherPage: full,
      advertisedToken: full && last !== undefined ? cursorOf(last) : null,
    }
  })

const pageCase: fc.Arbitrary<PageCase> = fc.oneof(tokenCase, metaCase, lastIdCase)

describe('cursor derivation properties', () => {
  // Feature: frontend-web-application, Property 18: Keyset cursor derivation —
  // For any paginated read response, the next-page cursor derived by the
  // Web_Client equals the response's advertised continuation token
  // (`next_cursor`, the last returned identifier, or `meta.next_after_id` as the
  // endpoint dictates), and the next-page control is enabled if and only if the
  // response reports that a further page exists.
  //
  // **Validates: Requirements 12.4, 14.10, 16.3, 17.3, 18.4**
  it('derives the advertised continuation token and enables the control iff a further page is reported', () => {
    fc.assert(
      fc.property(pageCase, (page) => {
        const derived = deriveNextPage(page.source)

        // Enabled if and only if the response reports a further page.
        expect(derived.hasNextPage).toBe(page.reportsFurtherPage)
        // The carried cursor is exactly the token the endpoint advertised.
        expect(derived.nextCursor).toBe(page.advertisedToken)
      }),
      { numRuns: 500 },
    )
  })
})
