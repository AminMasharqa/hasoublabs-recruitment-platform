/**
 * Keyset pagination cursor derivation for the Web_Client.
 *
 * The Backend_Api advertises a continuation token in one of three shapes, and
 * every paginated read screen has to answer the same two questions from it:
 * which cursor does the next request carry, and is the next-page control
 * enabled?
 *
 * | variant     | endpoints                                                       | token                    | further page reported by        |
 * | ----------- | --------------------------------------------------------------- | ------------------------ | ------------------------------- |
 * | `token`     | `GET /jobs`, `GET /admin/reports/candidate-progress`             | `next_cursor`            | `has_next`                      |
 * | `meta`      | `GET /admin/audit`                                              | `meta.next_after_id`     | `meta.has_more`                 |
 * | `last-id`   | `GET /me/applications`, `GET /admin/accounts`, applicants, reviews | last returned identifier | a full page was returned        |
 *
 * The `last-id` endpoints return a bare JSON array with no continuation
 * metadata at all, so a further page is inferred from a full page being
 * returned (requirements Assumption 8).
 *
 * Requirements: 12.4, 14.10, 16.3, 17.3, 18.4.
 */

/** Requirements 12.3, 14.10, 16.3, 17.3, 18.4: at most 20 rows per page. */
export const DEFAULT_PAGE_SIZE = 20

/** Cursor values the Backend_Api accepts: opaque strings, ids, or sequence numbers. */
export type CursorValue = string | number

/**
 * The derived next-page state of a paginated read.
 *
 * Modelled as a union so a caller cannot reach for a cursor that does not
 * exist: `hasNextPage` gates access to a non-null `nextCursor`.
 */
export type NextPage<TCursor extends CursorValue = CursorValue> =
  | { readonly hasNextPage: true; readonly nextCursor: TCursor }
  | { readonly hasNextPage: false; readonly nextCursor: null }

/** No further page: the next-page control stays disabled. */
export const NO_NEXT_PAGE: NextPage<never> = { hasNextPage: false, nextCursor: null }

/** Envelope advertising an opaque `next_cursor` alongside a `has_next` flag. */
export interface TokenPagedResponse {
  readonly has_next: boolean
  readonly next_cursor: string | null
}

/** Envelope advertising the continuation id inside a `meta` member. */
export interface MetaPagedResponse {
  readonly meta: {
    readonly has_more: boolean
    readonly next_after_id?: number | null
  }
}

/** Reads the cursor value out of the last item of a bare-array page. */
export type CursorSelector<TItem, TCursor extends CursorValue> = (
  item: TItem,
) => TCursor | null | undefined

/** Selector for the common case of a bare-array page keyed by `id`. */
export function byId<TItem extends { readonly id: CursorValue }>(item: TItem): TItem['id'] {
  return item.id
}

function usable<TCursor extends CursorValue>(
  reportsFurtherPage: boolean,
  cursor: TCursor | null | undefined,
): NextPage<TCursor> {
  if (!reportsFurtherPage) {
    return NO_NEXT_PAGE
  }
  if (typeof cursor === 'string') {
    // An empty token cannot be sent as a keyset cursor.
    return cursor.length > 0 ? { hasNextPage: true, nextCursor: cursor } : NO_NEXT_PAGE
  }
  if (typeof cursor === 'number' && Number.isFinite(cursor)) {
    return { hasNextPage: true, nextCursor: cursor }
  }
  // A response that claims a further page without a usable continuation token
  // leaves no next request to form, so the control stays disabled.
  return NO_NEXT_PAGE
}

/**
 * Derives the next page of a `next_cursor`/`has_next` envelope.
 *
 * Covers `GET /jobs` (requirement 12.4) and
 * `GET /admin/reports/candidate-progress` (requirement 18.4).
 */
export function deriveTokenCursor(
  response: TokenPagedResponse | null | undefined,
): NextPage<string> {
  if (response == null) {
    return NO_NEXT_PAGE
  }
  return usable(response.has_next === true, response.next_cursor)
}

/**
 * Derives the next page of a `meta.next_after_id`/`meta.has_more` envelope.
 *
 * Covers `GET /admin/audit` (requirements 17.3, 17.4).
 */
export function deriveMetaCursor(response: MetaPagedResponse | null | undefined): NextPage<number> {
  const meta = response?.meta
  if (meta == null) {
    return NO_NEXT_PAGE
  }
  return usable(meta.has_more === true, meta.next_after_id)
}

/**
 * Derives the next page of a bare-array response from its last item.
 *
 * A further page is reported when the Backend_Api filled the requested page,
 * because these endpoints advertise no continuation metadata (Assumption 8).
 *
 * Covers `GET /me/applications` (requirement 14.10), `GET /admin/accounts`
 * (requirement 16.3), `GET /jobs/{jd_id}/applicants` and the review timelines.
 */
export function deriveLastIdCursor<TItem, TCursor extends CursorValue>(
  items: readonly TItem[] | null | undefined,
  options: {
    readonly limit?: number
    readonly cursorOf: CursorSelector<TItem, TCursor>
  },
): NextPage<TCursor> {
  const limit = options.limit ?? DEFAULT_PAGE_SIZE
  if (items == null || items.length === 0) {
    return NO_NEXT_PAGE
  }
  if (!Number.isFinite(limit) || limit < 1) {
    return NO_NEXT_PAGE
  }
  if (items.length < limit) {
    return NO_NEXT_PAGE
  }
  const last = items[items.length - 1]
  return usable(true, last === undefined ? null : options.cursorOf(last))
}

/** A paginated read in any of the three advertised shapes. */
export type PaginatedSource<TItem = unknown, TCursor extends CursorValue = CursorValue> =
  | { readonly kind: 'token'; readonly response: TokenPagedResponse | null | undefined }
  | { readonly kind: 'meta'; readonly response: MetaPagedResponse | null | undefined }
  | {
      readonly kind: 'last-id'
      readonly items: readonly TItem[] | null | undefined
      readonly limit?: number
      readonly cursorOf: CursorSelector<TItem, TCursor>
    }

/**
 * Derives the next page of any paginated read, dispatching on the variant the
 * endpoint dictates.
 */
export function deriveNextPage<TItem, TCursor extends CursorValue>(
  source: PaginatedSource<TItem, TCursor>,
): NextPage<CursorValue> {
  switch (source.kind) {
    case 'token':
      return deriveTokenCursor(source.response)
    case 'meta':
      return deriveMetaCursor(source.response)
    case 'last-id':
      return deriveLastIdCursor(source.items, {
        limit: source.limit,
        cursorOf: source.cursorOf,
      })
  }
}
