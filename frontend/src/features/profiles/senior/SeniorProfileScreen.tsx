/**
 * `/senior/profile` — the Senior's own profile and contact preferences
 * (Requirement 10 AC1).
 *
 * The read is `GET /api/v1/me/senior-profile` and the editor is seeded from its
 * answer. AC1's "while the Active_Context is `SENIOR`" is structural rather than
 * checked here: the route sits in the `senior` guard group (`routing/routes.tsx`),
 * so the screen cannot mount outside that context.
 *
 * ## A profile that does not exist yet
 *
 * The Backend_Api creates an empty Senior profile on the first read, so the
 * expected answer is always a profile. A 404 is nonetheless treated as "nothing
 * saved yet" rather than as an error: an empty editor is something a Senior can
 * act on, whereas an error surface on the screen whose purpose is to fill the
 * missing thing in is a dead end. Every other failure goes to the Error_Presenter
 * with its Support_Reference and a retry control (Req 21 AC8).
 *
 * The editor is keyed on the loaded profile's `updated_at`, so the one case where
 * the form must re-seed from the server — the profile changed underneath this
 * browsing context and was re-read — remounts it, while ordinary re-renders and the
 * cache write of a successful save leave the entered values alone.
 *
 * Requirements: 10.1, 19.2, 21.6, 21.8.
 */

import { Container, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { isApiFailure } from '../../../api/client'
import { ErrorState, LoadingState } from '../../../errors/ErrorPresenter'

import type { SeniorProfile } from './model'
import { useMySeniorProfileQuery } from './profileQueries'
import { SeniorProfileForm } from './SeniorProfileForm'

/** Namespaces this screen resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['profiles', 'shell', 'errors'] as const

/** Whether a failure means "no profile saved yet" rather than a failed read. */
function isAbsentProfile(error: unknown): boolean {
  return isApiFailure(error) && error.httpStatus === 404
}

export interface SeniorProfileViewProps {
  /** The persisted profile, or `null` when nothing is saved yet. */
  readonly profile: SeniorProfile | null
  /** The account's registered email address, when the caller holds it (AC10). */
  readonly accountEmail?: string | null
}

/**
 * The editor for one Senior profile.
 *
 * Split from the screen so a test can mount it against a fixture profile without a
 * query.
 */
export function SeniorProfileView({ profile, accountEmail = null }: SeniorProfileViewProps) {
  return (
    <Stack gap="lg">
      <SeniorProfileForm
        key={profile?.updated_at ?? 'absent'}
        profile={profile}
        accountEmail={accountEmail}
      />
    </Stack>
  )
}

/** The Senior profile management screen. */
export function SeniorProfileScreen() {
  const { t } = useTranslation(NAMESPACES)
  const profile = useMySeniorProfileQuery()

  return (
    <Container size="md" py="md" data-testid="senior-profile-screen">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('profiles:senior.title')}
          </Title>
          <Text c="dimmed">{t('profiles:senior.description')}</Text>
        </Stack>

        {profile.isPending ? (
          <LoadingState label={t('profiles:senior.title')} />
        ) : profile.isError && !isAbsentProfile(profile.error) ? (
          <ErrorState
            error={profile.error}
            onRetry={() => {
              void profile.refetch()
            }}
          />
        ) : (
          <SeniorProfileView profile={profile.data ?? null} />
        )}
      </Stack>
    </Container>
  )
}
