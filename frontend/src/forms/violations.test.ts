import { beforeEach, describe, expect, it } from 'vitest'

import type { FieldViolation } from '../api/errors'
import type { ValidationIssue } from './validators'

import {
  EMPTY_PARTITION,
  describeField,
  firstAffectedPlacement,
  focusFirstAffectedInput,
  hasViolations,
  inputElementId,
  isSamePath,
  mergeDescribedBy,
  normalizePath,
  parsePath,
  partitionFieldViolations,
  partitionViolations,
  pathToElementId,
  placedViolations,
  violationMessageId,
  violationsForPath,
  type RenderedInput,
} from './violations'

function violation(path: string, code = 'invalid'): FieldViolation {
  return { path, code, message: null }
}

const CANDIDATE_INPUTS: readonly RenderedInput[] = [
  { path: 'full_name' },
  { path: 'education.0.institution' },
  { path: 'education.2.start_date' },
]

describe('parsePath', () => {
  it('reads bracketed and dotted indices into the same segments', () => {
    expect(parsePath('education[2].start_date')).toEqual(['education', '2', 'start_date'])
    expect(parsePath('education.2.start_date')).toEqual(['education', '2', 'start_date'])
  })

  it('drops empty and whitespace-only segments', () => {
    expect(parsePath('education..2.[ ].end_year')).toEqual(['education', '2', 'end_year'])
  })

  it('strips a surrounding quote pair from a bracketed segment', () => {
    expect(parsePath("details['skills'][0]")).toEqual(['details', 'skills', '0'])
  })

  it('yields no segment for an unusable path', () => {
    expect(parsePath('')).toEqual([])
    expect(parsePath('...')).toEqual([])
    expect(parsePath(undefined)).toEqual([])
    expect(parsePath(42)).toEqual([])
  })
})

describe('normalizePath', () => {
  it('reconciles the server and client spellings of the same field', () => {
    expect(normalizePath('education[2].start_date')).toBe('education.2.start_date')
    expect(normalizePath('education.2.end_year')).toBe('education.2.end_year')
    expect(isSamePath('education[2].end_year', 'education.2.end_year')).toBe(true)
  })

  it('is idempotent', () => {
    const once = normalizePath('work_experience[0].end_date')
    expect(normalizePath(once)).toBe(once)
  })

  it('never reports an unusable path as equal to anything', () => {
    expect(isSamePath('', '')).toBe(false)
    expect(normalizePath(null)).toBe('')
  })
})

describe('partitionViolations', () => {
  it('attaches matched paths to their input and sends the rest to the form level', () => {
    const violations = [
      violation('full_name', 'too_long'),
      violation('education[2].start_date', 'end_before_start'),
      violation('residency_proof_value', 'invalid_proof'),
    ]

    const partition = partitionFieldViolations(violations, CANDIDATE_INPUTS)

    expect(partition.fields).toEqual([
      { input: { path: 'full_name' }, path: 'full_name', violations: [violations[0]] },
      {
        input: { path: 'education.2.start_date' },
        path: 'education.2.start_date',
        violations: [violations[1]],
      },
    ])
    expect(partition.formLevel).toEqual([violations[2]])
  })

  it('places every violation exactly once', () => {
    const violations = [
      violation('full_name'),
      violation('full_name', 'required'),
      violation('nowhere'),
      violation('education[0].institution'),
    ]

    const partition = partitionFieldViolations(violations, CANDIDATE_INPUTS)

    expect(partition.placedCount).toBe(violations.length)
    expect(placedViolations(partition)).toHaveLength(violations.length)
    expect(new Set(placedViolations(partition)).size).toBe(violations.length)
    for (const entry of violations) {
      expect(placedViolations(partition)).toContain(entry)
    }
  })

  it('renders all violations of one input simultaneously, in reported order', () => {
    const first = violation('full_name', 'too_long')
    const second = violation('full_name', 'forbidden_character')

    const partition = partitionFieldViolations([first, second], CANDIDATE_INPUTS)

    expect(partition.fields).toHaveLength(1)
    expect(partition.fields[0]?.violations).toEqual([first, second])
  })

  it('reports affected inputs in rendering order, not reported order', () => {
    const partition = partitionFieldViolations(
      [violation('education[2].start_date'), violation('full_name')],
      CANDIDATE_INPUTS,
    )

    expect(partition.fields.map((placement) => placement.path)).toEqual([
      'full_name',
      'education.2.start_date',
    ])
    expect(firstAffectedPlacement(partition)?.path).toBe('full_name')
  })

  it('sends an absent, empty or unparseable path to the form level', () => {
    const odd = [
      violation(''),
      violation('...'),
      { path: undefined, code: 'weird', message: null } as unknown as FieldViolation,
    ]

    const partition = partitionFieldViolations(odd, CANDIDATE_INPUTS)

    expect(partition.fields).toEqual([])
    expect(partition.formLevel).toEqual(odd)
  })

  it('places a violation on an input that claims the path as an alias', () => {
    const inputs: readonly RenderedInput[] = [
      { path: 'street', aliases: ['residency_proof_value'] },
      { path: 'city' },
    ]

    const partition = partitionFieldViolations([violation('residency_proof_value')], inputs)

    expect(partition.fields).toHaveLength(1)
    expect(partition.fields[0]?.input.path).toBe('street')
    expect(partition.formLevel).toEqual([])
  })

  it('places a duplicated path on the first input that claims it', () => {
    const inputs: readonly RenderedInput[] = [{ path: 'email', id: 'first' }, { path: 'email' }]

    const partition = partitionFieldViolations([violation('email')], inputs)

    expect(partition.fields).toHaveLength(1)
    expect(partition.fields[0]?.input.id).toBe('first')
  })

  it('handles an empty violation list and an empty input registry', () => {
    expect(partitionFieldViolations([], CANDIDATE_INPUTS)).toEqual(EMPTY_PARTITION)
    expect(hasViolations(partitionFieldViolations([], []))).toBe(false)

    const orphaned = [violation('full_name')]
    const partition = partitionFieldViolations(orphaned, [])
    expect(partition.formLevel).toEqual(orphaned)
    expect(hasViolations(partition)).toBe(true)
  })

  it('tolerates an absent violation list and an absent registry', () => {
    expect(partitionFieldViolations(null, null)).toEqual(EMPTY_PARTITION)
    expect(partitionFieldViolations(undefined, CANDIDATE_INPUTS)).toEqual(EMPTY_PARTITION)
  })

  it('places client-side ValidationIssues through the same mapper', () => {
    const issue: ValidationIssue = {
      path: 'education.2.end_year',
      code: 'end_before_start',
      messageKey: 'validation.dateRangeOrder',
    }

    const partition = partitionViolations([issue], [{ path: 'education[2].end_year' }])

    expect(partition.fields[0]?.violations).toEqual([issue])
  })

  it('looks a placement up by either path spelling', () => {
    const entry = violation('education[2].start_date')
    const partition = partitionFieldViolations([entry], CANDIDATE_INPUTS)

    expect(violationsForPath(partition, 'education[2].start_date')).toEqual([entry])
    expect(violationsForPath(partition, 'education.2.start_date')).toEqual([entry])
    expect(violationsForPath(partition, 'full_name')).toEqual([])
    expect(violationsForPath(partition, '')).toEqual([])
  })
})

describe('accessible description wiring', () => {
  it('derives id-safe element ids from a path', () => {
    expect(pathToElementId('education[2].start_date')).toBe('education-2-start_date')
    expect(pathToElementId('')).toBe('field')
    expect(inputElementId({ path: 'full_name' })).toBe('full_name')
    expect(inputElementId({ path: 'full_name', id: 'profile-name' })).toBe('profile-name')
    expect(violationMessageId({ path: 'full_name' })).toBe('full_name-violation')
  })

  it('associates the message with the input and keeps existing descriptions', () => {
    const described = describeField({ path: 'password' }, 'password-hint')

    expect(described.inputId).toBe('password')
    expect(described.messageId).toBe('password-violation')
    expect(described.inputProps).toEqual({
      id: 'password',
      'aria-invalid': true,
      'aria-describedby': 'password-hint password-violation',
    })
  })

  it('merges describedby tokens without duplicates or blanks', () => {
    expect(mergeDescribedBy('a  b', ['b', 'c'], null, undefined, '')).toBe('a b c')
    expect(mergeDescribedBy(null, '   ')).toBeUndefined()
  })
})

describe('focusFirstAffectedInput', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  function render(html: string): HTMLElement {
    const root = document.createElement('div')
    root.innerHTML = html
    document.body.append(root)
    return root
  }

  it('moves focus to the first affected input', () => {
    const root = render(
      '<input id="full_name" /><input id="education-2-start_date" />',
    )
    const partition = partitionFieldViolations(
      [violation('education[2].start_date'), violation('full_name')],
      CANDIDATE_INPUTS,
    )

    const focused = focusFirstAffectedInput(partition, { root })

    expect(focused?.id).toBe('full_name')
    expect(document.activeElement).toBe(root.querySelector('#full_name'))
  })

  it('delegates a registered group to its first focusable descendant', () => {
    const root = render('<fieldset id="skills"><input id="skills-0" /></fieldset>')
    const partition = partitionFieldViolations([violation('skills')], [{ path: 'skills' }])

    const focused = focusFirstAffectedInput(partition, { root })

    expect(focused?.id).toBe('skills-0')
  })

  it('moves no focus when only the form-level region carries messages', () => {
    const root = render('<input id="full_name" />')
    const partition = partitionFieldViolations([violation('unrendered')], CANDIDATE_INPUTS)

    expect(focusFirstAffectedInput(partition, { root })).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })

  it('returns null when the affected input is not in the document', () => {
    const root = render('<div></div>')
    const partition = partitionFieldViolations([violation('full_name')], CANDIDATE_INPUTS)

    expect(focusFirstAffectedInput(partition, { root })).toBeNull()
  })

  it('accepts a caller-supplied element resolver', () => {
    const element = document.createElement('input')
    document.body.append(element)
    const partition = partitionFieldViolations([violation('full_name')], CANDIDATE_INPUTS)

    expect(focusFirstAffectedInput(partition, { resolve: () => element })).toBe(element)
    expect(document.activeElement).toBe(element)
  })
})
