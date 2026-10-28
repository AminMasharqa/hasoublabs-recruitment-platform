/**
 * Unit tests for the before/after field comparison (Requirement 17 AC5).
 *
 * The comparison is what an Admin reads to judge a recorded decision, so these
 * cover the four change kinds, the absent-versus-null distinction that a blank cell
 * would destroy, and the byte-identical passthrough of Arabic and Hebrew snapshot
 * values (Requirement 19 AC10).
 */

import { describe, expect, it } from 'vitest'

import { isByteIdentical } from '../../i18n/formatting'

import { compareAuditFields, renderSnapshotValue } from './auditComparison'

describe('the change kind of each field (AC5)', () => {
  it('names a field present in both snapshots with different values as changed', () => {
    const comparison = compareAuditFields({ status: 'PendingApproval' }, { status: 'Approved' })

    expect(comparison.rows).toEqual([
      { field: 'status', before: 'PendingApproval', after: 'Approved', kind: 'changed' },
    ])
    expect(comparison.hasChanges).toBe(true)
  })

  it('names a field only `after` carries as added, and one only `before` carries as removed', () => {
    const comparison = compareAuditFields({ reason: 'stale' }, { approved_by: 'acc-1' })

    expect(comparison.rows).toEqual([
      { field: 'approved_by', before: null, after: 'acc-1', kind: 'added' },
      { field: 'reason', before: 'stale', after: null, kind: 'removed' },
    ])
  })

  it('names a field present in both with the same value as unchanged, and keeps it', () => {
    const comparison = compareAuditFields(
      { email: 'a@example.com', status: 'Approved' },
      { email: 'a@example.com', status: 'Suspended' },
    )

    expect(comparison.rows.map((row) => [row.field, row.kind])).toEqual([
      ['email', 'unchanged'],
      ['status', 'changed'],
    ])
    expect(comparison.hasChanges).toBe(true)
  })

  it('reports no changes when the two snapshots are equal', () => {
    const comparison = compareAuditFields({ status: 'Approved' }, { status: 'Approved' })

    expect(comparison.hasSnapshots).toBe(true)
    expect(comparison.hasChanges).toBe(false)
  })

  it('distinguishes an absent member from one holding null', () => {
    const comparison = compareAuditFields({ closed_at: null }, {})

    // Absent renders as `null` the *row value*; present-and-null renders the text
    // `null`. Collapsing the two would lose which of them the record states.
    expect(comparison.rows).toEqual([
      { field: 'closed_at', before: 'null', after: null, kind: 'removed' },
    ])
  })

  it('sorts rows by field name so two renderings of one entry agree', () => {
    const comparison = compareAuditFields({ zeta: 1, alpha: 2 }, { mid: 3 })

    expect(comparison.rows.map((row) => row.field)).toEqual(['alpha', 'mid', 'zeta'])
  })
})

describe('an entry with no snapshots (AC5)', () => {
  it('reports no comparison for an entry that recorded neither member', () => {
    for (const [before, after] of [
      [null, null],
      [undefined, undefined],
      [null, undefined],
    ] as const) {
      const comparison = compareAuditFields(before, after)
      expect(comparison.hasSnapshots).toBe(false)
      expect(comparison.hasChanges).toBe(false)
      expect(comparison.rows).toEqual([])
    }
  })

  it('reports no comparison for a member that is not an object', () => {
    expect(compareAuditFields([] as never, 'text' as never).hasSnapshots).toBe(false)
  })

  it('compares against an empty snapshot when only one side is absent', () => {
    const comparison = compareAuditFields(null, { status: 'Approved' })

    expect(comparison.rows).toEqual([
      { field: 'status', before: null, after: 'Approved', kind: 'added' },
    ])
  })
})

describe('rendering one snapshot value', () => {
  it('returns a string byte-identically (Req 19 AC10)', () => {
    for (const value of ['مطوّر منصّات', 'מנהל גיוס', '  spaced  ', '', 'a\u200Fb']) {
      expect(isByteIdentical(renderSnapshotValue(value), value)).toBe(true)
    }
  })

  it('renders scalars as the contract spells them', () => {
    expect(renderSnapshotValue(null)).toBe('null')
    expect(renderSnapshotValue(true)).toBe('true')
    expect(renderSnapshotValue(4)).toBe('4')
  })

  it('renders an object with sorted keys, so key order is not reported as a change', () => {
    const comparison = compareAuditFields(
      { meta: { b: 1, a: 2 } },
      { meta: { a: 2, b: 1 } },
    )

    expect(comparison.rows[0]?.kind).toBe('unchanged')
  })

  it('renders an array element by element', () => {
    expect(renderSnapshotValue(['ADMIN', 'CANDIDATE'])).toBe('["ADMIN","CANDIDATE"]')
  })
})
