/**
 * The candidate-progress report (Requirement 18 AC3, AC5).
 *
 * AC3 fixes the row: the account email address, the Account_Status, the creation
 * timestamp and *every* associated Application status. AC5 adds a drill-down
 * control per row to the underlying destination — the account, the
 * Job_Description and the Application each get one, because a progress row
 * references all three.
 *
 * ## Why a table
 *
 * The report is a grid of the same four fields for many accounts, which is what a
 * `<table>` is for: a screen reader announces the column a cell belongs to, and
 * the column order mirrors under `rtl` from the document direction alone
 * (Requirement 19 AC8) without a single directional style.
 *
 * The nested Application statuses are a list inside the last cell rather than
 * extra rows, so one account stays one row and "every associated Application
 * status" is visibly a property of that account.
 *
 * Backend_Api text — the email address, the role title — is rendered through
 * `BidiText`, so Arabic or Hebrew content is byte-identical and bidi-isolated from
 * the Latin chrome around it (Req 19 AC10). Statuses are contract values and are
 * localized where the catalogue names them, falling back to the value itself so an
 * unrecognized status is reported rather than blanked.
 *
 * Requirements: 18.3, 18.5, 19.2, 19.8, 19.10, 19.12, 20.8.
 */

import { Anchor, Badge, Group, Stack, Table, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { BidiText } from '../../i18n/DirectionProvider'
import { formatDateTime } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'
import { adminCandidateProfilePath, adminJobPath } from '../../routing/paths'

import { adminApplicationDestination } from './drilldowns'
import type { CandidateProgressRow } from './reportsApi'

/** Namespaces the table resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['reports', 'shell'] as const

export interface CandidateProgressTableProps {
  readonly rows: readonly CandidateProgressRow[]
}

/** One account's Application statuses (AC3, AC5). */
function ApplicationStatuses({ row }: { readonly row: CandidateProgressRow }) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)

  if (row.applications.length === 0) {
    return (
      <Text size="sm" c="dimmed" data-testid={`progress-applications-empty-${row.account_id}`}>
        {t('reports:progress.noApplications')}
      </Text>
    )
  }

  return (
    <Stack
      component="ul"
      gap="xs"
      style={{ listStyle: 'none', margin: 0, padding: 0 }}
      data-testid={`progress-applications-${row.account_id}`}
    >
      {row.applications.map((application) => (
        <Group
          key={application.application_id}
          component="li"
          gap="xs"
          wrap="wrap"
          data-testid={`progress-application-${application.application_id}`}
        >
          <Badge variant="light" data-testid={`progress-application-status-${application.application_id}`}>
            {t(`reports:applicationStatus.${application.status}`, {
              defaultValue: application.status,
            })}
          </Badge>
          {/* AC5: the Job_Description this Application was submitted against. */}
          <Anchor
            component={Link}
            to={adminJobPath(application.jd_id)}
            size="sm"
            data-testid={`progress-jd-link-${application.application_id}`}
          >
            <BidiText value={application.jd_title} />
          </Anchor>
          <Text size="xs" c="dimmed">
            {formatDateTime(application.submitted_at, locale)}
          </Text>
          {/* AC5: the Application itself. */}
          <Anchor
            component={Link}
            to={adminApplicationDestination(application.application_id)}
            size="xs"
            aria-label={t('reports:progress.openApplicationFor', { title: application.jd_title })}
            data-testid={`progress-application-link-${application.application_id}`}
          >
            {t('reports:progress.openApplication')}
          </Anchor>
        </Group>
      ))}
    </Stack>
  )
}

/** The candidate-progress rows (AC3, AC5). */
export function CandidateProgressTable({ rows }: CandidateProgressTableProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)

  return (
    <Table.ScrollContainer minWidth={320}>
      <Table striped withTableBorder data-testid="candidate-progress-table">
        <Table.Caption>{t('reports:progress.caption')}</Table.Caption>
        <Table.Thead>
          <Table.Tr>
            <Table.Th scope="col">{t('reports:progress.email')}</Table.Th>
            <Table.Th scope="col">{t('reports:progress.accountStatus')}</Table.Th>
            <Table.Th scope="col">{t('reports:progress.createdAt')}</Table.Th>
            <Table.Th scope="col">{t('reports:progress.applications')}</Table.Th>
            <Table.Th scope="col">{t('reports:progress.drillDown')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row) => (
            <Table.Tr key={row.account_id} data-testid={`progress-row-${row.account_id}`}>
              <Table.Td data-testid={`progress-email-${row.account_id}`}>
                <BidiText value={row.email} />
              </Table.Td>
              <Table.Td data-testid={`progress-status-${row.account_id}`}>
                {t(`reports:accountStatus.${row.account_status}`, {
                  defaultValue: row.account_status,
                })}
              </Table.Td>
              <Table.Td data-testid={`progress-created-at-${row.account_id}`}>
                {formatDateTime(row.created_at, locale)}
              </Table.Td>
              <Table.Td>
                <ApplicationStatuses row={row} />
              </Table.Td>
              <Table.Td>
                {/* AC5: the account the row reports on. */}
                <Anchor
                  component={Link}
                  to={adminCandidateProfilePath(row.account_id)}
                  size="sm"
                  aria-label={t('reports:progress.openAccountFor', { email: row.email })}
                  data-testid={`progress-account-link-${row.account_id}`}
                >
                  {t('reports:progress.openAccount')}
                </Anchor>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}
