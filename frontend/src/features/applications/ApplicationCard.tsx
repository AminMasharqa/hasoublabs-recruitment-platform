/**
 * One Application as the Candidate's own list renders it (Requirement 14 AC9).
 *
 * AC9 fixes the fields: the role title, the company, the status and the submission
 * date. Each is a labelled pair rather than bare text, because a row reading
 * "Backend Engineer · Acme · Submitted · 4 Mar 2025" only makes sense to someone who
 * already knows the schema.
 *
 * The title and the company are Backend_Api text and go through `BidiText`, so
 * Arabic or Hebrew content renders byte-identically and stays bidi-isolated from the
 * Latin chrome around it (Requirement 19 AC10, AC12). The status is a machine value
 * localized through the slice's catalogue.
 *
 * The link to the Application detail is not one of AC9's four fields; it is
 * navigation to the destination AC11 describes, and the accessible name names the
 * role so twenty "View" links are distinguishable from one another
 * (Requirement 20 AC8).
 *
 * Requirements: 14.9, 14.11, 19.2, 19.10, 19.12, 20.8.
 */

import { Anchor, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { BidiText } from '../../i18n/DirectionProvider'
import { formatDate } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'
import { candidateApplicationPath } from '../../routing/paths'

import { applicationStatusLabel } from './applicationMessages'
import type { Application } from './applicationRules'

/** Namespaces the card resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['applications', 'shell'] as const

export interface ApplicationFieldProps {
  readonly label: string
  readonly children: React.ReactNode
  readonly testId?: string
}

/** One labelled field of an Application. */
export function ApplicationField({ label, children, testId }: ApplicationFieldProps) {
  return (
    <Stack gap={0} data-testid={testId}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm">{children}</Text>
    </Stack>
  )
}

export interface ApplicationCardProps {
  readonly application: Application
}

/** One entry of the Candidate's own Application list (AC9). */
export function ApplicationCard({ application }: ApplicationCardProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const notStated = t('applications:card.notStated')

  return (
    <Paper withBorder p="md" component="li" data-testid={`application-card-${application.id}`}>
      <Stack gap="xs">
        <Title order={3} size="h5" data-testid={`application-title-${application.id}`}>
          {application.jd_title === '' ? notStated : <BidiText value={application.jd_title} />}
        </Title>

        <Group gap="lg" wrap="wrap">
          <ApplicationField
            label={t('applications:card.company')}
            testId={`application-company-${application.id}`}
          >
            {application.jd_company === '' ? (
              notStated
            ) : (
              <BidiText value={application.jd_company} />
            )}
          </ApplicationField>
          <ApplicationField
            label={t('applications:card.status')}
            testId={`application-status-${application.id}`}
          >
            {applicationStatusLabel(i18n, application.status)}
          </ApplicationField>
          <ApplicationField
            label={t('applications:card.submittedAt')}
            testId={`application-submitted-at-${application.id}`}
          >
            {formatDate(application.submitted_at, locale)}
          </ApplicationField>
        </Group>

        <Anchor
          component={Link}
          to={candidateApplicationPath(application.id)}
          size="sm"
          aria-label={t('applications:card.viewFor', {
            title: application.jd_title === '' ? application.id : application.jd_title,
          })}
          data-testid={`application-detail-link-${application.id}`}
        >
          {t('applications:card.view')}
        </Anchor>
      </Stack>
    </Paper>
  )
}
