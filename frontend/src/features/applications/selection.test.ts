/**
 * Unit tests for the Job_Description, Application and cursor selection carried in the
 * address (task 20.1).
 *
 * Requirement 14 AC10, AC12, AC13 and Requirement 18 AC5: the applicant list and the
 * Admin status control are addressed by query parameters, and the Application parameter
 * is the one the candidate-progress report drills down with.
 */

import { describe, expect, it } from 'vitest'

import { APPLICATION_DRILLDOWN_PARAM } from '../reports/drilldowns'

import {
  APPLICATIONS_CURSOR_PARAM,
  APPLICATION_PARAM,
  JD_PARAM,
  readApplicationId,
  readApplicationsCursor,
  readJdId,
  writeApplicationsCursor,
  writeSelection,
} from './selection'

function params(query: string): URLSearchParams {
  return new URLSearchParams(query)
}

describe('the addressed selection (Req 14 AC12, AC13)', () => {
  it('reads the Job_Description and the Application out of the address', () => {
    const search = params(`${JD_PARAM}=jd-1&${APPLICATION_PARAM}=app-2`)
    expect(readJdId(search)).toBe('jd-1')
    expect(readApplicationId(search)).toBe('app-2')
  })

  it('reads an empty selection from an address that names none', () => {
    expect(readJdId(params(''))).toBe('')
    expect(readApplicationId(params(''))).toBe('')
  })

  it('trims surrounding whitespace out of a pasted identifier', () => {
    expect(readJdId(params(`${JD_PARAM}=%20jd-1%20`))).toBe('jd-1')
  })

  it('writes both selections and omits an empty one', () => {
    expect(writeSelection({ jdId: 'jd-1', applicationId: 'app-2' }).toString()).toBe(
      `${JD_PARAM}=jd-1&${APPLICATION_PARAM}=app-2`,
    )
    expect(writeSelection({ jdId: 'jd-1' }).toString()).toBe(`${JD_PARAM}=jd-1`)
    expect(writeSelection({}).toString()).toBe('')
  })
})

describe('the Application parameter (Req 18 AC5)', () => {
  it('is the parameter the candidate-progress drill-down addresses', () => {
    expect(APPLICATION_PARAM).toBe(APPLICATION_DRILLDOWN_PARAM)
  })
})

describe('the own-Application cursor (Req 14 AC10)', () => {
  it('is spelled as the endpoint spells it', () => {
    expect(APPLICATIONS_CURSOR_PARAM).toBe('after_id')
  })

  it('reads the cursor the address carries, and none for the first page', () => {
    expect(readApplicationsCursor(params(`${APPLICATIONS_CURSOR_PARAM}=app-20`))).toBe('app-20')
    expect(readApplicationsCursor(params(''))).toBeNull()
    expect(readApplicationsCursor(params(`${APPLICATIONS_CURSOR_PARAM}=%20`))).toBeNull()
  })

  it('writes the next page address', () => {
    expect(writeApplicationsCursor('app-20').toString()).toBe(
      `${APPLICATIONS_CURSOR_PARAM}=app-20`,
    )
    expect(writeApplicationsCursor('  ').toString()).toBe('')
  })
})
