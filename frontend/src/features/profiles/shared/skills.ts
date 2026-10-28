/**
 * The Skill_Taxonomy lookup both profile editors suggest from.
 *
 * Requirement 9 AC7 (a Candidate's skill term) and Requirement 10 AC8 (a Senior's
 * expertise skills) are the same read against the same endpoint, so the query and
 * its decoding live here rather than once per slice.
 *
 * ## Why the response is decoded defensively
 *
 * `GET /api/v1/skills` is declared in the OpenAPI document as
 * `Record<string, unknown>[]` — the Backend_Api returns a list of taxonomy rows
 * with no named response schema, so the generated declarations carry no member
 * names to read. That is a contract fact, not an oversight to route around: the
 * typed request is still issued against the generated path, and the shape of each
 * row is resolved here, once, by {@link toSkillSuggestion}.
 *
 * A row that carries no readable name is dropped rather than rendered as an empty
 * suggestion, and duplicate names collapse to one entry, so the control never
 * offers a choice that means nothing or two choices that mean the same thing.
 *
 * Suggestions never constrain the entered value: both requirements accept a
 * free-text term, so the caller treats this list as a hint and submits whatever
 * the user typed.
 */

import type { ApiClient } from '../../../api/client'

/** The generated path of the taxonomy search. */
export const SKILLS_PATH = '/api/v1/skills'

/** Root of the TanStack Query key space for taxonomy searches. */
export const SKILLS_QUERY_KEY_ROOT = ['profiles', 'skills'] as const

/**
 * Shortest term worth querying for.
 *
 * A one-character term already narrows the taxonomy usefully, and AC7 ties the
 * query to "enters text" rather than to a length, so the only excluded case is
 * the empty term — which would ask the Backend_Api for the whole taxonomy on
 * every focus.
 */
export const MIN_SKILL_QUERY_LENGTH = 1

/** The upper bound the Backend_Api documents for one taxonomy search. */
export const MAX_SKILL_SUGGESTIONS = 20

/** Query key of one taxonomy search. */
export function skillsQueryKey(term: string): readonly unknown[] {
  return [...SKILLS_QUERY_KEY_ROOT, term]
}

/** One taxonomy entry offered as a suggestion. */
export interface SkillSuggestion {
  /** Canonical skill name, as the taxonomy spells it. Rendered byte-identically. */
  readonly name: string
  /** Taxonomy identifier when the row carried one; the term is what is submitted. */
  readonly id: string | null
}

function readString(row: Record<string, unknown>, member: string): string | null {
  const value = row[member]
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed === '' ? null : value
}

/**
 * Reads one taxonomy row, or `null` when it carries no usable name.
 *
 * `name` is what the taxonomy uses today; `term` and `label` are accepted because
 * the row shape is not pinned by the contract and a renamed member must degrade
 * to "no suggestion" rather than to a blank one.
 */
export function toSkillSuggestion(row: unknown): SkillSuggestion | null {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    return null
  }
  const record = row as Record<string, unknown>
  const name = readString(record, 'name') ?? readString(record, 'term') ?? readString(record, 'label')
  if (name === null) {
    return null
  }
  return { name, id: readString(record, 'id') ?? readString(record, 'skill_id') }
}

/** Decodes a taxonomy response into distinct, non-blank suggestions. */
export function toSkillSuggestions(body: unknown): readonly SkillSuggestion[] {
  if (!Array.isArray(body)) {
    return []
  }
  const seen = new Set<string>()
  const suggestions: SkillSuggestion[] = []
  for (const row of body) {
    const suggestion = toSkillSuggestion(row)
    if (suggestion === null || seen.has(suggestion.name)) {
      continue
    }
    seen.add(suggestion.name)
    suggestions.push(suggestion)
  }
  return suggestions
}

/**
 * Whether a term is worth issuing a taxonomy search for (AC7).
 *
 * Trimmed, so whitespace alone is not a search: the user has not entered a term
 * yet.
 */
export function isSearchableSkillTerm(term: string): boolean {
  return term.trim().length >= MIN_SKILL_QUERY_LENGTH
}

/**
 * Searches the Skill_Taxonomy for `term` (Req 9 AC7, Req 10 AC8).
 *
 * Resolves with an empty list for a term that is not searchable, so a caller can
 * call it unconditionally and let the query's `enabled` flag decide whether the
 * request is issued at all.
 */
export async function searchSkills(
  api: ApiClient,
  term: string,
  signal?: AbortSignal,
): Promise<readonly SkillSuggestion[]> {
  if (!isSearchableSkillTerm(term)) {
    return []
  }
  const { data } = await api.request('get', SKILLS_PATH, {
    params: { query: { q: term.trim() } },
    ...(signal === undefined ? {} : { signal }),
  })
  return toSkillSuggestions(data)
}
