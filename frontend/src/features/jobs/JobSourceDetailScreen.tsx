import { useState } from 'react'

import {
  Anchor,
  Badge,
  Button,
  Checkbox,
  Container,
  Group,
  Modal,
  NumberInput,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { ErrorPresenter, LoadingState } from '../../errors/ErrorPresenter'
import { formatDateTime } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'
import type { Locale } from '../../lib/locale'
import { ROUTE_PATHS } from '../../routing/paths'

import {
  SOURCE_TYPE_VALUES,
  validateSourceForm,
  type JobSourceFormValues,
} from './sourceRules'
import { nextRunsPage, type CollectionRun } from './sourcesApi'
import {
  useDeleteSourceMutation,
  useRunsQuery,
  useSourceQuery,
  useTriggerCollectMutation,
  useUpdateSourceMutation,
} from './sourcesQueries'

const NAMESPACES = ['jobSources', 'errors', 'shell', 'jobs'] as const

const MAX_ERROR_CHARS = 100

function fieldError(
  issues: ReturnType<typeof validateSourceForm>,
  path: string,
  t: (key: string) => string,
): string | undefined {
  const issue = issues.find((v) => v.path === path)
  return issue ? t(issue.messageKey) : undefined
}

function runStatusColor(status: string): string {
  if (status === 'completed') return 'green'
  if (status === 'failed') return 'red'
  return 'blue'
}

interface RunRowProps {
  readonly run: CollectionRun
  readonly locale: Locale
}

function RunRow({ run, locale }: RunRowProps) {
  const { t } = useTranslation(NAMESPACES)
  const truncated =
    run.error_detail && run.error_detail.length > MAX_ERROR_CHARS
      ? `${run.error_detail.slice(0, MAX_ERROR_CHARS)}…`
      : (run.error_detail ?? '')

  return (
    <Table.Tr data-testid={`run-row-${run.id}`}>
      <Table.Td>{formatDateTime(run.started_at, locale)}</Table.Td>
      <Table.Td>
        <Badge color={runStatusColor(run.status)}>
          {t(`jobSources:runs.status.${run.status}`)}
        </Badge>
      </Table.Td>
      <Table.Td>{run.jobs_fetched}</Table.Td>
      <Table.Td>{run.jobs_created}</Table.Td>
      <Table.Td>{run.jobs_skipped}</Table.Td>
      <Table.Td>{run.jobs_flagged}</Table.Td>
      <Table.Td>
        <Text size="sm" style={{ wordBreak: 'break-all' }}>
          {truncated}
        </Text>
      </Table.Td>
    </Table.Tr>
  )
}

export function JobSourceDetailScreen() {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const navigate = useNavigate()
  const { sourceId = '' } = useParams<{ sourceId: string }>()

  const sourceQuery = useSourceQuery(sourceId)
  const [runsAfterId, setRunsAfterId] = useState<string | undefined>(undefined)
  const runsQuery = useRunsQuery(sourceId, runsAfterId)
  const updateMutation = useUpdateSourceMutation(sourceId)
  const deleteMutation = useDeleteSourceMutation()
  const triggerMutation = useTriggerCollectMutation(sourceId)

  const [values, setValues] = useState<JobSourceFormValues | null>(null)
  const [issues, setIssues] = useState<ReturnType<typeof validateSourceForm>>([])
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // Seed form values once source loads
  const source = sourceQuery.data
  const formValues: JobSourceFormValues = values ?? {
    name: source?.name ?? '',
    source_type: source?.source_type ?? 'greenhouse',
    slug: source?.slug ?? '',
    poll_interval_hours: source?.poll_interval_hours ?? 6,
    enabled: source?.enabled ?? true,
    workday_tenant: source?.workday_tenant ?? '',
    workday_site: source?.workday_site ?? '',
  }

  const set = <K extends keyof JobSourceFormValues>(
    key: K,
    value: JobSourceFormValues[K],
  ): void => {
    setValues((prev) => ({ ...(prev ?? formValues), [key]: value }))
  }

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    const found = validateSourceForm(formValues)
    setIssues(found)
    if (found.length > 0) return

    const body = {
      name: formValues.name,
      source_type: formValues.source_type as typeof SOURCE_TYPE_VALUES[number],
      slug: formValues.slug,
      poll_interval_hours: formValues.poll_interval_hours,
      enabled: formValues.enabled,
      ...(formValues.source_type === 'workday'
        ? {
            workday_tenant: formValues.workday_tenant,
            workday_site: formValues.workday_site,
          }
        : {}),
    }

    updateMutation.mutate(body)
  }

  const handleDelete = (): void => {
    deleteMutation.mutate(sourceId, {
      onSuccess: () => {
        void navigate(ROUTE_PATHS.adminJobSources)
      },
    })
  }

  const runs = runsQuery.data ?? []
  const runsNext = nextRunsPage(runsQuery.data)

  if (sourceQuery.isPending) {
    return (
      <Container size="md" py="md">
        <LoadingState label={t('jobSources:edit.title')} />
      </Container>
    )
  }

  if (sourceQuery.isError) {
    return (
      <Container size="md" py="md">
        <ErrorPresenter error={sourceQuery.error} />
      </Container>
    )
  }

  return (
    <Container size="md" py="md" data-testid="source-detail-screen">
      <Stack gap="md">
        <Anchor
          component={Link}
          to={ROUTE_PATHS.adminJobSources}
          size="sm"
          data-testid="sources-back"
        >
          {t('jobSources:actions.back')}
        </Anchor>

        <Group justify="space-between" wrap="wrap">
          <Stack gap={4}>
            <Title order={1} size="h3">
              {t('jobSources:edit.title')}
            </Title>
            <Text c="dimmed">{t('jobSources:edit.description')}</Text>
          </Stack>
          <Group gap="xs">
            <Button
              variant="light"
              loading={triggerMutation.isPending}
              onClick={() => triggerMutation.mutate()}
              data-testid="trigger-collect"
            >
              {t('jobSources:actions.triggerCollect')}
            </Button>
            <Button
              variant="subtle"
              color="red"
              onClick={() => {
                deleteMutation.reset()
                setConfirmingDelete(true)
              }}
              data-testid="delete-source"
            >
              {t('jobSources:actions.deleteSource')}
            </Button>
          </Group>
        </Group>

        <Paper withBorder p="md">
          <form onSubmit={handleSubmit} noValidate>
            <Stack gap="sm">
              <TextInput
                label={t('jobSources:sources.fields.name')}
                required
                value={formValues.name}
                onChange={(e) => set('name', e.currentTarget.value)}
                error={fieldError(issues, 'name', t)}
                data-testid="field-name"
              />

              <Select
                label={t('jobSources:sources.fields.sourceType')}
                required
                value={formValues.source_type}
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
                value={formValues.slug}
                onChange={(e) => set('slug', e.currentTarget.value)}
                error={fieldError(issues, 'slug', t)}
                data-testid="field-slug"
              />

              <NumberInput
                label={t('jobSources:sources.fields.pollInterval')}
                required
                min={1}
                value={formValues.poll_interval_hours}
                onChange={(v) => set('poll_interval_hours', typeof v === 'number' ? v : 1)}
                error={fieldError(issues, 'poll_interval_hours', t)}
                data-testid="field-poll-interval"
              />

              <Checkbox
                label={t('jobSources:sources.fields.enabled')}
                checked={formValues.enabled}
                onChange={(e) => set('enabled', e.currentTarget.checked)}
                data-testid="field-enabled"
              />

              {formValues.source_type === 'workday' && (
                <>
                  <TextInput
                    label={t('jobSources:sources.fields.workdayTenant')}
                    required
                    value={formValues.workday_tenant}
                    onChange={(e) => set('workday_tenant', e.currentTarget.value)}
                    error={fieldError(issues, 'workday_tenant', t)}
                    data-testid="field-workday-tenant"
                  />
                  <TextInput
                    label={t('jobSources:sources.fields.workdaySite')}
                    required
                    value={formValues.workday_site}
                    onChange={(e) => set('workday_site', e.currentTarget.value)}
                    error={fieldError(issues, 'workday_site', t)}
                    data-testid="field-workday-site"
                  />
                </>
              )}

              {updateMutation.isError && <ErrorPresenter error={updateMutation.error} />}

              <Button
                type="submit"
                loading={updateMutation.isPending}
                data-testid="source-save"
              >
                {t('jobSources:actions.save')}
              </Button>
            </Stack>
          </form>
        </Paper>

        {/* Run history */}
        <Stack gap="sm">
          <Title order={2} size="h4">
            {t('jobSources:runs.title')}
          </Title>

          {runsQuery.isPending ? (
            <LoadingState label={t('jobSources:runs.title')} />
          ) : runs.length === 0 ? (
            <Text c="dimmed">{t('jobSources:runs.empty')}</Text>
          ) : (
            <>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('jobSources:runs.fields.startedAt')}</Table.Th>
                  <Table.Th>{t('jobSources:runs.fields.status')}</Table.Th>
                  <Table.Th>{t('jobSources:runs.fields.fetched')}</Table.Th>
                  <Table.Th>{t('jobSources:runs.fields.created')}</Table.Th>
                  <Table.Th>{t('jobSources:runs.fields.skipped')}</Table.Th>
                  <Table.Th>{t('jobSources:runs.fields.flagged')}</Table.Th>
                  <Table.Th>{t('jobSources:runs.fields.error')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {runs.map((run) => (
                  <RunRow key={run.id} run={run} locale={locale} />
                ))}
              </Table.Tbody>
            </Table>
            <Group gap="sm">
              {runsNext.hasNextPage ? (
                <Button
                  type="button"
                  onClick={() => setRunsAfterId(runsNext.nextCursor ?? undefined)}
                  data-testid="runs-next-page"
                >
                  {t('jobs:pagination.next')}
                </Button>
              ) : null}
              {runsAfterId != null ? (
                <Button
                  type="button"
                  variant="default"
                  onClick={() => setRunsAfterId(undefined)}
                  data-testid="runs-first-page"
                >
                  {t('jobs:pagination.first')}
                </Button>
              ) : null}
            </Group>
            </>
          )}
        </Stack>
      </Stack>

      <Modal
        opened={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title={t('jobSources:actions.confirmDelete')}
        closeButtonProps={{ 'aria-label': t('shell:action.close') }}
      >
        <Stack gap="sm">
          <Text>{t('jobSources:actions.confirmDeleteBody')}</Text>
          {deleteMutation.isError && (
            <div data-testid="delete-error">
              <ErrorPresenter error={deleteMutation.error} />
            </div>
          )}
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setConfirmingDelete(false)}>
              {t('shell:action.cancel')}
            </Button>
            <Button
              color="red"
              loading={deleteMutation.isPending}
              onClick={handleDelete}
              data-testid="confirm-delete"
            >
              {t('jobSources:actions.deleteAction')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  )
}
