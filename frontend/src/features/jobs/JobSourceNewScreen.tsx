import { useState } from 'react'

import {
  Anchor,
  Button,
  Checkbox,
  Container,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { ErrorPresenter } from '../../errors/ErrorPresenter'
import { ROUTE_PATHS } from '../../routing/paths'

import {
  EMPTY_SOURCE_FORM,
  SOURCE_TYPE_VALUES,
  validateSourceForm,
  type JobSourceFormValues,
} from './sourceRules'
import { useCreateSourceMutation } from './sourcesQueries'

const NAMESPACES = ['jobSources', 'errors', 'shell'] as const

function fieldError(
  issues: ReturnType<typeof validateSourceForm>,
  path: string,
  t: (key: string) => string,
): string | undefined {
  const issue = issues.find((v) => v.path === path)
  return issue ? t(issue.messageKey) : undefined
}

export function JobSourceNewScreen() {
  const { t } = useTranslation(NAMESPACES)
  const navigate = useNavigate()
  const createMutation = useCreateSourceMutation()

  const [values, setValues] = useState<JobSourceFormValues>(EMPTY_SOURCE_FORM)
  const [issues, setIssues] = useState<ReturnType<typeof validateSourceForm>>([])

  const set = <K extends keyof JobSourceFormValues>(key: K, value: JobSourceFormValues[K]): void => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    const found = validateSourceForm(values)
    setIssues(found)
    if (found.length > 0) return

    const body = {
      name: values.name,
      source_type: values.source_type as typeof SOURCE_TYPE_VALUES[number],
      slug: values.slug,
      poll_interval_hours: values.poll_interval_hours,
      enabled: values.enabled,
      ...(values.source_type === 'workday'
        ? { workday_tenant: values.workday_tenant, workday_site: values.workday_site }
        : {}),
    }

    createMutation.mutate(body, {
      onSuccess: () => {
        void navigate(ROUTE_PATHS.adminJobSources)
      },
    })
  }

  return (
    <Container size="md" py="md" data-testid="source-new-screen">
      <Stack gap="md">
        <Anchor
          component={Link}
          to={ROUTE_PATHS.adminJobSources}
          size="sm"
          data-testid="sources-back"
        >
          {t('jobSources:actions.back')}
        </Anchor>

        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('jobSources:new.title')}
          </Title>
          <Text c="dimmed">{t('jobSources:new.description')}</Text>
        </Stack>

        <form onSubmit={handleSubmit} noValidate>
          <Stack gap="sm">
            <TextInput
              label={t('jobSources:sources.fields.name')}
              required
              value={values.name}
              onChange={(e) => set('name', e.currentTarget.value)}
              error={fieldError(issues, 'name', t)}
              data-testid="field-name"
            />

            <Select
              label={t('jobSources:sources.fields.sourceType')}
              required
              value={values.source_type}
              data={SOURCE_TYPE_VALUES.map((v) => ({
                value: v,
                label: t(`jobSources:sources.type.${v}`),
              }))}
              onChange={(v) => set('source_type', v ?? 'greenhouse')}
              comboboxProps={{ withinPortal: false }}
              data-testid="field-source-type"
            />

            <TextInput
              label={t('jobSources:sources.fields.slug')}
              required
              value={values.slug}
              onChange={(e) => set('slug', e.currentTarget.value)}
              error={fieldError(issues, 'slug', t)}
              data-testid="field-slug"
            />

            <NumberInput
              label={t('jobSources:sources.fields.pollInterval')}
              required
              min={1}
              value={values.poll_interval_hours}
              onChange={(v) => set('poll_interval_hours', typeof v === 'number' ? v : 1)}
              error={fieldError(issues, 'poll_interval_hours', t)}
              data-testid="field-poll-interval"
            />

            <Checkbox
              label={t('jobSources:sources.fields.enabled')}
              checked={values.enabled}
              onChange={(e) => set('enabled', e.currentTarget.checked)}
              data-testid="field-enabled"
            />

            {values.source_type === 'workday' && (
              <>
                <TextInput
                  label={t('jobSources:sources.fields.workdayTenant')}
                  required
                  value={values.workday_tenant}
                  onChange={(e) => set('workday_tenant', e.currentTarget.value)}
                  error={fieldError(issues, 'workday_tenant', t)}
                  data-testid="field-workday-tenant"
                />
                <TextInput
                  label={t('jobSources:sources.fields.workdaySite')}
                  required
                  value={values.workday_site}
                  onChange={(e) => set('workday_site', e.currentTarget.value)}
                  error={fieldError(issues, 'workday_site', t)}
                  data-testid="field-workday-site"
                />
              </>
            )}

            {createMutation.isError && (
              <ErrorPresenter error={createMutation.error} />
            )}

            <Button
              type="submit"
              loading={createMutation.isPending}
              data-testid="source-new-submit"
            >
              {t('jobSources:actions.create')}
            </Button>
          </Stack>
        </form>
      </Stack>
    </Container>
  )
}
