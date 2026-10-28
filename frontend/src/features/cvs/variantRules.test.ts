/**
 * Unit tests for the CV_Variant decisions (task 17.1).
 *
 * Requirement 11:
 * - AC2 the name and description bounds a create or edit submission must satisfy.
 * - AC3 the create refusal at five active variants, and the reason it names.
 * - AC4 a `PATCH` body carrying the changed members and nothing else.
 * - AC6 the archive refusal while one active variant is left.
 * - AC7 exactly one variant resolved as primary, whatever the payload claims.
 *
 * Every assertion here is over a plain array: these are the decisions the screens
 * delegate, so they are checked without a renderer, a query cache or a request.
 */

import { describe, expect, it } from 'vitest'

import {
  activeVariants,
  applyPrimary,
  archiveBlockedReason,
  canArchiveVariant,
  canCreateVariant,
  canSetPrimary,
  changedVariantFields,
  countActiveVariants,
  createBlockedReason,
  createBodyFrom,
  draftFromVariant,
  findVariant,
  hasVariantChanges,
  isRenderedPrimary,
  MAX_ACTIVE_VARIANTS,
  orderVariantsForDisplay,
  primaryVariantId,
  replaceVariant,
  validateVariantDraft,
  VARIANT_DESCRIPTION_BOUNDS,
  VARIANT_NAME_BOUNDS,
  type CvVariant,
} from './variantRules'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function variant(overrides: Partial<CvVariant> & Pick<CvVariant, 'id'>): CvVariant {
  return {
    name: `Variant ${overrides.id}`,
    description: null,
    is_primary: false,
    is_archived: false,
    version_count: 0,
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

/** `count` active variants, the first of them primary. */
function activeList(count: number): CvVariant[] {
  return Array.from({ length: count }, (_unused, index) =>
    variant({
      id: `v${index + 1}`,
      is_primary: index === 0,
      created_at: `2025-01-0${index + 1}T00:00:00Z`,
    }),
  )
}

// ── The list ──────────────────────────────────────────────────────────────────

describe('the variant list (Req 11 AC1)', () => {
  it('counts only the variants that are not archived', () => {
    const variants = [...activeList(2), variant({ id: 'v9', is_archived: true })]
    expect(countActiveVariants(variants)).toBe(2)
    expect(activeVariants(variants).map((entry) => entry.id)).toEqual(['v1', 'v2'])
  })

  it('treats an absent list as empty rather than failing', () => {
    expect(countActiveVariants(null)).toBe(0)
    expect(countActiveVariants(undefined)).toBe(0)
    expect(activeVariants(null)).toEqual([])
    expect(findVariant(null, 'v1')).toBeNull()
  })

  it('finds a variant by identifier and reports a miss as null', () => {
    const variants = activeList(2)
    expect(findVariant(variants, 'v2')?.id).toBe('v2')
    expect(findVariant(variants, 'absent')).toBeNull()
    expect(findVariant(variants, '')).toBeNull()
    expect(findVariant(variants, undefined)).toBeNull()
  })

  it('keeps archived variants in the list but orders them last', () => {
    const variants = [
      variant({ id: 'archived', is_archived: true, created_at: '2024-01-01T00:00:00Z' }),
      variant({ id: 'newer', created_at: '2025-06-01T00:00:00Z' }),
      variant({ id: 'older', created_at: '2025-01-01T00:00:00Z' }),
    ]
    expect(orderVariantsForDisplay(variants).map((entry) => entry.id)).toEqual([
      'older',
      'newer',
      'archived',
    ])
  })

  it('leaves the argument untouched when ordering', () => {
    const variants = [variant({ id: 'b' }), variant({ id: 'a' })]
    const snapshot = variants.map((entry) => entry.id)
    orderVariantsForDisplay(variants)
    expect(variants.map((entry) => entry.id)).toEqual(snapshot)
  })

  it('does not reorder the list when the primary designation moves (AC7)', () => {
    const variants = activeList(3)
    const before = orderVariantsForDisplay(variants).map((entry) => entry.id)
    const after = orderVariantsForDisplay(applyPrimary(variants, 'v3')).map((entry) => entry.id)
    expect(after).toEqual(before)
  })
})

// ── Create (AC2, AC3) ─────────────────────────────────────────────────────────

describe('the create refusal at the variant limit (Req 11 AC3)', () => {
  it('permits a create below the limit', () => {
    for (let count = 0; count < MAX_ACTIVE_VARIANTS; count += 1) {
      expect(canCreateVariant(activeList(count))).toBe(true)
      expect(createBlockedReason(activeList(count))).toBeNull()
    }
  })

  it('refuses a create at the limit and names the limit as the reason', () => {
    const variants = activeList(MAX_ACTIVE_VARIANTS)
    expect(canCreateVariant(variants)).toBe(false)
    expect(createBlockedReason(variants)).toBe('variant_limit')
  })

  it('counts archived variants against no limit, so archiving frees a slot', () => {
    const variants = [
      ...activeList(MAX_ACTIVE_VARIANTS - 1),
      variant({ id: 'archived-1', is_archived: true }),
      variant({ id: 'archived-2', is_archived: true }),
    ]
    expect(canCreateVariant(variants)).toBe(true)
  })

  it('mirrors the Backend_Api limit rather than restating it', () => {
    expect(MAX_ACTIVE_VARIANTS).toBe(5)
  })
})

describe('the create and edit bounds (Req 11 AC2)', () => {
  it('accepts a name inside the bounds with no description', () => {
    expect(validateVariantDraft({ name: 'Backend roles', description: '' })).toEqual([])
  })

  it('rejects an empty name', () => {
    const issues = validateVariantDraft({ name: '', description: '' })
    expect(issues.map((issue) => issue.path)).toContain('name')
  })

  it('rejects a name beyond the maximum length', () => {
    const issues = validateVariantDraft({
      name: 'x'.repeat(VARIANT_NAME_BOUNDS.maxLength + 1),
      description: '',
    })
    expect(issues.map((issue) => issue.path)).toEqual(['name'])
  })

  it('rejects a description beyond the maximum length', () => {
    const issues = validateVariantDraft({
      name: 'Backend roles',
      description: 'x'.repeat(VARIANT_DESCRIPTION_BOUNDS.maxLength + 1),
    })
    expect(issues.map((issue) => issue.path)).toEqual(['description'])
  })

  it('omits the description from the create body when it was left empty', () => {
    expect(createBodyFrom({ name: 'Backend roles', description: '' })).toEqual({
      name: 'Backend roles',
    })
  })

  it('submits the entered text byte-identically, including Arabic (Req 19 AC11)', () => {
    const name = 'سيرة للوظائف الخلفية'
    expect(createBodyFrom({ name, description: ' مع مسافة ' })).toEqual({
      name,
      description: ' مع مسافة ',
    })
  })
})

// ── Edit (AC4) ────────────────────────────────────────────────────────────────

describe('the edit body (Req 11 AC4)', () => {
  const current = variant({ id: 'v1', name: 'Backend roles', description: 'Java and Spring' })

  it('opens the draft on the current values, with an absent description as empty text', () => {
    expect(draftFromVariant(current)).toEqual({
      name: 'Backend roles',
      description: 'Java and Spring',
    })
    expect(draftFromVariant(variant({ id: 'v2' })).description).toBe('')
    expect(draftFromVariant(null)).toEqual({ name: '', description: '' })
  })

  it('sends only the changed name', () => {
    expect(
      changedVariantFields(current, { name: 'Platform roles', description: 'Java and Spring' }),
    ).toEqual({ name: 'Platform roles' })
  })

  it('sends only the changed description', () => {
    expect(changedVariantFields(current, { name: 'Backend roles', description: 'Kotlin' })).toEqual({
      description: 'Kotlin',
    })
  })

  it('sends a cleared description as null', () => {
    expect(changedVariantFields(current, { name: 'Backend roles', description: '' })).toEqual({
      description: null,
    })
  })

  it('sends nothing when neither member changed', () => {
    const draft = draftFromVariant(current)
    expect(changedVariantFields(current, draft)).toEqual({})
    expect(hasVariantChanges(current, draft)).toBe(false)
  })

  it('treats an added space as a change rather than trimming it away', () => {
    const draft = { name: 'Backend roles ', description: 'Java and Spring' }
    expect(changedVariantFields(current, draft)).toEqual({ name: 'Backend roles ' })
    expect(hasVariantChanges(current, draft)).toBe(true)
  })
})

// ── Archive (AC5, AC6) ────────────────────────────────────────────────────────

describe('the archive refusal on the last active variant (Req 11 AC6)', () => {
  it('refuses the only active variant and names the reason', () => {
    const variants = activeList(1)
    const only = variants[0] as CvVariant
    expect(canArchiveVariant(only, variants)).toBe(false)
    expect(archiveBlockedReason(only, variants)).toBe('last_active')
  })

  it('refuses the last active variant even beside archived ones', () => {
    const variants = [...activeList(1), variant({ id: 'archived', is_archived: true })]
    expect(archiveBlockedReason(variants[0] as CvVariant, variants)).toBe('last_active')
  })

  it('permits archiving while a second active variant exists', () => {
    const variants = activeList(2)
    expect(canArchiveVariant(variants[0] as CvVariant, variants)).toBe(true)
    expect(archiveBlockedReason(variants[1] as CvVariant, variants)).toBeNull()
  })

  it('reports an already-archived variant as nothing left to archive', () => {
    const archived = variant({ id: 'archived', is_archived: true })
    const variants = [...activeList(2), archived]
    expect(archiveBlockedReason(archived, variants)).toBe('already_archived')
  })

  it('protects the last active variant whether or not it is the primary one', () => {
    const notPrimary = [variant({ id: 'only', is_primary: false })]
    expect(archiveBlockedReason(notPrimary[0] as CvVariant, notPrimary)).toBe('last_active')
  })
})

// ── Primary designation (AC7) ─────────────────────────────────────────────────

describe('exactly one variant renders as primary (Req 11 AC7)', () => {
  it('resolves the flagged active variant', () => {
    const variants = activeList(3)
    expect(primaryVariantId(variants)).toBe('v1')
    expect(isRenderedPrimary(variants[0] as CvVariant, variants)).toBe(true)
    expect(isRenderedPrimary(variants[1] as CvVariant, variants)).toBe(false)
  })

  it('resolves a single primary even when the payload flags two', () => {
    const variants = [
      variant({ id: 'v1', is_primary: true, created_at: '2025-01-01T00:00:00Z' }),
      variant({ id: 'v2', is_primary: true, created_at: '2025-01-02T00:00:00Z' }),
    ]
    expect(variants.filter((entry) => entry.is_primary)).toHaveLength(2)
    expect(primaryVariantId(variants)).toBe('v1')
    expect(variants.filter((entry) => isRenderedPrimary(entry, variants))).toHaveLength(1)
  })

  it('never renders an archived variant as primary', () => {
    const variants = [
      variant({ id: 'archived', is_primary: true, is_archived: true }),
      variant({ id: 'active' }),
    ]
    expect(primaryVariantId(variants)).toBeNull()
    expect(isRenderedPrimary(variants[0] as CvVariant, variants)).toBe(false)
  })

  it('reports no primary for an empty or absent list', () => {
    expect(primaryVariantId([])).toBeNull()
    expect(primaryVariantId(null)).toBeNull()
  })

  it('offers the control only for an active variant that is not already primary', () => {
    const variants = [
      variant({ id: 'v1', is_primary: true }),
      variant({ id: 'v2' }),
      variant({ id: 'v3', is_archived: true }),
    ]
    expect(canSetPrimary(variants[0] as CvVariant, variants)).toBe(false)
    expect(canSetPrimary(variants[1] as CvVariant, variants)).toBe(true)
    expect(canSetPrimary(variants[2] as CvVariant, variants)).toBe(false)
  })

  it('moves the designation onto one variant and clears every other', () => {
    const applied = applyPrimary(activeList(3), 'v3')
    expect(applied.filter((entry) => entry.is_primary).map((entry) => entry.id)).toEqual(['v3'])
    expect(primaryVariantId(applied)).toBe('v3')
  })

  it('leaves exactly one primary even when applied to a list flagging several', () => {
    const variants = [
      variant({ id: 'v1', is_primary: true }),
      variant({ id: 'v2', is_primary: true }),
      variant({ id: 'v3', is_primary: true }),
    ]
    expect(applyPrimary(variants, 'v2').filter((entry) => entry.is_primary)).toHaveLength(1)
  })

  it('does not mutate the list it is given', () => {
    const variants = activeList(2)
    applyPrimary(variants, 'v2')
    expect(variants[0]?.is_primary).toBe(true)
    expect(variants[1]?.is_primary).toBe(false)
  })
})

describe('replaceVariant', () => {
  it('replaces the variant of the same identifier in place', () => {
    const variants = activeList(2)
    const renamed = { ...(variants[1] as CvVariant), name: 'Renamed' }
    const replaced = replaceVariant(variants, renamed)
    expect(replaced.map((entry) => entry.id)).toEqual(['v1', 'v2'])
    expect(findVariant(replaced, 'v2')?.name).toBe('Renamed')
  })

  it('appends a variant the list does not hold yet', () => {
    const replaced = replaceVariant(activeList(1), variant({ id: 'new' }))
    expect(replaced.map((entry) => entry.id)).toEqual(['v1', 'new'])
  })

  it('treats an absent list as empty', () => {
    expect(replaceVariant(undefined, variant({ id: 'new' })).map((entry) => entry.id)).toEqual([
      'new',
    ])
  })
})
