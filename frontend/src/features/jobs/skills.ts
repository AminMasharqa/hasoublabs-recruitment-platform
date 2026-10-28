/**
 * Skill_Taxonomy entries, as `GET /api/v1/skills` returns them, and the
 * identifier-to-name resolution Requirement 12 AC6 asks of the detail view.
 *
 * Pure: decoding and resolution only, so both are testable without a network.
 *
 * ## Why resolution can fail, and why that is not an error
 *
 * `JobDescriptionDTO.required_skill_ids` holds identifiers with no names beside
 * them, and the contract exposes no lookup-by-identifier endpoint — `GET /skills`
 * searches by *term* and returns at most 20 matches. That is Assumption 4 of the
 * requirements, recorded there as a Backend_Api dependency rather than designed
 * around. So the honest model of a required skill is "an identifier, and possibly
 * a name": {@link ResolvedSkill} carries `name: null` when no searched page
 * contained that identifier, and the detail view renders the identifier with a
 * localized note instead of pretending the skill is unknown or omitting it.
 *
 * ## Why the response is decoded defensively
 *
 * The endpoint is declared as `Record<string, unknown>[]` in the generated
 * declarations — it has no response model on the server — so there is no
 * compile-time guarantee about its members. Everything below therefore reads what
 * it needs and drops what it cannot use, rather than trusting a shape the contract
 * does not promise.
 *
 * Requirements: 12.2, 12.6.
 */

/** One Skill_Taxonomy entry, reduced to what the Web_Client renders and sends. */
export interface Skill {
  /** Taxonomy identifier — what the `skills` browse filter is keyed by. */
  readonly id: string
  /** Display name, as the taxonomy holds it. Rendered byte-identically. */
  readonly name: string
}

function readString(source: Record<string, unknown>, member: string): string | null {
  const value = source[member]
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed === '' ? null : value
}

/**
 * Decodes a `GET /skills` body into usable entries.
 *
 * Prefers the taxonomy's `name` and falls back to `normalized_name`, which is the
 * lowercased form the search itself matches against — a lowercased name is a
 * worse label than the canonical one but a much better one than a UUID. An entry
 * without a usable identifier is dropped, because it can be neither selected as a
 * filter nor matched against a Job_Description.
 */
export function decodeSkills(body: unknown): readonly Skill[] {
  if (!Array.isArray(body)) {
    return []
  }
  const skills: Skill[] = []
  for (const entry of body) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      continue
    }
    const record = entry as Record<string, unknown>
    const id = readString(record, 'id')
    if (id === null) {
      continue
    }
    const name = readString(record, 'name') ?? readString(record, 'normalized_name')
    skills.push({ id, name: name ?? id })
  }
  return skills
}

/** Indexes entries by identifier, keeping the first name seen for a duplicate. */
export function skillNameIndex(
  ...sources: readonly (readonly Skill[] | null | undefined)[]
): ReadonlyMap<string, string> {
  const index = new Map<string, string>()
  for (const source of sources) {
    for (const skill of source ?? []) {
      if (!index.has(skill.id)) {
        index.set(skill.id, skill.name)
      }
    }
  }
  return index
}

/** A required skill of a Job_Description: always an identifier, sometimes a name. */
export interface ResolvedSkill {
  readonly id: string
  /** The taxonomy name, or `null` while no searched page has carried it. */
  readonly name: string | null
}

/**
 * Resolves the `required_skill_ids` of a Job_Description against known entries
 * (AC6).
 *
 * Preserves the order the Job_Description listed, drops blanks and duplicates,
 * and leaves an unmatched identifier unresolved rather than omitting it — a
 * required skill that cannot be named is still a required skill, and hiding it
 * would understate what the role asks for.
 */
export function resolveSkills(
  ids: readonly (string | null | undefined)[] | null | undefined,
  names: ReadonlyMap<string, string>,
): readonly ResolvedSkill[] {
  const resolved: ResolvedSkill[] = []
  const seen = new Set<string>()
  for (const raw of ids ?? []) {
    if (typeof raw !== 'string') {
      continue
    }
    const id = raw.trim()
    if (id === '' || seen.has(id)) {
      continue
    }
    seen.add(id)
    resolved.push({ id, name: names.get(id) ?? null })
  }
  return resolved
}

/** Whether every required skill of a Job_Description could be named (AC6). */
export function allSkillsResolved(skills: readonly ResolvedSkill[]): boolean {
  return skills.every((skill) => skill.name !== null)
}
