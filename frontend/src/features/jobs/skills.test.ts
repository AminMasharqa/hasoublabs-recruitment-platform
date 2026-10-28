/**
 * Unit tests for Skill_Taxonomy decoding and required-skill resolution
 * (Requirement 12 AC2, AC6).
 *
 * The endpoint has no response model on the server, so the decoding has to be
 * defensive; and the contract offers no lookup by identifier, so resolution has to
 * report "unresolved" rather than dropping a required skill (Assumption 4).
 */

import { describe, expect, it } from 'vitest'

import { allSkillsResolved, decodeSkills, resolveSkills, skillNameIndex } from './skills'

describe('decoding GET /skills (AC2)', () => {
  it('keeps entries with an identifier and prefers the canonical name', () => {
    expect(
      decodeSkills([
        { id: 's-1', name: 'TypeScript', normalized_name: 'typescript' },
        { id: 's-2', normalized_name: 'kubernetes' },
        { id: 's-3' },
      ]),
    ).toEqual([
      { id: 's-1', name: 'TypeScript' },
      { id: 's-2', name: 'kubernetes' },
      // No name at all: the identifier is the only label available.
      { id: 's-3', name: 's-3' },
    ])
  })

  it('drops what cannot be used and tolerates a body that is not a list', () => {
    expect(decodeSkills([{ name: 'no identifier' }, null, 'text', []])).toEqual([])
    expect(decodeSkills({ items: [] })).toEqual([])
    expect(decodeSkills(undefined)).toEqual([])
  })
})

describe('resolving the required skills of a Job_Description (AC6)', () => {
  const index = skillNameIndex(
    decodeSkills([
      { id: 's-1', name: 'TypeScript' },
      { id: 's-1', name: 'duplicate ignored' },
      { id: 's-2', name: 'עברית' },
    ]),
  )

  it('preserves the declared order, drops duplicates, keeps unnamed identifiers', () => {
    expect(resolveSkills(['s-2', 's-1', 's-2', ' ', 's-9'], index)).toEqual([
      { id: 's-2', name: 'עברית' },
      { id: 's-1', name: 'TypeScript' },
      { id: 's-9', name: null },
    ])
  })

  it('reports whether every required skill could be named', () => {
    expect(allSkillsResolved(resolveSkills(['s-1'], index))).toBe(true)
    expect(allSkillsResolved(resolveSkills(['s-1', 's-9'], index))).toBe(false)
    expect(resolveSkills(null, index)).toEqual([])
  })
})
