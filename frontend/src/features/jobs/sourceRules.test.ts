import { describe, expect, it } from 'vitest'
import {
  EMPTY_SOURCE_FORM,
  SOURCE_TYPE_VALUES,
  validateSourceForm,
  type JobSourceFormValues,
} from './sourceRules'

function form(overrides: Partial<JobSourceFormValues> = {}): JobSourceFormValues {
  return { ...EMPTY_SOURCE_FORM, name: 'Test', slug: 'test', ...overrides }
}

describe('validateSourceForm', () => {
  it('returns no violations for a valid non-workday form', () => {
    expect(validateSourceForm(form({ source_type: 'greenhouse' }))).toEqual([])
  })

  it('requires name', () => {
    const issues = validateSourceForm(form({ name: '' }))
    expect(issues.some((v) => v.path === 'name')).toBe(true)
  })

  it('requires slug', () => {
    const issues = validateSourceForm(form({ slug: '' }))
    expect(issues.some((v) => v.path === 'slug')).toBe(true)
  })

  it('rejects slug with spaces', () => {
    const issues = validateSourceForm(form({ slug: 'has space' }))
    expect(issues.some((v) => v.path === 'slug')).toBe(true)
  })

  it('rejects poll_interval_hours below 1', () => {
    const issues = validateSourceForm(form({ poll_interval_hours: 0 }))
    expect(issues.some((v) => v.path === 'poll_interval_hours')).toBe(true)
  })

  it('requires workday_tenant for workday sources', () => {
    const issues = validateSourceForm(
      form({ source_type: 'workday', workday_tenant: '', workday_site: 'jobs' }),
    )
    expect(issues.some((v) => v.path === 'workday_tenant')).toBe(true)
    expect(issues.some((v) => v.path === 'workday_site')).toBe(false)
  })

  it('requires workday_site for workday sources', () => {
    const issues = validateSourceForm(
      form({ source_type: 'workday', workday_tenant: 'acme', workday_site: '' }),
    )
    expect(issues.some((v) => v.path === 'workday_site')).toBe(true)
    expect(issues.some((v) => v.path === 'workday_tenant')).toBe(false)
  })

  it('requires both workday fields when both are absent', () => {
    const issues = validateSourceForm(
      form({ source_type: 'workday', workday_tenant: '', workday_site: '' }),
    )
    expect(issues.some((v) => v.path === 'workday_tenant')).toBe(true)
    expect(issues.some((v) => v.path === 'workday_site')).toBe(true)
  })

  it('SOURCE_TYPE_VALUES has all 7 types', () => {
    expect(SOURCE_TYPE_VALUES).toHaveLength(7)
    expect(SOURCE_TYPE_VALUES).toContain('workday')
  })
})
