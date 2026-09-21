/**
 * Residency_Proof value composition (Requirement 6 AC4, AC5).
 *
 * The composition format is a Web_Client decision — the contract declares one
 * `residency_proof_value` string and AC5 requires four separate inputs — so it is
 * pinned here rather than left to whatever the form happens to do. The
 * byte-identity assertions are the Requirement 19 AC10/AC11 obligation applied to
 * this composition: an Arabic or Hebrew address is joined, never rewritten.
 */

import { describe, expect, it } from 'vitest'

import {
  ADDRESS_PROOF_PARTS,
  ADDRESS_PROOF_TYPE,
  composeAddressProofValue,
  EMPTY_ADDRESS_PROOF_PARTS,
  isAddressProof,
  residencyProofValue,
  type AddressProofParts,
} from './residencyProof'

function address(parts: Partial<AddressProofParts>): AddressProofParts {
  return { ...EMPTY_ADDRESS_PROOF_PARTS, ...parts }
}

describe('the collected parts (AC5)', () => {
  it('collects street, number, city and country, in that order', () => {
    expect(ADDRESS_PROOF_PARTS).toEqual(['street', 'number', 'city', 'country'])
  })

  it('recognizes only the Address proof type as separately collected', () => {
    expect(isAddressProof(ADDRESS_PROOF_TYPE)).toBe(true)
    expect(isAddressProof('MobilePhone')).toBe(false)
    expect(isAddressProof('NationalId')).toBe(false)
    expect(isAddressProof(undefined)).toBe(false)
  })
})

describe('composing the submitted value (AC5)', () => {
  it('joins the street line, the city and the country', () => {
    expect(
      composeAddressProofValue(
        address({ street: 'Herzl', number: '12', city: 'Haifa', country: 'Israel' }),
      ),
    ).toBe('Herzl 12, Haifa, Israel')
  })

  it('omits a blank part together with its separator', () => {
    expect(
      composeAddressProofValue(address({ street: 'Herzl', city: 'Haifa', country: 'Israel' })),
    ).toBe('Herzl, Haifa, Israel')
    expect(composeAddressProofValue(address({ street: 'Herzl', number: '12' }))).toBe('Herzl 12')
  })

  it('yields an empty value when nothing was entered', () => {
    expect(composeAddressProofValue(EMPTY_ADDRESS_PROOF_PARTS)).toBe('')
  })

  it('trims each part of surrounding whitespace only', () => {
    expect(
      composeAddressProofValue(
        address({ street: '  King  George  ', number: ' 3 ', city: ' Tel Aviv ', country: ' IL ' }),
      ),
    ).toBe('King  George 3, Tel Aviv, IL')
  })

  it('passes Arabic and Hebrew parts through byte-identically (Req 19 AC10, AC11)', () => {
    const parts = address({
      street: 'شارع الملك فيصل',
      number: '١٢',
      city: 'רחובות',
      country: 'ישראל',
    })
    const composed = composeAddressProofValue(parts)

    expect(composed).toBe('شارع الملك فيصل ١٢, רחובות, ישראל')
    for (const part of ADDRESS_PROOF_PARTS) {
      expect(composed).toContain(parts[part])
    }
  })
})

describe('the value submitted per proof type (AC4, AC5)', () => {
  it('submits the single typed value for a MobilePhone or NationalId proof', () => {
    const values = { value: ' +972 50 000 0000 ', address: EMPTY_ADDRESS_PROOF_PARTS }
    expect(residencyProofValue('MobilePhone', values)).toBe('+972 50 000 0000')
    expect(residencyProofValue('NationalId', values)).toBe('+972 50 000 0000')
  })

  it('submits the composed parts for an Address proof, ignoring the single value', () => {
    expect(
      residencyProofValue('Address', {
        value: 'typed before switching the type',
        address: address({ street: 'Herzl', city: 'Haifa', country: 'Israel' }),
      }),
    ).toBe('Herzl, Haifa, Israel')
  })
})
