/**
 * The Status_Notice screen (Requirement 7 AC3, AC4, AC5).
 *
 * The one screen every not-yet-approved session is allowed to see: the
 * Route_Guard admits the Onboarding_Screens and redirects everything else here
 * (Req 7 AC2), so this is the whole of the interface for an account that is
 * waiting, rejected, suspended or deactivated.
 *
 * ## It issues no request
 *
 * `GET /me/status` is the Route_Guard's, made once when the session is
 * established and retained in the session (Req 7 AC1), and an
 * `account_not_approved` envelope from anywhere replaces the retained values
 * before redirecting here (Req 7 AC6). Both are in place before this screen
 * mounts, so it reads the retained `status` and `next_step` and renders — no
 * query, no polling, no second read that could disagree with the one the guard
 * gated on. The `status === null` branch below therefore only covers a direct
 * mount in a test; through the router the guard holds its loading state until the
 * read resolves.
 *
 * ## What "the localized next step" means (AC3)
 *
 * The Backend_Api's `next_step` member is a prose sentence in a single language.
 * Rendering it verbatim would put untranslated text on a screen whose every other
 * string is localized, so its *presence* is what decides whether a next step is
 * shown while the text comes from the catalogue entry for the retained status
 * (`statusNotice.ts`). When no entry exists — a status the Backend_Api added after
 * this catalogue was written — the retained value is rendered through `BidiText`
 * instead, byte-identically and bidi-isolated (Req 19 AC10), because a next step
 * in the wrong language is still better than none.
 *
 * ## "No other action" (AC5)
 *
 * For `Rejected`, `Suspended` and `Deactivated` this screen renders text only: no
 * verification control, no navigation, no retry. The logout control AC5 pairs with
 * the notice is the shell's — it sits in the header for any authenticated session
 * — so it is not duplicated here, and the Navigation_Menu is empty for every
 * unapproved account by construction (`deriveNavigationMenu` admits no feature
 * destination while the status is not `Approved`), which is what leaves the header
 * sign-out as the only thing to activate.
 *
 * Requirements: 7.3, 7.4, 7.5.
 */

import { Alert, Anchor, Container, Paper, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { LoadingState } from '../../errors/ErrorPresenter'
import { BidiText } from '../../i18n/DirectionProvider'
import { VERIFICATION_PATH } from '../../routing/paths'
import { useRetainedStatus } from '../../session/sessionState'

import { statusNoticeSurface } from './statusNotice'

/** Namespaces this screen resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['onboarding', 'shell'] as const

/** The `/status` screen. */
export function StatusNoticeScreen() {
  const { t, i18n } = useTranslation(NAMESPACES)
  const retained = useRetainedStatus()

  if (retained === null) {
    // Unreachable through the router: the guard renders its own loading state
    // until `GET /me/status` resolves. Kept so a direct mount degrades honestly
    // instead of describing a status nobody knows yet.
    return (
      <Container size="sm" py="md" data-testid="status-notice-screen">
        <LoadingState label={t('onboarding:unknownStatus')} showLabel />
      </Container>
    )
  }

  const surface = statusNoticeSurface(retained.status)
  // AC3: the retained `next_step` decides whether a next step is shown; the
  // catalogue decides how it reads.
  const showNextStep = retained.nextStep !== null
  const hasNextStepEntry = i18n.exists(surface.nextStepKey)

  return (
    <Container size="sm" py="md" data-testid="status-notice-screen">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('onboarding:title')}
          </Title>
          <Text c="dimmed">{t('onboarding:intro')}</Text>
        </Stack>

        {/*
         * AC3: the localized description of the retained status. A description
         * list, so the label names the value and assistive technology hears the
         * association without any `aria-*` wiring.
         */}
        <Paper withBorder p="md">
          <Stack component="dl" gap={4} m={0}>
            <Text component="dt" size="sm" c="dimmed">
              {t('onboarding:statusLabel')}
            </Text>
            <Text component="dd" m={0} fw={600} data-testid="status-notice-status">
              {t(surface.statusKey)}
            </Text>
            <Text component="dd" m={0} data-testid="status-notice-description">
              {t(surface.descriptionKey)}
            </Text>
          </Stack>
        </Paper>

        {/* AC3: rendered only where the retained `next_step` member is present. */}
        {showNextStep ? (
          <Paper withBorder p="md">
            <Stack component="dl" gap={4} m={0}>
              <Text component="dt" size="sm" c="dimmed">
                {t('onboarding:nextStepLabel')}
              </Text>
              <Text component="dd" m={0} data-testid="status-notice-next-step">
                {hasNextStepEntry ? (
                  t(surface.nextStepKey)
                ) : (
                  /* No catalogue entry for this status: pass the retained value
                   * through unchanged rather than dropping the next step. */
                  <BidiText value={retained.nextStep} />
                )}
              </Text>
            </Stack>
          </Paper>
        ) : null}

        {/* AC4: PendingVerification, and only PendingVerification. */}
        {surface.verification ? (
          <Anchor
            component={Link}
            to={VERIFICATION_PATH}
            fw={500}
            data-testid="status-notice-verify"
          >
            {t('onboarding:verifyAction')}
          </Anchor>
        ) : null}

        {/*
         * AC5: text, not an action — it names the one control that is available
         * (the shell's sign-out) so the screen does not read as a dead end.
         */}
        {surface.terminal ? (
          <Alert variant="light" color="gray" data-testid="status-notice-closed">
            {t('onboarding:closedNotice')}
          </Alert>
        ) : null}
      </Stack>
    </Container>
  )
}
