/**
 * The two outcomes a saved profile can have (Requirement 9 AC9, AC10) and the
 * apply-control consequence of one of them (AC13).
 *
 * - `Draft` → {@link CompletenessPanel} names every field required for `Complete`
 *   that the returned profile does not satisfy. Named, not counted: "4 fields
 *   missing" tells a Candidate nothing they can act on.
 * - `Complete` → {@link CompletenessPanel} renders the confirmation AC10 asks for
 *   instead.
 *
 * {@link ApplyBlockedNotice} states the AC13 consequence on the profile screen
 * itself. The apply controls live on the job screens, and they read the same
 * predicate (`applyEligibility`) rather than a second copy of this rule — but a
 * Candidate looking at a draft profile deserves to be told here that applying is
 * off, rather than discovering it on a job they wanted.
 *
 * Both are announced through `role="status"` so a screen reader hears the outcome
 * of the save without focus being taken from wherever the user left it
 * (Req 20 AC7).
 */

import { Alert, List, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import type { CompletenessField } from './completeness'

/** Namespaces this surface resolves against (Req 19 AC2). */
const NAMESPACES = ['profiles', 'shell'] as const

export interface CompletenessPanelProps {
  /** Whether the Backend_Api reported the profile as `Complete` (AC10). */
  readonly complete: boolean
  /** The fields still unmet, in the order they are named (AC9). */
  readonly missingFields: readonly CompletenessField[]
}

/** The completeness panel (AC9) or the completeness confirmation (AC10). */
export function CompletenessPanel({ complete, missingFields }: CompletenessPanelProps) {
  const { t } = useTranslation(NAMESPACES)

  if (complete) {
    return (
      <Alert
        role="status"
        variant="light"
        color="green"
        title={t('profiles:complete.title')}
        withCloseButton={false}
        data-testid="profile-complete-confirmation"
      >
        {t('profiles:complete.body')}
      </Alert>
    )
  }

  return (
    <Alert
      role="status"
      variant="light"
      color="yellow"
      title={t('profiles:completeness.title')}
      withCloseButton={false}
      data-testid="profile-completeness-panel"
    >
      <Stack gap="xs">
        <Text size="sm">{t('profiles:completeness.description')}</Text>
        {missingFields.length === 0 ? (
          // The Backend_Api reported `Draft` while the returned profile satisfies
          // every field this client knows about. Its classification stands, so say
          // so plainly rather than rendering an empty list of reasons.
          <Text size="sm" data-testid="profile-completeness-generic">
            {t('profiles:completeness.generic')}
          </Text>
        ) : (
          <List size="sm" data-testid="profile-completeness-missing">
            {missingFields.map((field) => (
              <List.Item key={field} data-missing-field={field}>
                {t(`profiles:completeness.field.${field}`)}
              </List.Item>
            ))}
          </List>
        )}
      </Stack>
    </Alert>
  )
}

/** The AC13 consequence of a `Draft` profile, stated where it is caused. */
export function ApplyBlockedNotice() {
  const { t } = useTranslation(NAMESPACES)
  return (
    <Alert
      role="status"
      variant="outline"
      color="gray"
      title={t('profiles:apply.blockedTitle')}
      withCloseButton={false}
      data-testid="apply-blocked-notice"
    >
      {t('profiles:apply.blockedBody')}
    </Alert>
  )
}
