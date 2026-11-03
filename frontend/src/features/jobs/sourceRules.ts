import type { ValidationIssue } from '../../forms/validators'

export interface JobSourceFormValues {
  readonly name: string
  readonly source_type: string
  readonly slug: string
  readonly poll_interval_hours: number
  readonly enabled: boolean
  readonly workday_tenant: string
  readonly workday_site: string
}

export const EMPTY_SOURCE_FORM: JobSourceFormValues = {
  name: '',
  source_type: 'greenhouse',
  slug: '',
  poll_interval_hours: 6,
  enabled: true,
  workday_tenant: '',
  workday_site: '',
}

export const SOURCE_TYPE_VALUES = [
  'greenhouse',
  'lever',
  'ashby',
  'workable',
  'smartrecruiters',
  'recruitee',
  'workday',
] as const

function issue(path: string, code: string): ValidationIssue {
  return { path, code, messageKey: `validation.${code}` }
}

export function validateSourceForm(values: JobSourceFormValues): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (values.name.trim() === '') {
    issues.push(issue('name', 'required'))
  } else if (values.name.length > 200) {
    issues.push(issue('name', 'too_long'))
  }

  if (values.slug.trim() === '') {
    issues.push(issue('slug', 'required'))
  } else if (/\s/.test(values.slug)) {
    issues.push(issue('slug', 'invalid'))
  } else if (values.slug.length > 200) {
    issues.push(issue('slug', 'too_long'))
  }

  if (values.poll_interval_hours < 1) {
    issues.push(issue('poll_interval_hours', 'out_of_range'))
  }

  if (values.source_type === 'workday') {
    if (values.workday_tenant.trim() === '') {
      issues.push(issue('workday_tenant', 'required'))
    }
    if (values.workday_site.trim() === '') {
      issues.push(issue('workday_site', 'required'))
    }
  }

  return issues
}
