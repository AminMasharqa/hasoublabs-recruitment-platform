/**
 * Unit tests for the Job_Description authoring rules (Requirement 13).
 *
 * These are the assertions that make the requirement's status-to-control table, the
 * changed-fields-only `PATCH` of AC11, the publish precondition of AC13 and the
 * `illegal_transition` reading of AC18 checkable without rendering anything.
 */

import { describe, expect, it } from 'vitest'

import type { JdStatus } from '../../api/enums'

import {
  canCloseJob,
  canEditJob,
  canPublishJob,
  canSetApplicationChannel,
  changedJobFields,
  createJobBody,
  EMPTY_JOB_DRAFT,
  hasJobChanges,
  illegalTransitionOf,
  isIllegalTransition,
  jobAuthoringActions,
  jobDraftFrom,
  normalizeSkillTerms,
  requiresExternalUrl,
  unresolvedSkillTerms,
  validateJobDraft,
  validatePublishPrecondition,
  type JobDraft,
} from './authoringRules'
import type { JobDescription } from './jobsApi'

function job(overrides: Partial<JobDescription> = {}): JobDescription {
  return {
    id: '2f4a1c8e-6b3d-4f5a-9c1e-8d7b6a5f4e3d',
    title: 'Backend engineer',
    company: 'Hasoub Labs',
    location: 'Haifa',
    work_model: 'Hybrid',
    employment_type: 'Full-time',
    experience_level: 'Mid-level',
    description: 'Build services.',
    application_channel: 'Senior_Dashboard',
    external_url: null,
    required_skill_ids: [],
    status: 'Draft',
    creator_account_id: '9c1e8d7b-6a5f-4e3d-2f4a-1c8e6b3d4f5a',
    created_at: '2026-01-01T10:00:00Z',
    updated_at: '2026-01-02T10:00:00Z',
    published_at: null,
    closed_at: null,
    ...overrides,
  }
}

describe('the lifecycle control table (AC11, AC12, AC14, AC15, AC16)', () => {
  it('offers edit, publish and the channel control on a Draft', () => {
    expect(jobAuthoringActions('Draft')).toEqual(['edit', 'publish', 'channel'])
    expect(canEditJob('Draft')).toBe(true)
    expect(canPublishJob('Draft')).toBe(true)
    expect(canCloseJob('Draft')).toBe(false)
    expect(canSetApplicationChannel('Draft')).toBe(true)
  })

  it('offers edit, close and the channel control on an Open Job_Description', () => {
    expect(jobAuthoringActions('Open')).toEqual(['edit', 'close', 'channel'])
    expect(canPublishJob('Open')).toBe(false)
    expect(canCloseJob('Open')).toBe(true)
  })

  it('offers nothing at all on a Closed Job_Description (AC15)', () => {
    expect(jobAuthoringActions('Closed')).toEqual([])
    expect(canEditJob('Closed')).toBe(false)
    expect(canPublishJob('Closed')).toBe(false)
    expect(canCloseJob('Closed')).toBe(false)
    expect(canSetApplicationChannel('Closed')).toBe(false)
  })

  it('offers nothing for a status the contract does not declare', () => {
    expect(jobAuthoringActions('Archived' as JdStatus)).toEqual([])
    expect(jobAuthoringActions(null)).toEqual([])
    expect(jobAuthoringActions(undefined)).toEqual([])
  })
})

describe('the creation body (AC2)', () => {
  it('trims required text and spells an emptied optional field as null', () => {
    const draft: JobDraft = {
      ...EMPTY_JOB_DRAFT,
      title: '  Backend engineer  ',
      company: ' Hasoub Labs ',
      location: '   ',
      description: '',
      externalUrl: '  ',
      skillTerms: [' Python ', 'Python', '', 'SQL'],
    }

    expect(createJobBody(draft)).toEqual({
      title: 'Backend engineer',
      company: 'Hasoub Labs',
      location: null,
      work_model: null,
      employment_type: null,
      experience_level: null,
      description: null,
      application_channel: null,
      external_url: null,
      // Trimmed, de-duplicated, order preserved.
      required_skill_terms: ['Python', 'SQL'],
    })
  })

  it('reports the bounds the Backend_Api declares rather than submitting them', () => {
    const issues = validateJobDraft({ ...EMPTY_JOB_DRAFT, title: '', company: '' })

    expect(issues.map((issue) => issue.path)).toEqual(['title', 'company'])
  })

  it('rejects an external URL that is not HTTPS', () => {
    const issues = validateJobDraft({
      ...EMPTY_JOB_DRAFT,
      title: 'Role',
      company: 'Company',
      externalUrl: 'http://example.test/jobs/1',
    })

    expect(issues.map((issue) => issue.path)).toEqual(['external_url'])
  })
})

describe('the edit body (AC11)', () => {
  it('carries only the fields that changed', () => {
    const current = job()
    const draft = { ...jobDraftFrom(current), title: 'Staff engineer' }

    expect(changedJobFields(current, draft)).toEqual({ title: 'Staff engineer' })
  })

  it('carries nothing when nothing changed, so no request is issued', () => {
    const current = job()
    const body = changedJobFields(current, jobDraftFrom(current))

    expect(body).toEqual({})
    expect(hasJobChanges(body)).toBe(false)
  })

  it('spells a cleared optional field as null rather than omitting it', () => {
    const current = job({ location: 'Haifa' })
    const draft = { ...jobDraftFrom(current), location: '' }

    expect(changedJobFields(current, draft)).toEqual({ location: null })
  })

  it('sends the whole term list when the skills changed, and nothing when they did not', () => {
    const current = job({ required_skill_ids: ['a', 'b'] })
    const resolved = [
      { id: 'a', name: 'Python' },
      { id: 'b', name: 'SQL' },
    ]

    expect(changedJobFields(current, jobDraftFrom(current, resolved), resolved)).toEqual({})

    const draft = { ...jobDraftFrom(current, resolved), skillTerms: ['Python'] }
    expect(changedJobFields(current, draft, resolved)).toEqual({
      required_skill_terms: ['Python'],
    })
  })

  it('names the required skills the taxonomy could not resolve', () => {
    expect(
      unresolvedSkillTerms([
        { id: 'a', name: 'Python' },
        { id: 'b', name: null },
      ]),
    ).toEqual(['b'])
  })
})

describe('the publish precondition (AC13)', () => {
  it('requires an HTTPS URL while the channel is External_Careers_URL', () => {
    expect(requiresExternalUrl('External_Careers_URL')).toBe(true)
    expect(requiresExternalUrl('Senior_Dashboard')).toBe(false)

    const missing = validatePublishPrecondition(
      job({ application_channel: 'External_Careers_URL', external_url: null }),
    )
    expect(missing?.path).toBe('external_url')

    const insecure = validatePublishPrecondition(
      job({ application_channel: 'External_Careers_URL', external_url: 'http://example.test' }),
    )
    expect(insecure?.code).toBe('invalid_url')

    expect(
      validatePublishPrecondition(
        job({
          application_channel: 'External_Careers_URL',
          external_url: 'https://example.test/jobs/1',
        }),
      ),
    ).toBeNull()
  })

  it('imposes nothing on the other channels', () => {
    expect(
      validatePublishPrecondition(job({ application_channel: 'Senior_Dashboard', external_url: null })),
    ).toBeNull()
    expect(validatePublishPrecondition(job({ application_channel: null }))).toBeNull()
  })
})

describe('illegal_transition (AC18)', () => {
  it('reads the reported from and to members', () => {
    expect(
      illegalTransitionOf({
        error: 'illegal_transition',
        details: { from: 'Closed', to: 'Open' },
      }),
    ).toEqual({ from: 'Closed', to: 'Open' })
  })

  it('reports an omitted member as null rather than inventing a state', () => {
    expect(illegalTransitionOf({ error: 'illegal_transition', details: { from: 'Closed' } })).toEqual(
      { from: 'Closed', to: null },
    )
    expect(illegalTransitionOf({ error: 'illegal_transition', details: null })).toEqual({
      from: null,
      to: null,
    })
  })

  it('classifies every other failure as not a transition refusal', () => {
    expect(illegalTransitionOf({ error: 'validation_error', details: { from: 'a', to: 'b' } })).toBeNull()
    expect(isIllegalTransition(new Error('boom'))).toBe(false)
    expect(isIllegalTransition(null)).toBe(false)
  })
})

describe('skill-term normalization', () => {
  it('trims, drops blanks and duplicates, and preserves order', () => {
    expect(normalizeSkillTerms([' Python ', 'Python', '', '   ', 'SQL', null, undefined])).toEqual([
      'Python',
      'SQL',
    ])
  })
})
