/**
 * `/candidate/applications/:applicationId` — one of the Candidate's own Applications
 * (Requirement 14 AC11).
 *
 * AC11 asks for *every* returned field, so all eleven members of `ApplicationDTO` are
 * rendered: the role title and company, the status, the routed Application_Channel,
 * the submission, creation and update timestamps, and the Application, Job_Description,
 * Candidate and CV_Version identifiers. The identifiers are rendered as text rather
 * than hidden — they are what a Candidate quotes when asking about an Application, and
 * omitting a returned field is exactly what AC11 forbids.
 *
 * Timestamps are formatted per the active Locale with UTC as the authoritative value
 * (Requirement 19 AC12); the status and the channel are machine values localized
 * through the slice's catalogue, falling back to the reported value when the catalogue
 * does not name it.
 *
 * Requirements: 14.11, 19.2, 19.10, 19.12, 20.7, 21.6, 21.8.
 */

import { Anchor, Container, Group, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { ErrorState, LiveAnnouncement, LoadingState } from '../../errors/ErrorPresenter'
import { BidiText } from '../../i18n/DirectionProvider'
import { formatDateTime } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'
import { jobDetailPath, ROUTE_PATHS } from '../../routing/paths'

import { ApplicationField } from './ApplicationCard'
import { applicationChannelLabel, applicationStatusLabel } from './applicationMessages'
import { useMyApplicationQuery } from './applicationQueries'
import type { Application } from './applicationRules'

/** Namespaces this screen resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['applications', 'shell', 'errors'] as const

interface ApplicationDetailProps {
  readonly application: Application
}

/** Every field the Backend_Api returned for one Application (AC11). */
function ApplicationDetail({ application }: ApplicationDetailProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const notStated = t('applications:card.notStated')

  return (
    <Stack gap="md" data-testid={`application-detail-${application.id}`}>
      <Title order={1} size="h3" data-testid="application-detail-title">
        {application.jd_title === '' ? notStated : <BidiText value={application.jd_title} />}
      </Title>

      <Group gap="lg" wrap="wrap">
        <ApplicationField
          label={t('applications:card.company')}
          testId="application-detail-company"
        >
          {application.jd_company === '' ? (
            notStated
          ) : (
            <BidiText value={application.jd_company} />
          )}
        </ApplicationField>
        <ApplicationField label={t('applications:card.status')} testId="application-detail-status">
          {applicationStatusLabel(i18n, application.status)}
        </ApplicationField>
        <ApplicationField
          label={t('applications:detail.routedChannel')}
          testId="application-detail-routed-channel"
        >
          {applicationChannelLabel(i18n, application.routed_channel)}
        </ApplicationField>
      </Group>

      <Group gap="lg" wrap="wrap">
        <ApplicationField
          label={t('applications:card.submittedAt')}
          testId="application-detail-submitted-at"
        >
          {formatDateTime(application.submitted_at, locale)}
        </ApplicationField>
        <ApplicationField
          label={t('applications:detail.createdAt')}
          testId="application-detail-created-at"
        >
          {formatDateTime(application.created_at, locale)}
        </ApplicationField>
        <ApplicationField
          label={t('applications:detail.updatedAt')}
          testId="application-detail-updated-at"
        >
          {formatDateTime(application.updated_at, locale)}
        </ApplicationField>
      </Group>

      <Group gap="lg" wrap="wrap">
        <ApplicationField label={t('applications:detail.id')} testId="application-detail-id">
          {application.id}
        </ApplicationField>
        <ApplicationField label={t('applications:detail.jdId')} testId="application-detail-jd-id">
          {application.jd_id}
        </ApplicationField>
        <ApplicationField
          label={t('applications:detail.candidateId')}
          testId="application-detail-candidate-id"
        >
          {application.candidate_id}
        </ApplicationField>
        <ApplicationField
          label={t('applications:detail.cvVersionId')}
          testId="application-detail-cv-version-id"
        >
          {application.cv_version_id}
        </ApplicationField>
      </Group>

      <Anchor
        component={Link}
        to={jobDetailPath(application.jd_id)}
        size="sm"
        data-testid="application-detail-job-link"
      >
        {t('applications:detail.jobLink')}
      </Anchor>

      <LiveAnnouncement message={t('applications:announce.detailLoaded')} />
    </Stack>
  )
}

/** The Application detail screen (AC11). */
export function MyApplicationScreen() {
  const { t } = useTranslation(NAMESPACES)
  const params = useParams<{ applicationId: string }>()
  const applicationId = (params.applicationId ?? '').trim()
  const application = useMyApplicationQuery(applicationId)

  return (
    <Container size="md" py="md" data-testid="my-application-screen">
      <Stack gap="md">
        <Anchor
          component={Link}
          to={ROUTE_PATHS.candidateApplications}
          size="sm"
          data-testid="application-detail-back"
        >
          {t('applications:detail.back')}
        </Anchor>

        {applicationId === '' ? (
          <Text role="alert" data-testid="application-detail-missing-id">
            {t('applications:detail.missingId')}
          </Text>
        ) : application.isPending ? (
          <LoadingState label={t('applications:detail.loading')} />
        ) : application.isError ? (
          <ErrorState
            error={application.error}
            onRetry={() => {
              void application.refetch()
            }}
          />
        ) : (
          <ApplicationDetail application={application.data} />
        )}
      </Stack>
    </Container>
  )
}
