/**
 * `/candidate/profile` — the Candidate's own profile (Requirement 9 AC1, AC9,
 * AC10, AC13).
 *
 * The read is `GET /api/v1/me/profile` and everything on the screen is decided
 * from its answer:
 *
 * - **AC1** the profile is loaded while the Active_Context is `CANDIDATE`. The
 *   route group already guarantees the context (`routes.tsx`), so this screen
 *   simply reads.
 * - **AC9/AC10** the completeness panel or the completeness confirmation, taken
 *   from the *reported* `state` of the persisted profile. It sits above the editor
 *   because it is the answer to "what do I still have to do", which is the reason
 *   a Candidate opens this screen.
 * - **AC13** the consequence for applying is stated here, beside its cause. The
 *   apply controls themselves live on the job screens and read the same
 *   `applyEligibility` predicate, so there is one rule and two places that
 *   present it.
 *
 * ## A profile that does not exist yet
 *
 * The Backend_Api creates a Candidate's profile row on registration, so the
 * expected answer is always a profile. A 404 is nonetheless treated as "nothing
 * saved yet" rather than as an error: an empty editor is something a Candidate can
 * act on, whereas an error surface on the screen whose whole purpose is to create
 * the missing thing is a dead end. Every other failure goes to the Error_Presenter
 * with its Support_Reference and a retry control (Req 21 AC8).
 *
 * The editor is keyed on the loaded profile's `updated_at`, so the one case where
 * the form must re-seed from the server — the profile changed underneath this
 * browsing context and was re-read — remounts it, while ordinary re-renders and a
 * cache write from a successful save leave the entered values alone.
 *
 * Requirements: 9.1, 9.9, 9.10, 9.13, 19.2, 20.7, 21.6, 21.8.
 */

import { Badge, Container, Group, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { isApiFailure } from '../../../api/client'
import { ErrorState, LoadingState } from '../../../errors/ErrorPresenter'

import { CandidateProfileForm } from './CandidateProfileForm'
import {
  isProfileComplete,
  missingCompletenessFields,
  profileState,
} from './completeness'
import { ApplyBlockedNotice, CompletenessPanel } from './CompletenessPanel'
import type { CandidateProfile } from './model'
import { useMyProfileQuery } from './profileQueries'

/** Namespaces this screen resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['profiles', 'shell', 'errors'] as const

/** Whether a failure means "no profile saved yet" rather than a failed read. */
function isAbsentProfile(error: unknown): boolean {
  return isApiFailure(error) && error.httpStatus === 404
}

export interface CandidateProfileViewProps {
  /** The persisted profile, or `null` when nothing is saved yet. */
  readonly profile: CandidateProfile | null
}

/**
 * The state badge, the completeness surface and the editor.
 *
 * Split from the screen so a test can mount it against a fixture profile without
 * a query, and so the Draft/Complete branch is one expression.
 */
export function CandidateProfileView({ profile }: CandidateProfileViewProps) {
  const { t } = useTranslation(NAMESPACES)
  const complete = isProfileComplete(profile)
  const state = profileState(profile)

  return (
    <Stack gap="lg">
      <Group gap="xs" align="center">
        <Text size="sm" c="dimmed">
          {t('profiles:candidate.stateLabel')}
        </Text>
        <Badge
          variant="light"
          color={complete ? 'green' : 'yellow'}
          data-testid="profile-state"
          data-profile-state={state}
        >
          {t(`profiles:state.${state}`)}
        </Badge>
      </Group>

      {/* AC9 on Draft, AC10 on Complete. */}
      <CompletenessPanel complete={complete} missingFields={missingCompletenessFields(profile)} />

      {/* AC13: applying is off while the profile is a Draft, and this says why. */}
      {complete ? null : <ApplyBlockedNotice />}

      <CandidateProfileForm
        key={profile?.updated_at ?? 'absent'}
        profile={profile}
      />
    </Stack>
  )
}

/** The Candidate profile management screen. */
export function CandidateProfileScreen() {
  const { t } = useTranslation(NAMESPACES)
  const profile = useMyProfileQuery()

  return (
    <Container size="md" py="md" data-testid="candidate-profile-screen">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('profiles:candidate.title')}
          </Title>
          <Text c="dimmed">{t('profiles:candidate.description')}</Text>
        </Stack>

        {profile.isPending ? (
          <LoadingState label={t('profiles:candidate.title')} />
        ) : profile.isError && !isAbsentProfile(profile.error) ? (
          <ErrorState
            error={profile.error}
            onRetry={() => {
              void profile.refetch()
            }}
          />
        ) : (
          <CandidateProfileView profile={profile.data ?? null} />
        )}
      </Stack>
    </Container>
  )
}
