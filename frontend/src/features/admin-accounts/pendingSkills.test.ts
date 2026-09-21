/**
 * Unit tests for decoding the pending-skill review entries (task 22.1,
 * Requirement 16 AC17).
 *
 * The contract declares this response as an untyped object list, so the decoder is
 * the only thing standing between the screen and whatever the Backend_Api sends.
 */

import { describe, expect, it } from 'vitest'

import { decodePendingSkill, decodePendingSkills } from './pendingSkills'

describe('decodePendingSkill (Req 16 AC17)', () => {
  it('reads the identifier, the raw term, the normalized term and the timestamp', () => {
    expect(
      decodePendingSkill({
        id: 'u1',
        raw_term: 'Kubernetes',
        normalized_term: 'kubernetes',
        skill_id: null,
        pending_review: true,
        created_at: '2025-02-03T10:00:00Z',
      }),
    ).toEqual({
      id: 'u1',
      rawTerm: 'Kubernetes',
      normalizedTerm: 'kubernetes',
      createdAt: '2025-02-03T10:00:00Z',
    })
  })

  it('renders an Arabic term byte-identically', () => {
    const term = 'هندسة البرمجيات'
    expect(decodePendingSkill({ id: 'u1', raw_term: term })?.rawTerm).toBe(term)
  })

  it('falls back to the normalized term when the raw one is missing', () => {
    expect(decodePendingSkill({ id: 'u1', normalized_term: 'golang' })).toEqual({
      id: 'u1',
      rawTerm: 'golang',
      normalizedTerm: 'golang',
      createdAt: null,
    })
  })

  it('falls back to the term as the key when the entry carries no identifier', () => {
    expect(decodePendingSkill({ raw_term: 'Rust' })?.id).toBe('Rust')
  })

  it('rejects an entry that names no term at all', () => {
    expect(decodePendingSkill({ id: 'u1', raw_term: '   ' })).toBeNull()
    expect(decodePendingSkill({ id: 'u1' })).toBeNull()
    expect(decodePendingSkill(null)).toBeNull()
    expect(decodePendingSkill('Rust')).toBeNull()
  })
})

describe('decodePendingSkills (Req 16 AC17)', () => {
  it('keeps the order the Backend_Api returned and drops unusable entries', () => {
    expect(
      decodePendingSkills([
        { id: 'u1', raw_term: 'first' },
        { id: 'u2' },
        { id: 'u3', raw_term: 'second' },
      ]).map((entry) => entry.rawTerm),
    ).toEqual(['first', 'second'])
  })

  it('yields nothing for a body that is not a list', () => {
    expect(decodePendingSkills(null)).toEqual([])
    expect(decodePendingSkills({ items: [] })).toEqual([])
  })
})
