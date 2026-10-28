/**
 * The registration form's values, request body, endpoint mapping, input registry
 * and validation (Requirement 6 AC2, AC4, AC5, AC6, AC7, AC14).
 *
 * The role assertions are the interesting ones: AC2 forbids a role selection
 * control, and what makes that structural is that the role reaches the body and
 * the endpoint from the validated Registration_Link alone. Both are asserted here
 * against a target the form cannot influence.
 */

import { describe, expect, it } from 'vitest'

import {
  addressPartPath,
  initialRegistrationValues,
  registrationEndpoint,
  renderedRegistrationInputs,
  REGISTRATION_PATHS,
  toRegistrationRequest,
  validateRegistrationValues,
  type RegistrationFormValues,
  type RegistrationTarget,
} from './registrationFormModel'
import { EMPTY_ADDRESS_PROOF_PARTS } from './residencyProof'

const CANDIDATE_TARGET: RegistrationTarget = { role: 'CANDIDATE', token: 'link-token' }

/** A form filled in well enough to pass the client-side bounds. */
function filled(overrides: Partial<RegistrationFormValues> = {}): RegistrationFormValues {
  return {
    ...initialRegistrationValues('en'),
    full_name: 'Dana Cohen',
    email: 'dana@example.com',
    password: 'a long enough passphrase',
    residency_proof_type: 'MobilePhone',
    residency_proof_value: '+972500000000',
    ...overrides,
  }
}

describe('the initial values (AC4)', () => {
  it('starts in the Locale the screen is being read in, and empty otherwise', () => {
    const values = initialRegistrationValues('ar')

    expect(values.language_preference).toBe('ar')
    expect(values.full_name).toBe('')
    expect(values.email).toBe('')
    expect(values.password).toBe('')
    expect(values.residency_proof_value).toBe('')
    expect(values.residency_address).toEqual(EMPTY_ADDRESS_PROOF_PARTS)
  })

  it('has no role member to hold a selection (AC2)', () => {
    expect(Object.keys(initialRegistrationValues('en'))).not.toContain('role')
  })
})

describe('the request body (AC6, AC7)', () => {
  it('takes the role and the token from the validated link, not from the values', () => {
    const body = toRegistrationRequest(filled(), { role: 'SENIOR', token: 'issued-token' })

    expect(body.role).toBe('SENIOR')
    expect(body.link_token).toBe('issued-token')
  })

  it('trims the free-text values but never the password', () => {
    const body = toRegistrationRequest(
      filled({ full_name: '  Dana Cohen  ', email: ' dana@example.com ', password: '  pass phrase  ' }),
      CANDIDATE_TARGET,
    )

    expect(body.full_name).toBe('Dana Cohen')
    expect(body.email).toBe('dana@example.com')
    expect(body.password).toBe('  pass phrase  ')
  })

  it('submits the composed address as the single residency_proof_value (AC5)', () => {
    const body = toRegistrationRequest(
      filled({
        residency_proof_type: 'Address',
        residency_address: { street: 'Herzl', number: '12', city: 'Haifa', country: 'Israel' },
      }),
      CANDIDATE_TARGET,
    )

    expect(body.residency_proof_type).toBe('Address')
    expect(body.residency_proof_value).toBe('Herzl 12, Haifa, Israel')
  })

  it('submits the single typed value for a non-Address proof (AC4)', () => {
    const body = toRegistrationRequest(filled(), CANDIDATE_TARGET)
    expect(body.residency_proof_value).toBe('+972500000000')
  })
})

describe('the endpoint the role selects (AC6, AC7)', () => {
  it('posts a Candidate link to /register/candidate and a Senior link to /register/senior', () => {
    expect(registrationEndpoint('CANDIDATE')).toBe('/api/v1/register/candidate')
    expect(registrationEndpoint('SENIOR')).toBe('/api/v1/register/senior')
    expect(REGISTRATION_PATHS.CANDIDATE).toBe('/api/v1/register/candidate')
    expect(REGISTRATION_PATHS.SENIOR).toBe('/api/v1/register/senior')
  })
})

describe('the rendered-input registry (AC14)', () => {
  it('registers one value input for a non-Address proof', () => {
    const paths = renderedRegistrationInputs('NationalId').map((input) => input.path)

    expect(paths).toEqual([
      'full_name',
      'email',
      'password',
      'language_preference',
      'residency_proof_type',
      'residency_proof_value',
    ])
  })

  it('registers the four address parts and lands a composed-value violation on the first', () => {
    const inputs = renderedRegistrationInputs('Address')
    const paths = inputs.map((input) => input.path)

    expect(paths).toEqual([
      'full_name',
      'email',
      'password',
      'language_preference',
      'residency_proof_type',
      addressPartPath('street'),
      addressPartPath('number'),
      addressPartPath('city'),
      addressPartPath('country'),
    ])
    expect(paths).not.toContain('residency_proof_value')
    const street = inputs.find((input) => input.path === addressPartPath('street'))
    expect(street?.aliases).toEqual(['residency_proof_value'])
  })
})

describe('the client-side bounds', () => {
  it('reports nothing for a complete submission', () => {
    expect(validateRegistrationValues(filled(), CANDIDATE_TARGET)).toEqual([])
  })

  it('addresses each violated member by its contract member name', () => {
    const issues = validateRegistrationValues(
      filled({ full_name: '', email: 'not-an-address', password: 'short' }),
      CANDIDATE_TARGET,
    )
    const paths = issues.map((reported) => reported.path)

    expect(paths).toContain('full_name')
    expect(paths).toContain('email')
    expect(paths).toContain('password')
  })

  it('requires the street, the city and the country of an Address proof, but not the number', () => {
    const issues = validateRegistrationValues(
      filled({ residency_proof_type: 'Address', residency_address: EMPTY_ADDRESS_PROOF_PARTS }),
      CANDIDATE_TARGET,
    )
    const paths = issues.map((reported) => reported.path)

    expect(paths).toContain(addressPartPath('street'))
    expect(paths).toContain(addressPartPath('city'))
    expect(paths).toContain(addressPartPath('country'))
    expect(paths).not.toContain(addressPartPath('number'))
  })

  it('accepts an Address proof with no building number', () => {
    expect(
      validateRegistrationValues(
        filled({
          residency_proof_type: 'Address',
          residency_address: { street: 'Herzl', number: '', city: 'Haifa', country: 'Israel' },
        }),
        CANDIDATE_TARGET,
      ),
    ).toEqual([])
  })

  it('reports a blank link token against the token member, addressing no rendered input', () => {
    const issues = validateRegistrationValues(filled(), { role: 'CANDIDATE', token: '' })
    const paths = issues.map((reported) => reported.path)
    const inputs = renderedRegistrationInputs('MobilePhone').map((input) => input.path)

    expect(paths).toContain('link_token')
    expect(inputs).not.toContain('link_token')
  })
})
