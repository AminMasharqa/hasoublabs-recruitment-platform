/**
 * The Candidate profile form model (Requirement 9 AC3–AC6, AC8, AC11).
 *
 * The bounds of the four repeatable collections are asserted here rather than by
 * clicking an add control twenty times, and the request mapping is asserted on the
 * body rather than on a network exchange — both are pure functions, and both are
 * what the editor's behaviour reduces to.
 */

import { describe, expect, it } from 'vitest'

import {
  addEntry,
  canAddEntry,
  COLLECTION_LIMITS,
  emptyFormValues,
  parseIntegerInput,
  removeEntry,
  renderedInputs,
  toUpdateRequest,
  validateCandidateProfileForm,
  type CandidateProfileFormValues,
  type CollectionName,
} from './model'

const COLLECTIONS: readonly CollectionName[] = ['education', 'work_experience', 'skills', 'languages']

/** A form filled to the bound of one collection. */
function filledToLimit(collection: CollectionName): CandidateProfileFormValues {
  let values = emptyFormValues()
  for (let index = 0; index < COLLECTION_LIMITS[collection]; index += 1) {
    values = addEntry(values, collection)
  }
  return values
}

describe('the collection bounds (Req 9 AC3–AC6)', () => {
  it('declares 20 education, 20 work-experience, 20 skill and 10 language entries', () => {
    expect(COLLECTION_LIMITS).toEqual({
      education: 20,
      work_experience: 20,
      skills: 20,
      languages: 10,
    })
  })

  it.each(COLLECTIONS)('refuses to add past the bound of %s', (collection) => {
    const atLimit = filledToLimit(collection)

    expect(atLimit[collection]).toHaveLength(COLLECTION_LIMITS[collection])
    expect(canAddEntry(atLimit, collection)).toBe(false)
    expect(addEntry(atLimit, collection)).toBe(atLimit)
  })

  it('drops one entry and keeps every other entered value', () => {
    let values = addEntry(addEntry(emptyFormValues(), 'skills'), 'skills')
    values = {
      ...values,
      skills: [
        { term: 'Kubernetes', years_experience: '4' },
        { term: 'Terraform', years_experience: '' },
      ],
    }

    expect(removeEntry(values, 'skills', 0).skills).toEqual([
      { term: 'Terraform', years_experience: '' },
    ])
  })
})

describe('the request body (Req 9 AC8)', () => {
  it('sends every core field and every sub-collection, clearing blanks with null', () => {
    const request = toUpdateRequest(emptyFormValues())

    expect(request).toEqual({
      full_name: null,
      email: null,
      phone: null,
      city: null,
      summary: null,
      linkedin_url: null,
      education: [],
      work_experience: [],
      skills: [],
      languages: [],
    })
  })

  it('reports a year that is not an integer rather than discarding it', () => {
    expect(parseIntegerInput('')).toBeNull()
    expect(parseIntegerInput(' 2019 ')).toBe(2019)
    expect(parseIntegerInput('20x9')).toBeNaN()
  })
})

describe('the rendered-input registry (Req 9 AC11)', () => {
  it('registers an indexed path per member of each present entry, in rendering order', () => {
    const values: CandidateProfileFormValues = {
      ...emptyFormValues(),
      education: [
        {
          institution: 'Technion',
          degree: 'BSc',
          field_of_study: '',
          enrolment_status: 'Graduated',
          start_year: '2015',
          end_year: '2019',
        },
      ],
    }
    const paths = renderedInputs(values).map((input) => input.path)

    expect(paths.slice(0, 6)).toEqual([
      'full_name',
      'email',
      'phone',
      'city',
      'summary',
      'linkedin_url',
    ])
    expect(paths).toContain('education.0.end_year')
    // The collection's first member also answers for a violation reported against
    // the bare collection path.
    expect(renderedInputs(values).find((input) => input.path === 'education.0.institution')?.aliases).toEqual([
      'education',
    ])
  })

  it('reports an end year before its start year against the entry index (Req 22 AC6)', () => {
    const values: CandidateProfileFormValues = {
      ...emptyFormValues(),
      education: [
        {
          institution: 'Technion',
          degree: 'BSc',
          field_of_study: '',
          enrolment_status: 'Graduated',
          start_year: '2019',
          end_year: '2015',
        },
      ],
    }

    const paths = validateCandidateProfileForm(values).map((issue) => issue.path)
    expect(paths.some((path) => path.includes('0') && path.includes('end_year'))).toBe(true)
  })
})
