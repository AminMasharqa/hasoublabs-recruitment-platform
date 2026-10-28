/**
 * `/jobs/:jdId` — one Job_Description in full (Requirement 12 AC6–AC11).
 *
 * - **AC6** every member `GET /api/v1/jobs/{jd_id}` returns is rendered: the
 *   title, company, location, work model, employment type, experience level,
 *   status, application channel, external URL, creator account, the four
 *   timestamps, the description text and the resolved required skills.
 * - **AC7** a `Closed` role carries the closed indicator and a disabled apply
 *   control, from the same components the list entry uses.
 * - **AC8–AC10** the contactable Seniors are `ContactableSeniors`.
 * - **AC11** the route sits under the `job-browsing` guard, so this element never
 *   mounts without an approved session — see `JobsBrowseScreen`.
 *
 * ## Required skills, and why some of them stay identifiers
 *
 * `required_skill_ids` carries identifiers and the contract offers no
 * lookup-by-identifier endpoint, so the names come from a page of
 * `GET /api/v1/skills` (requirements Assumption 4). An identifier that page does
 * not name is rendered as the identifier with a note explaining why, rather than
 * being dropped: a required skill that cannot be named is still a required skill,
 * and omitting it would understate what the role asks for.
 *
 * Requirements: 12.6, 12.7, 12.8, 12.9, 12.10, 12.11, 19.2, 19.10, 19.12, 21.6, 21.8.
 */

import { Anchor, Container, Divider, Group, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { ErrorState, LiveAnnouncement, LoadingState } from '../../errors/ErrorPresenter'
import { BidiText } from '../../i18n/DirectionProvider'
import { formatDateTime } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'
import { ROUTE_PATHS } from '../../routing/paths'

import { ContactableSeniors } from './ContactableSeniors'
import { JobField } from './JobCard'
import { isClosed } from './jobStatus'
import { useJobQuery, useResolvedSkills } from './jobQueries'
import type { JobDescription } from './jobsApi'
import { ApplyControl, JobStatusBadge } from './JobStatusControls'
import { allSkillsResolved } from './skills'

/** Namespaces this screen resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['jobs', 'shell', 'errors'] as const

interface RequiredSkillsProps {
  readonly ids: readonly string[]
}

/** The required skills of the role, named where the taxonomy names them (AC6). */
function RequiredSkills({ ids }: RequiredSkillsProps) {
  const { t } = useTranslation(NAMESPACES)
  const { skills, isPending } = useResolvedSkills(ids)

  return (
    <Stack gap={4} data-testid="job-required-skills">
      <Title order={2} size="h5">
        {t('jobs:detail.requiredSkills')}
      </Title>

      {skills.length === 0 ? (
        <Text size="sm" c="dimmed" data-testid="job-required-skills-empty">
          {t('jobs:detail.requiredSkillsMissing')}
        </Text>
      ) : (
        <>
          <Group gap="xs" wrap="wrap">
            {skills.map((skill) => (
              <Text key={skill.id} size="sm" data-testid={`job-required-skill-${skill.id}`}>
                {skill.name === null ? (
                  t('jobs:detail.unresolvedSkill', { id: skill.id })
                ) : (
                  <BidiText value={skill.name} />
                )}
              </Text>
            ))}
          </Group>
          {isPending ? (
            <Text size="xs" c="dimmed">
              {t('jobs:filters.skillsLoading')}
            </Text>
          ) : allSkillsResolved(skills) ? null : (
            <Text size="xs" c="dimmed" data-testid="job-unresolved-skills-note">
              {t('jobs:detail.unresolvedSkillsNote')}
            </Text>
          )}
        </>
      )}
    </Stack>
  )
}

interface JobDetailProps {
  readonly job: JobDescription
}

/** The loaded Job_Description (AC6, AC7). */
function JobDetail({ job }: JobDetailProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const notStated = t('jobs:card.notStated')

  return (
    <Stack gap="md" data-testid={`job-detail-${job.id}`}>
      <Group gap="xs" justify="space-between" wrap="wrap">
        <Title order={1} size="h3" data-testid="job-detail-title">
          <BidiText value={job.title} />
        </Title>
        <JobStatusBadge status={job.status} />
      </Group>

      {/* AC7: stated in words beside the badge, not conveyed by colour alone. */}
      {isClosed(job.status) ? (
        <Text c="red" role="status" data-testid="job-detail-closed-notice">
          {t('jobs:status.closedNotice')}
        </Text>
      ) : null}

      <Group gap="lg" wrap="wrap">
        <JobField label={t('jobs:card.company')} testId="job-detail-company">
          <BidiText value={job.company} />
        </JobField>
        <JobField label={t('jobs:card.location')} testId="job-detail-location">
          {job.location === null || job.location === '' ? (
            notStated
          ) : (
            <BidiText value={job.location} />
          )}
        </JobField>
        <JobField label={t('jobs:card.workModel')} testId="job-detail-work-model">
          {job.work_model === null ? notStated : t(`jobs:workModel.${job.work_model}`)}
        </JobField>
        <JobField label={t('jobs:card.employmentType')} testId="job-detail-employment-type">
          {job.employment_type === null
            ? notStated
            : t(`jobs:employmentType.${job.employment_type}`)}
        </JobField>
        <JobField label={t('jobs:card.experienceLevel')} testId="job-detail-experience-level">
          {job.experience_level === null
            ? notStated
            : t(`jobs:experienceLevel.${job.experience_level}`)}
        </JobField>
      </Group>

      <Stack gap={4}>
        <Title order={2} size="h5">
          {t('jobs:detail.description')}
        </Title>
        {job.description === null || job.description === '' ? (
          <Text size="sm" c="dimmed" data-testid="job-detail-description-missing">
            {t('jobs:detail.descriptionMissing')}
          </Text>
        ) : (
          // `white-space: pre-wrap` so the stored line breaks survive rendering
          // without the text being altered (Req 19 AC10).
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }} data-testid="job-detail-description">
            <BidiText value={job.description} />
          </Text>
        )}
      </Stack>

      <RequiredSkills ids={job.required_skill_ids} />

      <Stack gap={4}>
        <Title order={2} size="h5">
          {t('jobs:detail.applicationChannel')}
        </Title>
        <Text size="sm" data-testid="job-detail-application-channel">
          {job.application_channel === null
            ? notStated
            : t(`jobs:channel.${job.application_channel}`)}
        </Text>
        {job.external_url === null || job.external_url === '' ? null : (
          <Anchor
            href={job.external_url}
            size="sm"
            target="_blank"
            rel="noreferrer noopener"
            data-testid="job-detail-external-url"
          >
            {t('jobs:detail.externalUrl')}
          </Anchor>
        )}
      </Stack>

      <Stack gap={4}>
        <Title order={2} size="h5">
          {t('jobs:detail.timestamps')}
        </Title>
        <Group gap="lg" wrap="wrap">
          <JobField label={t('jobs:card.publishedAt')} testId="job-detail-published-at">
            {job.published_at === null
              ? t('jobs:card.notPublished')
              : formatDateTime(job.published_at, locale)}
          </JobField>
          <JobField label={t('jobs:detail.createdAt')} testId="job-detail-created-at">
            {formatDateTime(job.created_at, locale)}
          </JobField>
          <JobField label={t('jobs:detail.updatedAt')} testId="job-detail-updated-at">
            {formatDateTime(job.updated_at, locale)}
          </JobField>
          {job.closed_at === null ? null : (
            <JobField label={t('jobs:detail.closedAt')} testId="job-detail-closed-at">
              {formatDateTime(job.closed_at, locale)}
            </JobField>
          )}
          <JobField label={t('jobs:detail.creator')} testId="job-detail-creator">
            {job.creator_account_id}
          </JobField>
        </Group>
      </Stack>

      {/*
        AC7: the same verdict as the list entry, with the reason stated. The
        identifier is passed from the loaded Job_Description rather than left to the
        `:jdId` route parameter, so the apply flow targets what is on screen.
      */}
      <ApplyControl status={job.status} title={job.title} jdId={job.id} showReason />

      <Divider />

      <ContactableSeniors jdId={job.id} />

      <LiveAnnouncement message={t('jobs:announce.detailLoaded')} />
    </Stack>
  )
}

/** The Job_Description detail screen. */
export function JobDetailScreen() {
  const { t } = useTranslation(NAMESPACES)
  const params = useParams<{ jdId: string }>()
  const jdId = (params.jdId ?? '').trim()
  const job = useJobQuery(jdId)

  return (
    <Container size="md" py="md" data-testid="job-detail-screen">
      <Stack gap="md">
        <Anchor component={Link} to={ROUTE_PATHS.jobs} size="sm" data-testid="job-detail-back">
          {t('jobs:detail.back')}
        </Anchor>

        {jdId === '' ? (
          <Text role="alert" data-testid="job-detail-missing-id">
            {t('jobs:detail.missingId')}
          </Text>
        ) : job.isPending ? (
          <LoadingState label={t('jobs:detail.loading')} />
        ) : job.isError ? (
          <ErrorState
            error={job.error}
            onRetry={() => {
              void job.refetch()
            }}
          />
        ) : (
          <JobDetail job={job.data} />
        )}
      </Stack>
    </Container>
  )
}
