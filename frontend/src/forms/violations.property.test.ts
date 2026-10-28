import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { FieldViolation } from '../api/errors'

import {
  firstAffectedPlacement,
  hasViolations,
  partitionFieldViolations,
  partitionViolations,
  placedViolations,
  violationsForPath,
  type RenderedInput,
} from './violations'

/**
 * A rendered input carrying a registration label, so a shrunk counterexample
 * names the input a violation was expected to land on.
 */
interface TestInput extends RenderedInput {
  readonly key: string
}

// ── Path vocabulary ───────────────────────────────────────────────────────────

/**
 * The shared path vocabulary the generators draw from: one canonical path per
 * field, with every spelling the two sources use to address it.
 *
 * The canonical form is stated here as data rather than computed, so the oracle
 * below never calls the normalizer it is checking. Both index spellings appear —
 * the Backend_Api's bracketed `education[2].start_date` and the client
 * validator's dotted `education.2.end_year` — so a violation reported in one
 * spelling has to find an input registered in the other.
 */
interface FieldSpec {
  /** The single form both spellings address. */
  readonly canonical: string
  /** Spellings that all address {@link canonical}. */
  readonly spellings: readonly string[]
}

const VOCABULARY: readonly FieldSpec[] = [
  { canonical: 'full_name', spellings: ['full_name', ' full_name '] },
  { canonical: 'email', spellings: ['email'] },
  { canonical: 'password', spellings: ['password', 'password.'] },
  { canonical: 'linkedin_url', spellings: ['linkedin_url'] },
  { canonical: 'residency_proof_value', spellings: ['residency_proof_value'] },
  {
    canonical: 'education.0.institution',
    spellings: ['education[0].institution', 'education.0.institution'],
  },
  {
    canonical: 'education.2.start_date',
    spellings: ['education[2].start_date', 'education.2.start_date'],
  },
  {
    canonical: 'education.2.end_year',
    spellings: ['education[2].end_year', 'education.2.end_year'],
  },
  {
    canonical: 'work_experience.1.end_date',
    spellings: ['work_experience[1].end_date', 'work_experience.1.end_date'],
  },
  {
    canonical: 'skills.3.term',
    spellings: ['skills[3].term', 'skills.3.term', "skills[3]['term']"],
  },
  {
    canonical: 'languages.0.level',
    spellings: ['languages[0].level', 'languages.0.level'],
  },
  {
    canonical: 'details.skills.0',
    spellings: ["details['skills'][0]", 'details.skills.0'],
  },
]

const SPELLINGS_BY_CANONICAL: ReadonlyMap<string, readonly string[]> = new Map(
  VOCABULARY.map((spec) => [spec.canonical, spec.spellings]),
)

/** Paths that address no field at all: empty, separator-only, bracket-only. */
const UNUSABLE_STRING_PATHS: readonly string[] = ['', ' ', '   ', '.', '...', '[]', '[ ]', '. . .']

/**
 * Unusable paths a violation may carry, including the non-string shapes a
 * malformed `details` element produces. `FieldViolation.path` is typed `string`,
 * so these are cast at the construction site below — the point of generating
 * them is that the partition must place such an element rather than throw.
 */
const UNUSABLE_VIOLATION_PATHS: readonly unknown[] = [
  ...UNUSABLE_STRING_PATHS,
  undefined,
  null,
  42,
  {},
  ['education', 2],
]

/** Canonical paths in the vocabulary that no generated input ever registers. */
const NEVER_RENDERED: readonly string[] = ['unknown_field', 'body.nested.thing', 'audit.0.hash']

// ── Generators ────────────────────────────────────────────────────────────────

/** A path as reported or registered, paired with the field it addresses. */
interface PathDraft {
  /** The spelling handed to the module. */
  readonly reported: unknown
  /** Canonical path it addresses; `''` when it addresses nothing. */
  readonly canonical: string
}

const vocabularyPath: fc.Arbitrary<PathDraft> = fc
  .constantFrom(...VOCABULARY)
  .chain((spec) =>
    fc
      .constantFrom(...spec.spellings)
      .map((spelling) => ({ reported: spelling, canonical: spec.canonical })),
  )

/** A well-formed path addressing a field no form in the vocabulary renders. */
const unrenderedPath: fc.Arbitrary<PathDraft> = fc
  .constantFrom(...NEVER_RENDERED)
  .map((path) => ({ reported: path, canonical: path }))

const unusableInputPath: fc.Arbitrary<PathDraft> = fc
  .constantFrom(...UNUSABLE_STRING_PATHS)
  .map((path) => ({ reported: path, canonical: '' }))

const unusableViolationPath: fc.Arbitrary<PathDraft> = fc
  .constantFrom(...UNUSABLE_VIOLATION_PATHS)
  .map((path) => ({ reported: path, canonical: '' }))

/** What a form registers: mostly a real field, occasionally a broken path. */
const inputPath: fc.Arbitrary<PathDraft> = fc.oneof(
  { weight: 9, arbitrary: vocabularyPath },
  { weight: 1, arbitrary: unusableInputPath },
)

/**
 * What a violation addresses: a field the form may render, a field it certainly
 * does not (AC10), or nothing usable at all.
 */
const violationPath: fc.Arbitrary<PathDraft> = fc.oneof(
  { weight: 6, arbitrary: vocabularyPath },
  { weight: 2, arbitrary: unrenderedPath },
  { weight: 2, arbitrary: unusableViolationPath },
)

interface InputDraft {
  readonly own: PathDraft
  /** Further paths the input answers for, e.g. a composed Residency_Proof. */
  readonly aliases: readonly PathDraft[]
}

const inputDraft: fc.Arbitrary<InputDraft> = fc.record({
  own: inputPath,
  aliases: fc.array(vocabularyPath, { maxLength: 2 }),
})

interface ViolationDraft {
  readonly path: PathDraft
  readonly code: string
  readonly message: string | null
  /** Extra appearances of the *same object reference* in the reported list. */
  readonly repeats: number
}

const violationDraft: fc.Arbitrary<ViolationDraft> = fc.record({
  path: violationPath,
  // A small code set, so two distinct objects often carry identical content:
  // the partition must still keep them apart by reference.
  code: fc.constantFrom('required', 'invalid', 'end_before_start', 'out_of_range'),
  message: fc.oneof(fc.constant(null), fc.constantFrom('قيمة غير صالحة', 'invalid value')),
  repeats: fc.integer({ min: 0, max: 2 }),
})

/** Whether an empty list reaches the module as `[]`, `null` or `undefined`. */
type EmptyShape = 'array' | 'null' | 'undefined'

const emptyShape: fc.Arbitrary<EmptyShape> = fc.constantFrom<EmptyShape>(
  'array',
  'array',
  'array',
  'null',
  'undefined',
)

/** One generated scenario: what the form renders and what the server reported. */
interface PartitionCase {
  /** The rendered inputs, in rendering order. */
  readonly rendered: readonly TestInput[]
  /** Exactly what is passed as the `inputs` argument. */
  readonly inputsArgument: readonly TestInput[] | null | undefined
  /** The reported violations, in reported order, duplicates included. */
  readonly reported: readonly FieldViolation[]
  /** Exactly what is passed as the `violations` argument. */
  readonly violationsArgument: readonly FieldViolation[] | null | undefined
  /** Canonical paths each rendered input claims, aligned with {@link rendered}. */
  readonly claimedByInput: readonly (readonly string[])[]
  /** The field each reported violation addresses, keyed by object identity. */
  readonly canonicalOf: ReadonlyMap<FieldViolation, string>
}

function buildCase(draft: {
  readonly inputDrafts: readonly InputDraft[]
  readonly violationDrafts: readonly ViolationDraft[]
  readonly emptyInputs: EmptyShape
  readonly emptyViolations: EmptyShape
}): PartitionCase {
  const rendered: TestInput[] = draft.inputDrafts.map((input, index) => {
    const key = `input-${index}`
    const path = String(input.own.reported)
    const aliases = input.aliases.map((alias) => String(alias.reported))
    return aliases.length === 0 ? { key, path } : { key, path, aliases }
  })

  const claimedByInput = draft.inputDrafts.map((input) =>
    [input.own.canonical, ...input.aliases.map((alias) => alias.canonical)].filter(
      (canonical) => canonical !== '',
    ),
  )

  const reported: FieldViolation[] = []
  const canonicalOf = new Map<FieldViolation, string>()
  for (const item of draft.violationDrafts) {
    const violation: FieldViolation = {
      // Deliberately unvalidated: a malformed `details` element can carry a
      // non-string `path`, and the partition must place it all the same.
      path: item.path.reported as string,
      code: item.code,
      message: item.message,
    }
    canonicalOf.set(violation, item.path.canonical)
    for (let copy = 0; copy <= item.repeats; copy += 1) {
      // The same reference, so the by-reference guarantee is under test.
      reported.push(violation)
    }
  }

  const asArgument = <T>(
    items: readonly T[],
    shape: EmptyShape,
  ): readonly T[] | null | undefined => {
    if (items.length > 0 || shape === 'array') {
      return items
    }
    return shape === 'null' ? null : undefined
  }

  return {
    rendered,
    inputsArgument: asArgument(rendered, draft.emptyInputs),
    reported,
    violationsArgument: asArgument(reported, draft.emptyViolations),
    claimedByInput,
    canonicalOf,
  }
}

const partitionCase: fc.Arbitrary<PartitionCase> = fc
  .record({
    inputDrafts: fc.array(inputDraft, { maxLength: 6 }),
    violationDrafts: fc.array(violationDraft, { maxLength: 8 }),
    emptyInputs: emptyShape,
    emptyViolations: emptyShape,
  })
  .map(buildCase)

// ── Independent oracle ────────────────────────────────────────────────────────

/** The placement the requirement demands for one affected input. */
interface ExpectedPlacement {
  /** Rendering position of the affected input. */
  readonly index: number
  /** First canonical path the input claims. */
  readonly path: string
  /** Violations attached to it, in reported order, by reference. */
  readonly violations: readonly FieldViolation[]
}

interface ExpectedPartition {
  readonly fields: readonly ExpectedPlacement[]
  readonly formLevel: readonly FieldViolation[]
  /** Rendering position of the input that first claims each canonical path. */
  readonly firstClaimer: ReadonlyMap<string, number>
}

/**
 * The partition stated straight from the requirement, using the canonical path
 * each generated spelling is *known* to address rather than re-normalizing it:
 *
 * - AC9  every reported violation whose field is rendered is attached to that
 *        input, all in one pass.
 * - AC10 every other violation — an unrendered field, an unusable path — goes
 *        to the form-level region.
 *
 * Two inputs claiming one path is a form-authoring mistake; the earliest
 * registration owns it, so the violation still lands on exactly one input.
 */
function expectedPartition(subject: PartitionCase): ExpectedPartition {
  const firstClaimer = new Map<string, number>()
  subject.claimedByInput.forEach((claimed, index) => {
    for (const canonical of claimed) {
      if (!firstClaimer.has(canonical)) {
        firstClaimer.set(canonical, index)
      }
    }
  })

  const buckets = new Map<number, FieldViolation[]>()
  const formLevel: FieldViolation[] = []
  for (const violation of subject.reported) {
    const canonical = subject.canonicalOf.get(violation) ?? ''
    const index = canonical === '' ? undefined : firstClaimer.get(canonical)
    if (index === undefined) {
      formLevel.push(violation)
      continue
    }
    const bucket = buckets.get(index)
    if (bucket === undefined) {
      buckets.set(index, [violation])
    } else {
      bucket.push(violation)
    }
  }

  // Rendering order, not reported order.
  const fields: ExpectedPlacement[] = []
  subject.claimedByInput.forEach((claimed, index) => {
    const violations = buckets.get(index)
    if (violations === undefined || violations.length === 0) {
      return
    }
    fields.push({ index, path: claimed[0] ?? '', violations })
  })

  return { fields, formLevel, firstClaimer }
}

/** Counts occurrences by object identity, so duplicates are not collapsed. */
function countByIdentity<T>(items: readonly T[]): Map<T, number> {
  const counts = new Map<T, number>()
  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1)
  }
  return counts
}

/** Asserts two sequences hold the same objects, in order, by reference. */
function expectSameSequence(
  actual: readonly unknown[],
  expected: readonly unknown[],
  label: string,
): void {
  expect(actual.length, label).toBe(expected.length)
  expected.forEach((item, index) => {
    expect(actual[index], `${label}[${index}]`).toBe(item)
  })
}

describe('Field_Violation partition properties', () => {
  // Feature: frontend-web-application, Property 17: Field_Violation partition is
  // total and placement-correct — For any list of Field_Violations and any set of
  // rendered inputs, each violation is placed exactly once: a violation whose
  // `path` addresses a rendered input is attached to that input, and every other
  // violation is placed in the form-level region; no violation is dropped and
  // none is duplicated.
  //
  // **Validates: Requirements 22.9, 22.10**
  it('places every reported violation exactly once, on its input or at form level', () => {
    fc.assert(
      fc.property(partitionCase, (subject) => {
        const partition = partitionViolations(subject.violationsArgument, subject.inputsArgument)
        const oracle = expectedPartition(subject)

        // Total: as many placements as violations reported, nothing skipped.
        expect(partition.placedCount).toBe(subject.reported.length)
        const acrossFields = partition.fields.reduce(
          (total, placement) => total + placement.violations.length,
          0,
        )
        expect(acrossFields + partition.formLevel.length).toBe(partition.placedCount)

        // Exact: the placed violations are the reported ones, by reference, with
        // repeated references placed once per appearance — nothing dropped, none
        // duplicated, none rewritten.
        const placed = placedViolations(partition)
        expect(placed.length).toBe(subject.reported.length)
        const placedCounts = countByIdentity(placed)
        const reportedCounts = countByIdentity(subject.reported)
        expect(placedCounts.size).toBe(reportedCounts.size)
        for (const [violation, count] of reportedCounts) {
          expect(placedCounts.get(violation)).toBe(count)
        }

        // Placement-correct, and reported in rendering order rather than in the
        // order the server listed the violations.
        expect(partition.fields.length).toBe(oracle.fields.length)
        oracle.fields.forEach((expectation, position) => {
          const placement = partition.fields[position]
          expect(placement, `fields[${position}] missing`).toBeDefined()
          if (placement === undefined) {
            return
          }
          expect(placement.input).toBe(subject.rendered[expectation.index])
          expect(placement.path).toBe(expectation.path)
          expect(placement.violations.length).toBeGreaterThan(0)
          expectSameSequence(
            placement.violations,
            expectation.violations,
            `fields[${position}].violations`,
          )
        })

        // Everything else is form-level (AC10), in reported order.
        expectSameSequence(partition.formLevel, oracle.formLevel, 'formLevel')

        // The derived readers agree with the partition they read.
        expect(hasViolations(partition)).toBe(subject.reported.length > 0)
        expect(firstAffectedPlacement(partition)).toBe(partition.fields[0] ?? null)
        expect(violationsForPath(partition, '')).toEqual([])

        // A placed field is reachable by every spelling of its path.
        oracle.fields.forEach((expectation) => {
          const claimed = subject.claimedByInput[expectation.index] ?? []
          for (const canonical of claimed) {
            if (oracle.firstClaimer.get(canonical) !== expectation.index) {
              continue
            }
            for (const spelling of SPELLINGS_BY_CANONICAL.get(canonical) ?? [canonical]) {
              expectSameSequence(
                violationsForPath(partition, spelling),
                expectation.violations,
                `violationsForPath(${spelling})`,
              )
            }
          }
        })

        // The server-bound entry point partitions identically.
        expect(partitionFieldViolations(subject.violationsArgument, subject.inputsArgument)).toEqual(
          partition,
        )
      }),
      { numRuns: 1000 },
    )
  })
})
