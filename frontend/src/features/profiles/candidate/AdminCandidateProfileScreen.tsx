/**
 * `/admin/candidates/:accountId` — any Candidate's full profile as an Admin reads
 * it (Requirement 9 AC14).
 *
 * The read is `GET /api/v1/admin/candidates/{account_id}/profile`, which returns
 * the same `CandidateProfileDTO` as the Candidate's own read — so "full profile"
 * is satisfied by rendering every member of it, and the two views cannot drift
 * into disagreeing about what a profile contains.
 *
 * ## Why this view is read-only
 *
 * AC14 grants a *read*. The contract offers no Admin write for a Candidate
 * profile, so there is no control here that could attempt one — not a disabled
 * save, which would advertise an action that does not exist, but no form at all.
 * The one editor lives in `CandidateProfileForm` and is mounted only on the
 * Candidate's own screen.
 *
 * Absent values are rendered as an explicit "not provided" rather than as blank
 * space, so an Admin can tell "the Candidate left this empty" from "this view
 * forgot to render it".
 *
 * Requirements: 9.14, 19.2, 19.12, 21.6, 21.8.
 */

import {
  Alert,
  Badge,
  Card,
  Container,
  Divider,
  Group,
  List,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'

import { ErrorState, LoadingState } from '../../../errors/ErrorPresenter'
import { formatNumber } from '../../../i18n/formatting'
import { useActiveLocale } from '../../../i18n/localeDirection'

import { isProfileComplete, profileState } from './completeness'
import type { CandidateProfile } from './model'
import { useAdminCandidateProfileQuery } from './profileQueries'

/** Namespaces this screen resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['profiles', 'shell', 'errors'] as const

interface ReadOnlyValueProps {
  readonly label: string
  readonly value: string | null | undefined
}

/** One persisted scalar, or the explicit "not provided" note. */
function ReadOnlyValue({ label, value }: ReadOnlyValueProps) {
  const { t } = useTranslation(NAMESPACES)
  const provided = typeof value === 'string' && value.trim() !== ''
  return (
    <Stack gap={0}>
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      {/*
       * The stored value is rendered verbatim — no trimming, no reordering, no
       * transliteration — so Arabic and Hebrew content is the bytes the
       * Backend_Api returned (Req 19 AC10, AC11).
       */}
      <Text c={provided ? undefined : 'dimmed'}>
        {provided ? value : t('profiles:readOnly.none')}
      </Text>
    </Stack>
  )
}

interface SectionProps {
  readonly title: string
  readonly emptyLabel: string
  readonly count: number
  readonly children: ReactNode
}

/** One collection, or the note that it holds nothing. */
function ReadOnlySection({ title, emptyLabel, count, children }: SectionProps) {
  return (
    <Stack gap="xs">
      <Title order={2} size="h5">
        {title}
      </Title>
      {count === 0 ? (
        <Text size="sm" c="dimmed">
          {emptyLabel}
        </Text>
      ) : (
        <Stack gap="sm">{children}</Stack>
      )}
    </Stack>
  )
}

/** A start/end span, with the open-ended case named rather than left blank. */
function span(
  t: (key: string, params?: Record<string, unknown>) => string,
  start: string,
  end: string | null,
): string {
  return end === null
    ? t('profiles:readOnly.ongoing', { start })
    : t('profiles:readOnly.years', { start, end })
}

export interface AdminCandidateProfileViewProps {
  readonly profile: CandidateProfile
}

/** Every member of one Candidate profile, read-only. */
export function AdminCandidateProfileView({ profile }: AdminCandidateProfileViewProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const state = profileState(profile)

  return (
    <Stack gap="lg" data-testid="admin-candidate-profile">
      <Group gap="xs" align="center">
        <Text size="sm" c="dimmed">
          {t('profiles:candidate.stateLabel')}
        </Text>
        <Badge
          variant="light"
          color={isProfileComplete(profile) ? 'green' : 'yellow'}
          data-testid="admin-profile-state"
          data-profile-state={state}
        >
          {t(`profiles:state.${state}`)}
        </Badge>
      </Group>

      <Stack gap="xs">
        <Title order={2} size="h5">
          {t('profiles:section.core')}
        </Title>
        <ReadOnlyValue label={t('profiles:field.fullName')} value={profile.full_name} />
        <ReadOnlyValue label={t('profiles:field.email')} value={profile.email} />
        <ReadOnlyValue label={t('profiles:field.phone')} value={profile.phone} />
        <ReadOnlyValue label={t('profiles:field.city')} value={profile.city} />
        <ReadOnlyValue label={t('profiles:field.summary')} value={profile.summary} />
        <ReadOnlyValue label={t('profiles:field.linkedinUrl')} value={profile.linkedin_url} />
      </Stack>

      <Divider />

      <ReadOnlySection
        title={t('profiles:section.education')}
        emptyLabel={t('profiles:empty.education')}
        count={profile.education.length}
      >
        {profile.education.map((entry) => (
          <Card key={entry.id} withBorder padding="sm" data-testid="admin-education-entry">
            <Stack gap={2}>
              <Text fw={600}>{entry.institution}</Text>
              <Text size="sm">{entry.degree}</Text>
              <ReadOnlyValue
                label={t('profiles:field.fieldOfStudy')}
                value={entry.field_of_study}
              />
              <Text size="sm" c="dimmed">
                {t(`profiles:enrolment.${entry.enrolment_status}`)}
              </Text>
              <Text size="sm" c="dimmed">
                {span(
                  t,
                  formatNumber(entry.start_year, locale, { useGrouping: false }),
                  entry.end_year === null
                    ? null
                    : formatNumber(entry.end_year, locale, { useGrouping: false }),
                )}
              </Text>
            </Stack>
          </Card>
        ))}
      </ReadOnlySection>

      <ReadOnlySection
        title={t('profiles:section.work')}
        emptyLabel={t('profiles:empty.work')}
        count={profile.work_experience.length}
      >
        {profile.work_experience.map((entry) => (
          <Card key={entry.id} withBorder padding="sm" data-testid="admin-work-entry">
            <Stack gap={2}>
              <Text fw={600}>{entry.company}</Text>
              <Text size="sm">{entry.title}</Text>
              <Text size="sm" c="dimmed">
                {span(t, entry.start_date, entry.end_date)}
              </Text>
              <ReadOnlyValue label={t('profiles:field.description')} value={entry.description} />
            </Stack>
          </Card>
        ))}
      </ReadOnlySection>

      <ReadOnlySection
        title={t('profiles:section.skills')}
        emptyLabel={t('profiles:empty.skills')}
        count={profile.skills.length}
      >
        <List data-testid="admin-skill-list">
          {profile.skills.map((entry) => (
            <List.Item key={entry.skill_id}>
              {entry.name}
              {entry.years_experience === null
                ? null
                : ` — ${t('profiles:readOnly.yearsExperience', {
                    value: formatNumber(entry.years_experience, locale),
                  })}`}
            </List.Item>
          ))}
        </List>
      </ReadOnlySection>

      <ReadOnlySection
        title={t('profiles:section.languages')}
        emptyLabel={t('profiles:empty.languages')}
        count={profile.languages.length}
      >
        <List data-testid="admin-language-list">
          {profile.languages.map((entry) => (
            <List.Item key={entry.id}>
              {entry.language_code} — {t(`profiles:proficiency.${entry.proficiency}`)}
            </List.Item>
          ))}
        </List>
      </ReadOnlySection>
    </Stack>
  )
}

/** The Admin view of one Candidate's profile (AC14). */
export function AdminCandidateProfileScreen() {
  const { t } = useTranslation(NAMESPACES)
  const { accountId } = useParams<{ accountId: string }>()
  const profile = useAdminCandidateProfileQuery(accountId)

  return (
    <Container size="md" py="md" data-testid="admin-candidate-profile-screen">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('profiles:admin.title')}
          </Title>
          <Text c="dimmed">{t('profiles:admin.description')}</Text>
          {accountId === undefined ? null : (
            <Text size="sm" c="dimmed" data-testid="admin-profile-account">
              {t('profiles:admin.accountLabel')}: {accountId}
            </Text>
          )}
        </Stack>

        {accountId === undefined ? (
          // No account in the address: nothing was asked for, so nothing is read.
          <Alert
            role="alert"
            color="yellow"
            variant="light"
            withCloseButton={false}
            data-testid="admin-profile-missing-account"
          >
            {t('profiles:admin.missingAccount')}
          </Alert>
        ) : profile.isPending ? (
          <LoadingState label={t('profiles:admin.title')} />
        ) : profile.isError ? (
          <ErrorState
            error={profile.error}
            onRetry={() => {
              void profile.refetch()
            }}
          />
        ) : (
          <AdminCandidateProfileView profile={profile.data} />
        )}
      </Stack>
    </Container>
  )
}
