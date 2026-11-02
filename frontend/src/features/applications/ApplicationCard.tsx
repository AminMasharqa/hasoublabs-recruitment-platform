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

import { Anchor, Badge, Group, Paper, Stack, Text, Title } from '@mantine/core'
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
    <Stack gap={2} data-testid={testId}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={500} style={{ letterSpacing: '0.04em' }}>
        {label}
      </Text>
      <Text size="sm" fw={500}>{children}</Text>
    </Stack>
  )
}

/** Badge color per application status value. Unknown statuses fall back to gray. */
function statusColor(status: string): string {
  switch (status) {
    case 'Submitted': return 'blue'
    case 'Under Review': return 'yellow'
    case 'Forwarded to Recruiter': return 'indigo'
    case 'Closed': return 'gray'
    default: return 'gray'
  }
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
    <Paper
      shadow="xs"
      p="lg"
      component="li"
      className="card-interactive"
      data-testid={`application-card-${application.id}`}
    >
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap" gap="xs">
          <Title order={3} size="h4" fw={700} data-testid={`application-title-${application.id}`}>
            {application.jd_title === '' ? notStated : <BidiText value={application.jd_title} />}
          </Title>
          <Badge
            color={statusColor(application.status)}
            variant="light"
            size="md"
            data-testid={`application-status-${application.id}`}
          >
            {applicationStatusLabel(i18n, application.status)}
          </Badge>
        </Group>

        <Group gap="xl" wrap="wrap">
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
          fw={500}
          aria-label={t('applications:card.viewFor', {
            title: application.jd_title === '' ? application.id : application.jd_title,
          })}
          data-testid={`application-detail-link-${application.id}`}
        >
          {t('applications:card.view')} →
        </Anchor>
      </Stack>
    </Paper>
  )
}
