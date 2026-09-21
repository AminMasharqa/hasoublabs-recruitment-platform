/**
 * The field-level comparison of an Audit_Log entry's `before` and `after` members
 * (Requirement 17 AC5).
 *
 * Pure: no React. The screen renders whatever {@link compareAuditFields} returns,
 * so "which fields changed, and how" is decided in one testable place rather than
 * inside a component.
 *
 * ## Why a row per field of the union
 *
 * AC5 asks for a *field-level* comparison, which means the unit is the field and
 * not the object. A field present in only one of the two snapshots is therefore a
 * row of its own — added when only `after` carries it, removed when only `before`
 * does — because "this member did not exist before" and "this member changed to
 * null" are different facts about an accountability record and collapsing them
 * would lose the one that matters.
 *
 * Rows are sorted by field name so two renderings of the same entry are
 * identical, and unchanged fields are kept rather than filtered out: an Admin
 * reading an audit entry needs to see the full snapshot to judge it, and the
 * change kind already distinguishes what moved. The screen is free to fold the
 * unchanged ones away; the data keeps them.
 *
 * ## Why values are rendered, not compared structurally
 *
 * A snapshot member may hold any JSON value. Each one is turned into exactly one
 * string: a string member is that string, byte-identically, and everything else is
 * its JSON form. Comparison is then string equality, which is stable, order-free
 * for scalars and never reports a spurious change for two values that render
 * alike. For objects and arrays the JSON form is produced with sorted keys, so a
 * member whose keys the Backend_Api happened to serialize in a different order is
 * not reported as a change it is not.
 *
 * Requirement 19 AC10: a string member is carried through untouched — no
 * trimming, no normalization, no quoting — so Arabic and Hebrew snapshot values
 * reach the screen byte-identical and the screen renders them through `BidiText`.
 *
 * Requirements: 17.5, 19.10.
 */

/** Anything an Audit_Log snapshot member may be. */
type SnapshotValue = unknown

/** One of the two snapshots of an Audit_Log entry. */
export type AuditSnapshot = Record<string, SnapshotValue> | null | undefined

/**
 * How one field differs between the two snapshots.
 *
 * - `added` — present in `after` only.
 * - `removed` — present in `before` only.
 * - `changed` — present in both, rendering differently.
 * - `unchanged` — present in both, rendering identically.
 */
export type FieldChangeKind = 'added' | 'removed' | 'changed' | 'unchanged'

/** One field of the comparison (AC5). */
export interface FieldComparisonRow {
  /** The member name, exactly as the snapshot spells it. */
  readonly field: string
  /** The rendered `before` value, or `null` when the member is absent there. */
  readonly before: string | null
  /** The rendered `after` value, or `null` when the member is absent there. */
  readonly after: string | null
  readonly kind: FieldChangeKind
}

/** The comparison of one Audit_Log entry (AC5). */
export interface AuditComparison {
  readonly rows: readonly FieldComparisonRow[]
  /** Whether either snapshot carried anything at all. */
  readonly hasSnapshots: boolean
  /** Whether any row reports an `added`, `removed` or `changed` field. */
  readonly hasChanges: boolean
}

/** An empty comparison: the entry carried neither snapshot. */
const NO_COMPARISON: AuditComparison = Object.freeze({
  rows: Object.freeze([]) as readonly FieldComparisonRow[],
  hasSnapshots: false,
  hasChanges: false,
})

function isSnapshot(value: AuditSnapshot): value is Record<string, SnapshotValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Every key of a value, recursively, so `JSON.stringify` can sort them. */
function deepKeys(value: SnapshotValue, into: Set<string>): Set<string> {
  if (Array.isArray(value)) {
    for (const member of value) {
      deepKeys(member, into)
    }
    return into
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, member] of Object.entries(value)) {
      into.add(key)
      deepKeys(member, into)
    }
  }
  return into
}

/**
 * Renders one snapshot member as the single string the comparison shows.
 *
 * A string is returned as it arrived — byte-identically, unquoted, untrimmed
 * (Req 19 AC10). Every other value becomes its JSON form, with object keys sorted
 * so that two serializations of the same object compare equal. A value JSON
 * cannot represent renders as the empty string rather than throwing: a defective
 * snapshot member must not take the screen down.
 */
export function renderSnapshotValue(value: SnapshotValue): string {
  if (typeof value === 'string') {
    return value
  }
  if (value === null) {
    return 'null'
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  try {
    return JSON.stringify(value, [...deepKeys(value, new Set<string>())].sort()) ?? ''
  } catch {
    return ''
  }
}

function member(snapshot: Record<string, SnapshotValue> | null, field: string): string | null {
  if (snapshot === null || !Object.hasOwn(snapshot, field)) {
    return null
  }
  return renderSnapshotValue(snapshot[field])
}

function changeKind(before: string | null, after: string | null): FieldChangeKind {
  if (before === null) {
    return 'added'
  }
  if (after === null) {
    return 'removed'
  }
  return before === after ? 'unchanged' : 'changed'
}

/**
 * Compares the `before` and `after` members of an Audit_Log entry field by field
 * (AC5).
 *
 * An entry carrying neither snapshot — a read, a login, anything with no state
 * transition to record — yields {@link NO_COMPARISON}, which the screen renders as
 * "this entry recorded no field change" rather than as an empty table.
 */
export function compareAuditFields(before: AuditSnapshot, after: AuditSnapshot): AuditComparison {
  const left = isSnapshot(before) ? before : null
  const right = isSnapshot(after) ? after : null
  if (left === null && right === null) {
    return NO_COMPARISON
  }

  const fields = [
    ...new Set<string>([...Object.keys(left ?? {}), ...Object.keys(right ?? {})]),
  ].sort()

  const rows = fields.map<FieldComparisonRow>((field) => {
    const beforeValue = member(left, field)
    const afterValue = member(right, field)
    return {
      field,
      before: beforeValue,
      after: afterValue,
      kind: changeKind(beforeValue, afterValue),
    }
  })

  return {
    rows,
    hasSnapshots: true,
    hasChanges: rows.some((row) => row.kind !== 'unchanged'),
  }
}
