/**
 * Unit tests for the extraction draft model (Requirement 13 AC5–AC10).
 *
 * The three behaviours worth pinning down without a timer or a renderer: a `ready`
 * draft that actually failed is classified as failed, the poll stops on the first
 * terminal status, and no confirmation is possible while a skill candidate is
 * undecided.
 */

import { describe, expect, it } from 'vitest'

import {
  allSkillCandidatesResolved,
  canConfirmExtraction,
  confirmedSkillTerms,
  decideSkillCandidate,
  decodeExtractionDraft,
  decodeSkillCandidates,
  draftFromExtraction,
  EXTRACTION_POLL_INTERVAL_MS,
  extractionPollInterval,
  initialSkillResolutions,
  isExtractionPending,
  missingExtractedFields,
  type ExtractionDraftDTO,
} from './extraction'

function dto(overrides: Partial<ExtractionDraftDTO> = {}): ExtractionDraftDTO {
  return {
    id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    source: 'url',
    status: 'pending',
    extracted_fields: {},
    skill_candidates: [],
    created_at: '2026-01-01T10:00:00Z',
    expires_at: '2026-01-02T10:00:00Z',
    ...overrides,
  }
}

describe('decoding a polled draft (AC5, AC6)', () => {
  it('reports a pending draft as pending', () => {
    const draft = decodeExtractionDraft(dto())

    expect(draft.outcome).toBe('pending')
    expect(isExtractionPending(draft)).toBe(true)
    expect(extractionPollInterval(draft)).toBe(EXTRACTION_POLL_INTERVAL_MS)
  })

  it('decodes the extracted fields of a ready draft and stops the poll', () => {
    const draft = decodeExtractionDraft(
      dto({
        status: 'ready',
        extracted_fields: {
          title: 'Backend engineer',
          company: 'Hasoub Labs',
          work_model: 'Remote',
          employment_type: 'Full-time',
          experience_level: 'Mid-level',
          _raw_url: 'https://example.test/jobs/1',
        },
      }),
    )

    expect(draft.outcome).toBe('ready')
    expect(draft.fields.title).toBe('Backend engineer')
    expect(draft.fields.workModel).toBe('Remote')
    expect(extractionPollInterval(draft)).toBe(false)
  })

  it('treats an enum value outside the contract as not extracted', () => {
    const draft = decodeExtractionDraft(
      dto({ status: 'ready', extracted_fields: { title: 'Role', employment_type: 'Seasonal' } }),
    )

    expect(draft.fields.employmentType).toBeNull()
    expect(missingExtractedFields(draft.fields)).toContain('employmentType')
  })

  it('classifies a ready draft carrying only an extraction error as failed', () => {
    const draft = decodeExtractionDraft(
      dto({ status: 'ready', extracted_fields: { error: 'URL rejected by SSRF guard' } }),
    )

    expect(draft.outcome).toBe('failed')
    expect(draft.failureMessage).toBe('URL rejected by SSRF guard')
    expect(extractionPollInterval(draft)).toBe(false)
  })

  it('classifies a ready draft with nothing usable as failed rather than ready', () => {
    expect(decodeExtractionDraft(dto({ status: 'ready' })).outcome).toBe('failed')
  })

  it('treats an unrecognized status as terminal rather than polling it forever', () => {
    const draft = decodeExtractionDraft(dto({ status: 'expired' }))

    expect(draft.outcome).toBe('unknown')
    expect(draft.reportedStatus).toBe('expired')
    expect(extractionPollInterval(draft)).toBe(false)
  })

  it('polls while no draft has answered yet', () => {
    expect(extractionPollInterval(null)).toBe(EXTRACTION_POLL_INTERVAL_MS)
    expect(extractionPollInterval(undefined)).toBe(EXTRACTION_POLL_INTERVAL_MS)
  })
})

describe('pre-population and warnings (AC6, AC8)', () => {
  it('writes the extracted values into the form draft and leaves the rest empty', () => {
    const { fields } = decodeExtractionDraft(
      dto({ status: 'ready', extracted_fields: { title: 'Role', location: 'Haifa' } }),
    )
    const draft = draftFromExtraction(fields)

    expect(draft.title).toBe('Role')
    expect(draft.location).toBe('Haifa')
    expect(draft.company).toBe('')
    expect(draft.skillTerms).toEqual([])
  })

  it('names every pre-populated input that holds no value, in form order', () => {
    const { fields } = decodeExtractionDraft(
      dto({ status: 'ready', extracted_fields: { title: 'Role', location: 'Haifa' } }),
    )

    expect(missingExtractedFields(fields)).toEqual([
      'company',
      'workModel',
      'employmentType',
      'experienceLevel',
      'description',
    ])
  })
})

describe('skill candidates (AC7, AC10)', () => {
  it('decodes object and bare-string entries and drops unusable ones', () => {
    expect(
      decodeSkillCandidates([
        { term: 'Python', skill_id: 'a', confidence: 0.9 },
        { name: 'SQL' },
        'Go',
        { confidence: 1 },
        42,
      ]),
    ).toEqual([
      { term: 'Python', skillId: 'a', confidence: 0.9 },
      { term: 'SQL', skillId: null, confidence: null },
      { term: 'Go', skillId: null, confidence: null },
    ])
  })

  it('blocks the confirmation while any candidate is undecided', () => {
    const draft = decodeExtractionDraft(
      dto({
        status: 'ready',
        extracted_fields: { title: 'Role' },
        skill_candidates: [{ term: 'Python' }, { term: 'SQL' }],
      }),
    )
    let resolutions = initialSkillResolutions(draft.skillCandidates)

    expect(allSkillCandidatesResolved(resolutions)).toBe(false)
    expect(canConfirmExtraction(draft, resolutions)).toBe(false)

    resolutions = decideSkillCandidate(resolutions, 0, 'confirmed')
    expect(canConfirmExtraction(draft, resolutions)).toBe(false)

    resolutions = decideSkillCandidate(resolutions, 1, 'discarded')
    expect(canConfirmExtraction(draft, resolutions)).toBe(true)
    expect(confirmedSkillTerms(resolutions)).toEqual(['Python'])
  })

  it('treats a replacement with no term entered as still undecided', () => {
    let resolutions = initialSkillResolutions([{ term: 'Python', skillId: null, confidence: null }])
    resolutions = decideSkillCandidate(resolutions, 0, 'replaced', '   ')

    expect(resolutions[0]?.decision).toBe('replaced')
    expect(allSkillCandidatesResolved(resolutions)).toBe(false)

    resolutions = decideSkillCandidate(resolutions, 0, 'replaced', 'Python 3')
    expect(allSkillCandidatesResolved(resolutions)).toBe(true)
    expect(confirmedSkillTerms(resolutions)).toEqual(['Python 3'])
  })

  it('refuses a confirmation for a draft that is not ready (AC10)', () => {
    const pending = decodeExtractionDraft(dto())

    expect(canConfirmExtraction(pending, [])).toBe(false)
    expect(canConfirmExtraction(null, [])).toBe(false)
  })
})
