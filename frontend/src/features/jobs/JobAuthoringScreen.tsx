/**
 * `/senior/jobs/:jdId` and `/admin/jobs/:jdId` — authoring one Job_Description
 * (Requirement 13 AC11–AC16, AC18).
 *
 * The loaded Job_Description decides what this screen offers, and it decides it
 * through one pure table (`jobAuthoringActions`):
 *
 * - **AC11** a `Draft` or `Open` role renders the edit form, whose submission sends
 *   `PATCH /jobs/{jd_id}` with the changed fields only.
 * - **AC12, AC14, AC16** publish, close and the Application_Channel control are
 *   `JobLifecycleControls`.
 * - **AC15** a `Closed` role renders none of them — not the form, not publish, and
 *   no reopen control exists to render.
 * - **AC18** a refused transition names the reported states and refetches, from
 *   `IllegalTransitionNotice`.
 *
 * Which accounts reach this screen is the route groups' decision (`SENIOR_ACCESS`,
 * `ADMIN_ACCESS`), so no check here duplicates it; the Backend_Api additionally
 * refuses a Job_Description the caller does not own, and that refusal renders as the
 * uniform denial (Req 21 AC3).
 *
 * ## Why the edit form can be read-only about skills
 *
 * `PATCH` replaces the whole term list, while `JobDescriptionDTO` returns skill
 * *identifiers* and the contract offers no lookup-by-identifier endpoint
 * (requirements Assumption 4). While a required skill is unresolved, editing the list
 * would drop it from the role, so the editor states that and stays disabled — see
 * `authoringRules.unresolvedSkillTerms`.
 *
 * Requirements: 13.11, 13.12, 13.14, 13.15, 13.16, 13.18, 19.2, 19.10, 20.7, 21.6, 21.8.
 */

import { Anchor, Container, Divider, Group, Stack, Text, Title } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { ErrorState, LiveAnnouncement, LoadingState } from '../../errors/ErrorPresenter'
import { BidiText } from '../../i18n/DirectionProvider'
import { formatDateTime } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'
import { ROUTE_PATHS } from '../../routing/paths'
import { useSession } from '../../session/sessionState'

import { useUpdateJob } from './authoringQueries'
import {
  canEditJob,
  changedJobFields,
  hasJobChanges,
  jobDraftFrom,
  unresolvedSkillTerms,
  type JobDraft,
} from './authoringRules'
import { IllegalTransitionNotice } from './IllegalTransitionNotice'
import { JobField } from './JobCard'
import { JobForm } from './JobForm'
import { JobLifecycleControls } from './JobLifecycleControls'
import { useJobQuery, useResolvedSkills } from './jobQueries'
import type { JobDescription } from './jobsApi'
import { JobStatusBadge } from './JobStatusControls'

/** Namespaces this screen resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['jobs', 'shell', 'errors'] as const

interface JobAuthoringProps {
  readonly job: JobDescription
}

/** The authoring surface of one loaded Job_Description (AC11–AC16, AC18). */
function JobAuthoring({ job }: JobAuthoringProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const { skills } = useResolvedSkills(job.required_skill_ids)
  const update = useUpdateJob()

  const unresolved = unresolvedSkillTerms(skills)
  const editable = canEditJob(job.status)
  const notStated = t('jobs:card.notStated')

  /**
   * The edit form is keyed on what the Backend_Api last reported, so a successful
   * `PATCH` — or the AC18 refresh — reseeds it from the server's answer rather than
   * leaving the user editing a stale draft.
   */
  const seed = `${job.updated_at}:${job.status}:${skills.length}`

  /**
   * Whether the last submission carried no change.
   *
   * Said in words rather than ignored: AC11 sends the changed fields only, so a
   * submission with nothing changed has no request to issue — and a control that
   * silently does nothing is indistinguishable from a broken one.
   */
  const [unchanged, setUnchanged] = useState(false)

  const submit = (edited: JobDraft): void => {
    const body = changedJobFields(job, edited, skills)
    if (!hasJobChanges(body)) {
      setUnchanged(true)
      return
    }
    setUnchanged(false)
    update.mutate({ jdId: job.id, body })
  }

  return (
    <Stack gap="md" data-testid={`job-authoring-${job.id}`}>
      <Group gap="xs" justify="space-between" wrap="wrap">
        <Title order={1} size="h3" data-testid="job-authoring-title">
          <BidiText value={job.title} />
        </Title>
        <JobStatusBadge status={job.status} />
      </Group>

      <Group gap="lg" wrap="wrap">
        <JobField label={t('jobs:card.company')} testId="job-authoring-company">
          <BidiText value={job.company} />
        </JobField>
        <JobField label={t('jobs:card.publishedAt')} testId="job-authoring-published-at">
          {job.published_at === null
            ? t('jobs:card.notPublished')
            : formatDateTime(job.published_at, locale)}
        </JobField>
        <JobField label={t('jobs:detail.updatedAt')} testId="job-authoring-updated-at">
          {formatDateTime(job.updated_at, locale)}
        </JobField>
        {job.closed_at === null ? null : (
          <JobField label={t('jobs:detail.closedAt')} testId="job-authoring-closed-at">
            {formatDateTime(job.closed_at, locale)}
          </JobField>
        )}
        <JobField label={t('jobs:detail.applicationChannel')} testId="job-authoring-channel">
          {job.application_channel === null
            ? notStated
            : t(`jobs:channel.${job.application_channel}`)}
        </JobField>
      </Group>

      <Divider />

      {/* AC12, AC14, AC16, and AC15 by absence. */}
      <JobLifecycleControls job={job} />

      <Divider />

      {/* AC11, and AC15: a `Closed` Job_Description has no edit form at all. */}
      {editable ? (
        <Stack gap="xs">
          <Title order={2} size="h5">
            {t('jobs:authoring.editTitle')}
          </Title>
          <IllegalTransitionNotice jdId={job.id} error={update.error} />
          {unchanged ? (
            <Text size="sm" c="dimmed" role="status" data-testid="job-edit-unchanged">
              {t('jobs:authoring.nothingChanged')}
            </Text>
          ) : null}
          <JobForm
            key={seed}
            initial={jobDraftFrom(job, skills)}
            submitLabel={t('jobs:authoring.save')}
            onSubmit={submit}
            pending={update.isPending}
            error={update.error}
            unresolvedSkillIds={unresolved}
            successMessage={update.isSuccess ? t('jobs:announce.saved') : null}
            testId="job-edit-form"
          />
        </Stack>
      ) : (
        <Text size="sm" c="dimmed" role="status" data-testid="job-authoring-not-editable">
          {t('jobs:authoring.notEditable')}
        </Text>
      )}

      <LiveAnnouncement message={t('jobs:announce.detailLoaded')} />
    </Stack>
  )
}

/** The Job_Description authoring screen. */
export function JobAuthoringScreen() {
  const { t } = useTranslation(NAMESPACES)
  const { act } = useSession()
  const params = useParams<{ jdId: string }>()
  const jdId = (params.jdId ?? '').trim()
  const job = useJobQuery(jdId)

  const listPath = act === 'ADMIN' ? ROUTE_PATHS.adminJobs : ROUTE_PATHS.seniorJobs

  return (
    <Container size="md" py="md" data-testid="job-authoring-screen">
      <Stack gap="md">
        <Anchor component={Link} to={listPath} size="sm" data-testid="job-authoring-back">
          {t('jobs:authoring.backToList')}
        </Anchor>

        {jdId === '' ? (
          <Text role="alert" data-testid="job-authoring-missing-id">
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
          <JobAuthoring job={job.data} />
        )}
      </Stack>
    </Container>
  )
}
