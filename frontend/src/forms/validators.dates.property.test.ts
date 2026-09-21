import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { validateDateOrder, type DateOrderEntry } from './validators'

/**
 * The two orderable kinds a date-range input carries: an education year (an
 * ordinal integer) and a work-experience calendar instant (an ISO date string or
 * a `Date`). Values of different kinds are not ordered relative to each other.
 */
type Kind = 'year' | 'date'

/** Whether the generated end value precedes, equals or follows the start value. */
type Relation = 'before' | 'equal' | 'after'

/**
 * One generated start or end value: the raw form handed to the validator paired
 * with how the requirement classifies it — its kind and its position within that
 * kind, or `kind: null` when the value carries no interpretable position (absent,
 * blank or uninterpretable).
 */
interface ValueCase {
  readonly raw: unknown
  readonly kind: Kind | null
  /** Position within the kind: the year itself, or the instant in milliseconds. */
  readonly at: number
}

const MS_PER_DAY = 86_400_000

/** A year within the declared education bounds, widened so gaps can cross them. */
const yearPosition = fc.integer({ min: 1900, max: 2100 })
/** A whole day offset from the epoch, spanning 1970 to ~2079. */
const dayPosition = fc.integer({ min: 0, max: 40_000 })

function positionOf(kind: Kind): fc.Arbitrary<number> {
  return kind === 'year' ? yearPosition : dayPosition
}

/** A non-zero distance between the two positions, in the unit of the kind. */
function gapOf(kind: Kind): fc.Arbitrary<number> {
  return kind === 'year'
    ? fc.integer({ min: 1, max: 200 })
    : fc.integer({ min: 1, max: 40_000 })
}

/**
 * The raw forms a year may take in a form's state: the integer itself, its
 * decimal text as a `<input type="number">` reports it, a signed form, and text
 * with surrounding whitespace.
 */
function yearValue(year: number): fc.Arbitrary<ValueCase> {
  return fc
    .oneof<fc.Arbitrary<unknown>[]>(
      fc.constant(year),
      fc.constant(String(year)),
      fc.constant(`+${year}`),
      fc.constant(`  ${year}  `),
    )
    .map((raw) => ({ raw, kind: 'year' as const, at: year }))
}

/**
 * The raw forms a calendar date may take, all denoting the same instant: the
 * `YYYY-MM-DD` form the Backend_Api declares, the full ISO form, and a `Date`.
 */
function dateValue(dayIndex: number): fc.Arbitrary<ValueCase> {
  const at = dayIndex * MS_PER_DAY
  const iso = new Date(at).toISOString()
  return fc
    .oneof<fc.Arbitrary<unknown>[]>(
      fc.constant(iso.slice(0, 10)),
      fc.constant(iso),
      fc.constant(new Date(at)),
    )
    .map((raw) => ({ raw, kind: 'date' as const, at }))
}

function valueOf(kind: Kind, position: number): fc.Arbitrary<ValueCase> {
  return kind === 'year' ? yearValue(position) : dateValue(position)
}

/** An orderable value of either kind, at an arbitrary position. */
const orderableValue: fc.Arbitrary<ValueCase> = fc
  .constantFrom<Kind[]>('year', 'date')
  .chain((kind) => positionOf(kind).chain((position) => valueOf(kind, position)))

/**
 * A value carrying no interpretable position: an ongoing entry (absent or empty
 * end), a free-text placeholder a candidate may type, and values no date can be
 * read out of at all.
 */
const unorderableValue: fc.Arbitrary<ValueCase> = fc
  .constantFrom<unknown[]>(
    undefined,
    null,
    '',
    '   ',
    'present',
    'ongoing',
    'current',
    'n/a',
    'tbd',
    'not a date',
    '2020-13-45',
    Number.NaN,
    Number.POSITIVE_INFINITY,
    true,
    {},
    new Date('nope'),
  )
  .map((raw) => ({ raw, kind: null, at: Number.NaN }))

/** A start/end pair of the same kind, placed in a chosen order. */
const sameKindPair: fc.Arbitrary<readonly [ValueCase, ValueCase]> = fc
  .constantFrom<Kind[]>('year', 'date')
  .chain((kind) =>
    fc
      .record({
        start: positionOf(kind),
        relation: fc.constantFrom<Relation[]>('before', 'equal', 'after'),
        gap: gapOf(kind),
      })
      .chain(({ start, relation, gap }) => {
        const end = relation === 'equal' ? start : relation === 'after' ? start + gap : start - gap
        return fc.tuple(valueOf(kind, start), valueOf(kind, end))
      }),
  )

/** A year compared against a calendar date: orderable values of different kinds. */
const mixedKindPair: fc.Arbitrary<readonly [ValueCase, ValueCase]> = fc
  .tuple(
    yearPosition.chain((year) => yearValue(year)),
    dayPosition.chain((day) => dateValue(day)),
    fc.boolean(),
  )
  .map(([year, date, yearFirst]) => (yearFirst ? [year, date] : [date, year]))

const valuePair: fc.Arbitrary<readonly [ValueCase, ValueCase]> = fc.oneof(
  sameKindPair,
  sameKindPair,
  mixedKindPair,
  // An ongoing or unreadable end against a real start.
  fc.tuple(orderableValue, unorderableValue),
  // A missing start: the ordering rule has nothing to compare against.
  fc.tuple(unorderableValue, orderableValue),
  fc.tuple(unorderableValue, unorderableValue),
)

/** Where the entry sits: the collection and end member the caller addresses. */
const target = fc.constantFrom<{ collection?: string; endField?: string }[]>(
  { collection: 'education', endField: 'end_year' },
  { collection: 'work_experience', endField: 'end_date' },
  { collection: 'education' },
  { endField: 'end_date' },
  {},
)

interface OrderCase {
  readonly start: ValueCase
  readonly end: ValueCase
  readonly index: number
  readonly target: { readonly collection?: string; readonly endField?: string }
}

const orderCase: fc.Arbitrary<OrderCase> = fc
  .record({
    pair: valuePair,
    // Zero-based position of the entry in its collection; the declared maximum is
    // 20 entries, widened so a larger index is exercised too.
    index: fc.nat({ max: 40 }),
    target,
  })
  .map(({ pair, index, target: at }) => ({ start: pair[0], end: pair[1], index, target: at }))

/** The requirement's acceptance predicate: the end value precedes the start value. */
function endPrecedesStart(entry: OrderCase): boolean {
  const { start, end } = entry
  if (start.kind === null || end.kind === null || start.kind !== end.kind) {
    return false
  }
  return end.at < start.at
}

describe('date-range ordering properties', () => {
  // Feature: frontend-web-application, Property 15: Date-range ordering with
  // index reporting — For any education or work-experience entry with a start
  // value, an end value and a position index, the Form_Validator rejects the
  // entry if and only if the end value precedes the start value, and the
  // rejection message names that index.
  //
  // **Validates: Requirements 22.6**
  it('rejects an entry iff its end precedes its start, and names the entry index', () => {
    fc.assert(
      fc.property(orderCase, (entry) => {
        const params: DateOrderEntry = {
          start: entry.start.raw,
          end: entry.end.raw,
          index: entry.index,
          ...entry.target,
        }
        const found = validateDateOrder(params)

        if (!endPrecedesStart(entry)) {
          // Accepted: an end at or after the start, an ongoing entry, an
          // unreadable value, or two values that are not mutually ordered.
          expect(found).toBeNull()
          return
        }

        // Rejected, with the end-before-start cause.
        expect(found).not.toBeNull()
        expect(found?.code).toBe('end_before_start')
        // No user-visible literal: the message is an i18n catalogue key.
        expect(typeof found?.messageKey).toBe('string')

        // The affected index is named three ways, all agreeing with the index supplied.
        const collection = entry.target.collection ?? 'entries'
        const endField = entry.target.endField ?? 'end'
        expect(found?.params?.index).toBe(entry.index)
        expect(found?.params?.entryNumber).toBe(entry.index + 1)
        expect(found?.path).toBe(`${collection}.${entry.index}.${endField}`)
        expect(found?.path.split('.')[1]).toBe(String(entry.index))
      }),
      { numRuns: 500 },
    )
  })
})
