/**
 * The Senior profile form model (Requirement 10 AC3–AC9).
 *
 * The conditional behaviours are what this file is about: what the body carries
 * for each Contact_Channel_Preference (AC5, AC9), which combinations are refused
 * before a request is issued (AC4, AC6, AC7), and the bound of the expertise
 * editor (AC8). All of it is pure, so none of it needs a rendered control or a
 * network exchange to assert.
 */

import { describe, expect, it } from 'vitest'

import {
  addExpertiseSkill,
  canAddExpertiseSkill,
  emptySeniorFormValues,
  EXPERTISE_LIMITS,
  removeExpertiseSkill,
  renderedSeniorInputs,
  replaceExpertiseSkill,
  requiresCompanyAffiliation,
  requiresExpertiseSkill,
  showsChatPlaceholder,
  showsContactScope,
  showsEmailContact,
  toSeniorFormValues,
  toSeniorUpdateRequest,
  validateSeniorProfileForm,
  type SeniorProfile,
  type SeniorProfileFormValues,
} from './model'

/** A form with a name, so the required-name rule is not what a case reports. */
function named(patch: Partial<SeniorProfileFormValues> = {}): SeniorProfileFormValues {
  return { ...emptySeniorFormValues(), full_name: 'Dana Levi', ...patch }
}

/** The codes reported for one input path. */
function codesFor(values: SeniorProfileFormValues, path: string): readonly string[] {
  return validateSeniorProfileForm(values)
    .filter((issue) => issue.path === path)
    .map((issue) => issue.code)
}

describe('the Contact_Channel_Preference conditionals (Req 10 AC4, AC5, AC10, AC11)', () => {
  it('presents the scope control for every channel other than None', () => {
    expect(showsContactScope('Chat')).toBe(true)
    expect(showsContactScope('Email')).toBe(true)
    expect(showsContactScope('Both')).toBe(true)
    expect(showsContactScope('None')).toBe(false)
  })

  it('shows the account address for Email and Both only (AC10)', () => {
    expect(showsEmailContact('Email')).toBe(true)
    expect(showsEmailContact('Both')).toBe(true)
    expect(showsEmailContact('Chat')).toBe(false)
    expect(showsEmailContact('None')).toBe(false)
  })

  it('shows the chat notice for Chat and Both only (AC11)', () => {
    expect(showsChatPlaceholder('Chat')).toBe(true)
    expect(showsChatPlaceholder('Both')).toBe(true)
    expect(showsChatPlaceholder('Email')).toBe(false)
    expect(showsChatPlaceholder('None')).toBe(false)
  })

  it('registers the scope input only while it is presented (Req 22 AC9, AC10)', () => {
    const paths = (values: SeniorProfileFormValues) =>
      renderedSeniorInputs(values).map((input) => input.path)

    expect(paths(named({ contact_channel_pref: 'None' }))).toEqual([
      'full_name',
      'company_affiliation',
      'job_title',
      'contact_channel_pref',
    ])
    expect(paths(named({ contact_channel_pref: 'Email' }))).toContain('contact_scope_pref')
  })
})

describe('the request body (Req 10 AC5, AC9)', () => {
  it('omits the scope member while the channel is None', () => {
    const request = toSeniorUpdateRequest(
      named({ contact_channel_pref: 'None', contact_scope_pref: 'SameCompany' }),
    )

    expect(request).not.toHaveProperty('contact_scope_pref')
    expect(request.contact_channel_pref).toBe('None')
  })

  it('carries the scope member once a contactable channel is chosen', () => {
    const request = toSeniorUpdateRequest(
      named({ contact_channel_pref: 'Both', contact_scope_pref: 'OwnPostingsOnly' }),
    )

    expect(request.contact_scope_pref).toBe('OwnPostingsOnly')
  })

  it('sends a cleared optional scalar as an empty string, since null means unchanged', () => {
    const request = toSeniorUpdateRequest(named({ company_affiliation: '  ', job_title: '' }))

    expect(request.company_affiliation).toBe('')
    expect(request.job_title).toBe('')
  })

  it('omits an empty expertise list rather than sending a list the contract refuses', () => {
    expect(toSeniorUpdateRequest(named())).not.toHaveProperty('expertise_skills')
    expect(
      toSeniorUpdateRequest(named({ expertise_skills: [' Kubernetes '] })).expertise_skills,
    ).toEqual(['Kubernetes'])
  })
})

describe('the conditional requirements (Req 10 AC4, AC6, AC7)', () => {
  it('requires a scope once the channel is contactable (AC4)', () => {
    expect(codesFor(named({ contact_channel_pref: 'Email' }), 'contact_scope_pref')).toContain(
      'required',
    )
    expect(codesFor(named({ contact_channel_pref: 'None' }), 'contact_scope_pref')).toEqual([])
  })

  it('requires a company affiliation for SameCompany (AC6)', () => {
    const values = named({ contact_channel_pref: 'Email', contact_scope_pref: 'SameCompany' })

    expect(requiresCompanyAffiliation(values)).toBe(true)
    expect(codesFor(values, 'company_affiliation')).toContain('required')
    expect(
      codesFor({ ...values, company_affiliation: 'Hasoub Labs' }, 'company_affiliation'),
    ).toEqual([])
  })

  it('requires at least one expertise skill for FieldOfExpertise (AC7)', () => {
    const values = named({
      contact_channel_pref: 'Both',
      contact_scope_pref: 'FieldOfExpertise',
    })

    expect(requiresExpertiseSkill(values)).toBe(true)
    expect(codesFor(values, 'expertise_skills')).toContain('too_few_items')
    // A row holding only whitespace is not a skill.
    expect(codesFor({ ...values, expertise_skills: ['  '] }, 'expertise_skills')).toContain(
      'too_few_items',
    )
    expect(codesFor({ ...values, expertise_skills: ['Kubernetes'] }, 'expertise_skills')).toEqual(
      [],
    )
  })

  it('requires neither for OwnPostingsOnly', () => {
    const values = named({ contact_channel_pref: 'Chat', contact_scope_pref: 'OwnPostingsOnly' })

    expect(requiresCompanyAffiliation(values)).toBe(false)
    expect(requiresExpertiseSkill(values)).toBe(false)
    expect(validateSeniorProfileForm(values)).toEqual([])
  })

  it('reports a blank full name rather than sending a name the contract refuses', () => {
    expect(codesFor(emptySeniorFormValues(), 'full_name')).toContain('required')
  })
})

describe('the expertise editor (Req 10 AC8)', () => {
  it('accepts between 1 and 10 skills', () => {
    expect(EXPERTISE_LIMITS).toEqual({ minItems: 1, maxItems: 10 })
  })

  it('refuses to add past the bound', () => {
    let values = named()
    for (let index = 0; index < EXPERTISE_LIMITS.maxItems; index += 1) {
      values = addExpertiseSkill(values)
    }

    expect(values.expertise_skills).toHaveLength(EXPERTISE_LIMITS.maxItems)
    expect(canAddExpertiseSkill(values)).toBe(false)
    expect(addExpertiseSkill(values)).toBe(values)
  })

  it('edits and drops one row while keeping every other entered term', () => {
    const values = named({ expertise_skills: ['Kubernetes', 'Terraform'] })

    expect(replaceExpertiseSkill(values, 1, 'Kafka').expertise_skills).toEqual([
      'Kubernetes',
      'Kafka',
    ])
    expect(removeExpertiseSkill(values, 0).expertise_skills).toEqual(['Terraform'])
    // An index addressing nothing changes nothing.
    expect(removeExpertiseSkill(values, 7)).toBe(values)
  })

  it('lets the first row answer for a violation reported against the collection', () => {
    const inputs = renderedSeniorInputs(named({ expertise_skills: ['Kubernetes', 'Kafka'] }))

    expect(inputs.find((input) => input.path === 'expertise_skills.0')?.aliases).toEqual([
      'expertise_skills',
    ])
    expect(inputs.find((input) => input.path === 'expertise_skills.1')?.aliases).toBeUndefined()
  })
})

describe('loading a persisted profile (Req 10 AC1)', () => {
  const profile: SeniorProfile = {
    id: 'p-1',
    account_id: 'a-1',
    full_name: 'أمين حسّان',
    company_affiliation: null,
    job_title: null,
    contact_channel_pref: 'Both',
    contact_scope_pref: 'FieldOfExpertise',
    expertise_skills: ['Kubernetes'],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  }

  it('carries every value across verbatim and reads absent scalars as empty', () => {
    expect(toSeniorFormValues(profile)).toEqual({
      full_name: 'أمين حسّان',
      company_affiliation: '',
      job_title: '',
      contact_channel_pref: 'Both',
      contact_scope_pref: 'FieldOfExpertise',
      expertise_skills: ['Kubernetes'],
    })
  })

  it('opens an empty form for a profile that does not exist yet', () => {
    expect(toSeniorFormValues(null)).toEqual(emptySeniorFormValues())
  })
})
