/**
 * `/admin/seniors/:accountId` — any Senior's profile as an Admin reads it
 * (Requirement 10 AC12).
 *
 * The read is `GET /api/v1/admin/seniors/{account_id}/profile`, which returns the
 * same `SeniorProfileDTO` as the Senior's own read — so the two views cannot drift
 * into disagreeing about what a profile contains.
 *
 * ## Why this view is read-only
 *
 * AC12 grants a *read*. The contract offers no Admin write for a Senior profile, so
 * there is no control here that could attempt one — not a disabled save, which
 * would advertise an action that does not exist, but no form at all. The one editor
 * lives in `SeniorProfileForm` and is mounted only on the Senior's own screen.
 *
 * The chat notice appears for a `Chat` or `Both` preference for the same reason it
 * appears on the Senior's own screen (AC11): the place a chat contact action would
 * occupy states that the platform chat is not available yet, rather than leaving an
 * Admin to conclude the Senior can be reached that way today.
 *
 * Absent values are rendered as an explicit "not provided" rather than as blank
 * space, so an Admin can tell "the Senior left this empty" from "this view forgot
 * to render it".
 *
 * Requirements: 10.11, 10.12, 19.2, 19.12, 21.6, 21.8.
 */

import { Alert, Badge, Container, Group, List, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'

import { ErrorState, LoadingState } from '../../../errors/ErrorPresenter'

import type { SeniorProfile } from './model'
import { showsChatPlaceholder } from './model'
import { useAdminSeniorProfileQuery } from './profileQueries'
import { ChatPlaceholder } from './SeniorContactPreferences'

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
       * transliteration — so Arabic and Hebrew content is the bytes the Backend_Api
       * returned (Req 19 AC10, AC11).
       */}
      <Text c={provided ? undefined : 'dimmed'}>
        {provided ? value : t('profiles:readOnly.none')}
      </Text>
    </Stack>
  )
}

export interface AdminSeniorProfileViewProps {
  readonly profile: SeniorProfile
}

/** Every member of one Senior profile, read-only. */
export function AdminSeniorProfileView({ profile }: AdminSeniorProfileViewProps) {
  const { t } = useTranslation(NAMESPACES)

  return (
    <Stack gap="lg" data-testid="admin-senior-profile">
      <Stack gap="xs">
        <Title order={2} size="h5">
          {t('profiles:section.core')}
        </Title>
        <ReadOnlyValue label={t('profiles:field.fullName')} value={profile.full_name} />
        <ReadOnlyValue
          label={t('profiles:senior.companyAffiliation')}
          value={profile.company_affiliation}
        />
        <ReadOnlyValue label={t('profiles:field.jobTitle')} value={profile.job_title} />
      </Stack>

      <Stack gap="xs">
        <Title order={2} size="h5">
          {t('profiles:senior.contactSection')}
        </Title>
        <Group gap="xs" align="center">
          <Text size="sm" c="dimmed">
            {t('profiles:senior.contactChannelLabel')}
          </Text>
          <Badge
            variant="light"
            data-testid="admin-senior-channel"
            data-contact-channel={profile.contact_channel_pref}
          >
            {t(`profiles:contactChannel.${profile.contact_channel_pref}`)}
          </Badge>
        </Group>
        <Group gap="xs" align="center">
          <Text size="sm" c="dimmed">
            {t('profiles:senior.contactScopeLabel')}
          </Text>
          {profile.contact_scope_pref === null ? (
            <Text c="dimmed" data-testid="admin-senior-scope">
              {t('profiles:readOnly.none')}
            </Text>
          ) : (
            <Badge
              variant="light"
              data-testid="admin-senior-scope"
              data-contact-scope={profile.contact_scope_pref}
            >
              {t(`profiles:contactScope.${profile.contact_scope_pref}`)}
            </Badge>
          )}
        </Group>
        {/* AC11: where a chat contact action would be, the Phase 1 notice. */}
        {showsChatPlaceholder(profile.contact_channel_pref) ? <ChatPlaceholder /> : null}
      </Stack>

      <Stack gap="xs">
        <Title order={2} size="h5">
          {t('profiles:senior.expertiseSection')}
        </Title>
        {profile.expertise_skills.length === 0 ? (
          <Text size="sm" c="dimmed">
            {t('profiles:senior.expertiseEmpty')}
          </Text>
        ) : (
          <List data-testid="admin-senior-expertise">
            {profile.expertise_skills.map((term, index) => (
              <List.Item key={`${index}-${term}`}>{term}</List.Item>
            ))}
          </List>
        )}
      </Stack>
    </Stack>
  )
}

/** The Admin view of one Senior's profile (AC12). */
export function AdminSeniorProfileScreen() {
  const { t } = useTranslation(NAMESPACES)
  const { accountId } = useParams<{ accountId: string }>()
  const profile = useAdminSeniorProfileQuery(accountId)

  return (
    <Container size="md" py="md" data-testid="admin-senior-profile-screen">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('profiles:senior.adminTitle')}
          </Title>
          <Text c="dimmed">{t('profiles:senior.adminDescription')}</Text>
          {accountId === undefined ? null : (
            <Text size="sm" c="dimmed" data-testid="admin-senior-profile-account">
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
            data-testid="admin-senior-profile-missing-account"
          >
            {t('profiles:senior.adminMissingAccount')}
          </Alert>
        ) : profile.isPending ? (
          <LoadingState label={t('profiles:senior.adminTitle')} />
        ) : profile.isError ? (
          <ErrorState
            error={profile.error}
            onRetry={() => {
              void profile.refetch()
            }}
          />
        ) : (
          <AdminSeniorProfileView profile={profile.data} />
        )}
      </Stack>
    </Container>
  )
}
