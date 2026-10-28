/**
 * The Applicant_Cards of one Job_Description (Requirement 14 AC12).
 *
 * AC12 is a restriction as much as a rendering: a Senior or an Admin sees **exactly**
 * the full name, the applied role title and the Application status of each applicant —
 * the three fields the contract's `ApplicantCardDTO` marks as the only ones that may
 * ever be shown (Requirement 8 AC9 states the same rule about the Senior's view).
 *
 * That constraint is enforced structurally rather than by convention:
 * {@link ApplicantCardView} renders `applicantCardFields(card)`, a fixed
 * three-element tuple declared in `applicationRules.ts`, and never iterates the
 * payload. A fourth member arriving in the response is therefore not rendered, and a
 * fourth entry added to the tuple would fail the typecheck.
 *
 * The full name and the role title are Backend_Api text and go through `BidiText`, so
 * Arabic or Hebrew content renders byte-identically and bidi-isolated
 * (Requirement 19 AC10, AC12); the status is a machine value localized through the
 * slice's catalogue.
 *
 * ## No next-page control
 *
 * An Applicant_Card carries no identifier, so no keyset cursor can be formed from a
 * page of them — the same conclusion `lib/cursor.ts` reaches for a response that
 * advertises no usable continuation token, and the reason the page is bounded at the
 * shared 20 rows with no "next" control. The status filter narrows the list instead.
 *
 * Requirements: 14.12, 8.9, 19.2, 19.10, 19.12, 20.7, 21.6, 21.7, 21.8.
 */

import { Box, Group, Paper, Select, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import type { ApplicationStatus } from '../../api/enums'
import { EmptyState, ErrorState, LiveAnnouncement, LoadingState } from '../../errors/ErrorPresenter'
import { BidiText } from '../../i18n/DirectionProvider'
import { formatNumber } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'

import { applicationStatusLabel } from './applicationMessages'
import { useApplicantsQuery } from './applicationQueries'
import {
  APPLICATIONS_PAGE_SIZE,
  APPLICATION_STATUS_TARGETS,
  applicantCardFields,
  isApplicationStatus,
  type ApplicantCard,
} from './applicationRules'

/** Namespaces these surfaces resolve their strings against (Req 19 AC2). */
const NAMESPACES = ['applications', 'shell', 'errors'] as const

export interface ApplicantCardViewProps {
  readonly card: ApplicantCard
  /** Index in the rendered list, used only to key the test identifiers. */
  readonly index: number
}

/** One Applicant_Card: exactly three fields, always in the same order (AC12). */
export function ApplicantCardView({ card, index }: ApplicantCardViewProps) {
  const { t, i18n } = useTranslation(NAMESPACES)

  return (
    <Paper withBorder p="md" component="li" data-testid={`applicant-card-${index}`}>
      <Group gap="lg" wrap="wrap">
        {applicantCardFields(card).map((entry) => (
          <Stack key={entry.field} gap={0} data-testid={`applicant-${entry.field}-${index}`}>
            <Text size="xs" c="dimmed">
              {t(`applications:applicant.${entry.field}`)}
            </Text>
            <Text size="sm">
              {entry.field === 'application_status' ? (
                applicationStatusLabel(i18n, entry.value)
              ) : (
                <BidiText value={entry.value} />
              )}
            </Text>
          </Stack>
        ))}
      </Group>
    </Paper>
  )
}

export interface ApplicantListProps {
  /** The Job_Description whose applicants to list; `''` issues no request. */
  readonly jdId: string
  /** The applied status filter, or `null` for every status. */
  readonly status: ApplicationStatus | null
  /** Applies a status filter. */
  readonly onStatusChange: (status: ApplicationStatus | null) => void
}

/** The applicant list of one Job_Description, with its status filter (AC12). */
export function ApplicantList({ jdId, status, onStatusChange }: ApplicantListProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const applicants = useApplicantsQuery(jdId, status)
  const items = applicants.data ?? []

  if (jdId === '') {
    return (
      <Text c="dimmed" data-testid="applicants-no-job">
        {t('applications:applicants.noJob')}
      </Text>
    )
  }

  return (
    <Stack gap="md" data-testid="applicant-list" data-jd={jdId}>
      <Group gap="sm" align="flex-end" wrap="wrap">
        <Select
          label={t('applications:applicants.statusFilter')}
          data={APPLICATION_STATUS_TARGETS.map((value) => ({
            value,
            label: applicationStatusLabel(i18n, value),
          }))}
          value={status}
          onChange={(value) => onStatusChange(isApplicationStatus(value) ? value : null)}
          placeholder={t('applications:applicants.statusAny')}
          clearable
          data-testid="applicants-status-filter"
        />
        <Text size="sm" c="dimmed" data-testid="applicants-page-size">
          {t('applications:applicants.pageSize', {
            size: formatNumber(APPLICATIONS_PAGE_SIZE, locale),
          })}
        </Text>
      </Group>

      {applicants.isPending ? (
        <LoadingState label={t('applications:applicants.loading')} />
      ) : applicants.isError ? (
        <>
          <ErrorState
            error={applicants.error}
            onRetry={() => {
              void applicants.refetch()
            }}
          />
          <LiveAnnouncement message={t('applications:announce.applicantsFailed')} assertive />
        </>
      ) : items.length === 0 ? (
        <>
          {status === null ? (
            <EmptyState destination={t('shell:nav.applicants')} />
          ) : (
            <EmptyState
              destination={t('shell:nav.applicants')}
              filtered
              onClearFilters={() => onStatusChange(null)}
            />
          )}
          <LiveAnnouncement message={t('applications:announce.applicantsEmpty')} />
        </>
      ) : (
        <>
          <Box
            component="ul"
            aria-label={t('applications:applicants.listLabel')}
            data-testid="applicants-list"
            style={{ listStyle: 'none', margin: 0, padding: 0 }}
          >
            <Stack gap="md">
              {items.map((card, index) => (
                <ApplicantCardView
                  key={`${card.full_name}-${card.applied_role_title}-${index}`}
                  card={card}
                  index={index}
                />
              ))}
            </Stack>
          </Box>
          <LiveAnnouncement message={t('applications:announce.applicantsLoaded')} />
        </>
      )}
    </Stack>
  )
}
