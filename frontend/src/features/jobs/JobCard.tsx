/**
 * One Job_Description as the browse list renders it (Requirement 12 AC1, AC7).
 *
 * AC1 fixes the fields: the role title, the company, the location, the work
 * model, the employment type, the experience level and the publication timestamp.
 * Each is rendered as a labelled pair rather than as bare text, because a list row
 * that reads "Hybrid · Tel Aviv · Mid-level" only makes sense to someone who
 * already knows the schema.
 *
 * AC7's closed indicator and disabled apply control are {@link JobStatusBadge} and
 * {@link ApplyControl}, shared verbatim with the detail view — so the two surfaces
 * cannot disagree about whether a role accepts applications.
 *
 * A member the Backend_Api returned as `null` is rendered as "not stated" rather
 * than as an empty cell: the field is optional on the contract, and an unlabelled
 * gap is indistinguishable from a rendering defect. The title, the company and the
 * location are Backend_Api text and go through `BidiText`, so Arabic or Hebrew
 * content is rendered byte-identically and bidi-isolated from the Latin chrome
 * around it (Req 19 AC10).
 *
 * Requirements: 12.1, 12.7, 19.2, 19.10, 19.12, 20.8.
 */

import { Anchor, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { BidiText } from '../../i18n/DirectionProvider'
import { formatDateTime } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'
import { jobDetailPath } from '../../routing/paths'

import type { JobDescription } from './jobsApi'
import { ApplyControl, JobStatusBadge } from './JobStatusControls'

/** Namespaces the card resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['jobs', 'shell'] as const

export interface JobFieldProps {
  readonly label: string
  readonly children: React.ReactNode
  readonly testId?: string
}

/**
 * One labelled field of a Job_Description.
 *
 * The label is a `<dt>`-style caption rendered as text rather than as an actual
 * definition list, because the card mixes fields with controls and a `<dl>` cannot
 * legally hold a button.
 */
export function JobField({ label, children, testId }: JobFieldProps) {
  return (
    <Stack gap={0} data-testid={testId}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm">{children}</Text>
    </Stack>
  )
}

export interface JobCardProps {
  readonly job: JobDescription
}

/** One list entry (AC1, AC7). */
export function JobCard({ job }: JobCardProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const notStated = t('jobs:card.notStated')

  return (
    <Paper withBorder p="md" component="li" data-testid={`job-card-${job.id}`}>
      <Stack gap="xs">
        <Group gap="xs" justify="space-between" wrap="wrap">
          <Title order={3} size="h5" data-testid={`job-title-${job.id}`}>
            <BidiText value={job.title} />
          </Title>
          <JobStatusBadge status={job.status} />
        </Group>

        <Group gap="lg" wrap="wrap">
          <JobField label={t('jobs:card.company')} testId={`job-company-${job.id}`}>
            <BidiText value={job.company} />
          </JobField>
          <JobField label={t('jobs:card.location')} testId={`job-location-${job.id}`}>
            {job.location === null || job.location === '' ? (
              notStated
            ) : (
              <BidiText value={job.location} />
            )}
          </JobField>
          <JobField label={t('jobs:card.workModel')} testId={`job-work-model-${job.id}`}>
            {job.work_model === null ? notStated : t(`jobs:workModel.${job.work_model}`)}
          </JobField>
          <JobField label={t('jobs:card.employmentType')} testId={`job-employment-type-${job.id}`}>
            {job.employment_type === null
              ? notStated
              : t(`jobs:employmentType.${job.employment_type}`)}
          </JobField>
          <JobField
            label={t('jobs:card.experienceLevel')}
            testId={`job-experience-level-${job.id}`}
          >
            {job.experience_level === null
              ? notStated
              : t(`jobs:experienceLevel.${job.experience_level}`)}
          </JobField>
          <JobField label={t('jobs:card.publishedAt')} testId={`job-published-at-${job.id}`}>
            {job.published_at === null
              ? t('jobs:card.notPublished')
              : formatDateTime(job.published_at, locale)}
          </JobField>
        </Group>

        <Group gap="md" wrap="wrap">
          <Anchor
            component={Link}
            to={jobDetailPath(job.id)}
            size="sm"
            aria-label={t('jobs:card.viewFor', { title: job.title })}
            data-testid={`job-detail-link-${job.id}`}
          >
            {t('jobs:card.view')}
          </Anchor>
          {/*
            AC7: the same verdict as the detail view, from the same component. The
            list entry is not under `/jobs/:jdId`, so the identifier the apply flow
            of Requirement 14 needs comes from the entry itself rather than from the
            route (Req 14 AC1).
          */}
          <ApplyControl status={job.status} title={job.title} jdId={job.id} />
        </Group>
      </Stack>
    </Paper>
  )
}
