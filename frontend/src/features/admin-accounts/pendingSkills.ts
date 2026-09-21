/**
 * Decoding the pending-skill review entries of `GET /api/v1/admin/skills/pending`
 * (Requirement 16 AC17).
 *
 * The contract declares this response as an untyped `Record<string, unknown>[]`,
 * so the generated declarations offer nothing to read a member off. Rather than
 * cast that into a hand-written interface — which would be the silent drift
 * Requirement 2 AC7 exists to prevent, only without the typecheck that catches
 * it — every member is read defensively here and an entry that carries no usable
 * term is dropped.
 *
 * Dropping rather than rendering a blank row is deliberate: the review list exists
 * so an Admin can act on unmatched terms, and an entry with no term is not
 * something to act on.
 *
 * Pure: no React, no Api_Client.
 *
 * Requirements: 16.17.
 */

/** One unmatched skill term awaiting taxonomy review. */
export interface PendingSkill {
  /** Identifier of the unmatched-term record. */
  readonly id: string
  /** The term as it was entered, rendered verbatim (Req 19 AC10). */
  readonly rawTerm: string
  /** The normalized form the taxonomy matched against, when the entry carries one. */
  readonly normalizedTerm: string | null
  /** When the term was recorded, as an ISO-8601 instant, when the entry carries one. */
  readonly createdAt: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A non-blank string member, or `null`. */
function text(source: Record<string, unknown>, member: string): string | null {
  const value = source[member]
  if (typeof value === 'string' && value.trim() !== '') {
    return value
  }
  return null
}

/**
 * Decodes one entry, or `null` when it carries neither an identifier nor a term.
 *
 * The identifier falls back to the raw term so a list can still be keyed and
 * rendered when the Backend_Api omits `id`.
 */
export function decodePendingSkill(value: unknown): PendingSkill | null {
  if (!isRecord(value)) {
    return null
  }
  const rawTerm = text(value, 'raw_term') ?? text(value, 'normalized_term')
  if (rawTerm === null) {
    return null
  }
  return {
    id: text(value, 'id') ?? rawTerm,
    rawTerm,
    normalizedTerm: text(value, 'normalized_term'),
    createdAt: text(value, 'created_at'),
  }
}

/** Decodes the review list, in the order the Backend_Api returned it. */
export function decodePendingSkills(value: unknown): readonly PendingSkill[] {
  if (!Array.isArray(value)) {
    return []
  }
  const entries: PendingSkill[] = []
  for (const candidate of value) {
    const entry = decodePendingSkill(candidate)
    if (entry !== null) {
      entries.push(entry)
    }
  }
  return entries
}
