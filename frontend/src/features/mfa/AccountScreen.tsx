/**
 * The `/account` screen: what the session says about the signed-in account, and —
 * for an Admin — the multi-factor enrolment state and the enrolment controls
 * (Requirement 5 AC4, AC5, AC6, AC7).
 *
 * | criterion | here |
 * | --- | --- |
 * | AC7 the enrolment indicator comes from the `mfa_enrolled` member of the account payload | {@link MfaEnrolmentIndicator}, `findOwnAccount` |
 * | AC4, AC5, AC6 the enrolment screen and its verification control | {@link MfaEnrolmentPanel} |
 *
 * ## Why the multi-factor section is Admin-only
 *
 * All three criteria are written `WHERE the authenticated account holds the Admin
 * role`, and both endpoints are Admin-only on the Backend_Api. The section is
 * therefore rendered from the `roles` claim rather than from the Active_Context: an
 * Admin acting as a Candidate still holds the role, and the second factor belongs
 * to the account, not to the context it is currently acting in.
 *
 * The screen itself sits in the session-wide guard group, so it is reachable in
 * every Active_Context; a non-Admin sees the identity facts and no multi-factor
 * section, because there is nothing there that applies to them.
 *
 * ## Why `mfa_enrolled` is read from the account list
 *
 * There is no `GET /me` carrying the account payload — see `mfaEnrolment.ts`. The
 * one read that returns an `AccountDTO` for the caller is the Admin account list,
 * so the row is located there. A failure to find it renders "not known" rather than
 * "not enrolled": AC7 asks the screen to report the `mfa_enrolled` member, and a
 * member it never read is not a member reporting `false`.
 *
 * Requirements: 5.4, 5.5, 5.6, 5.7, 19.2, 20.7, 21.6, 21.8.
 */

import { Badge, Container, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState, LoadingState } from '../../errors/ErrorPresenter'
import { BidiText } from '../../i18n/DirectionProvider'
import { usePrincipal } from '../../session/sessionState'
import { useApiClient } from '../../shell/appServices'

import { MfaEnrolmentPanel } from './MfaEnrolmentPanel'
import { findOwnAccount, ownAccountQueryKey, type Account } from './mfaEnrolment'

/** Namespaces the screen resolves its strings against (Requirement 19 AC2). */
const NAMESPACES = ['auth', 'shell', 'errors'] as const

/** The role the multi-factor section belongs to (AC4, AC6, AC7). */
const ADMIN_ROLE = 'ADMIN'

interface FactProps {
  readonly label: string
  readonly children: ReactNode
  readonly testId?: string
}

/**
 * One labelled account fact.
 *
 * A description list, as on the diagnostics screen: the label names the value and
 * nothing more, so `dt`/`dd` is what assistive technology should hear and the
 * association needs no `aria-*` wiring.
 */
function Fact({ label, children, testId }: FactProps) {
  return (
    <Stack component="dl" gap={4} m={0} data-testid={testId}>
      <Text component="dt" size="sm" c="dimmed">
        {label}
      </Text>
      <Text component="dd" m={0}>
        {children}
      </Text>
    </Stack>
  )
}

interface MfaEnrolmentIndicatorProps {
  readonly account: Account
}

/** The enrolment state, read from `mfa_enrolled` (AC7). */
function MfaEnrolmentIndicator({ account }: MfaEnrolmentIndicatorProps) {
  const { t } = useTranslation(NAMESPACES)
  return (
    <Badge
      variant="outline"
      color={account.mfa_enrolled ? 'green' : 'gray'}
      data-testid="account-mfa-enrolled"
      data-mfa-enrolled={account.mfa_enrolled ? 'true' : 'false'}
    >
      {account.mfa_enrolled ? t('auth:mfa.enrolled') : t('auth:mfa.notEnrolled')}
    </Badge>
  )
}

interface AdminMfaSectionProps {
  readonly accountId: string
}

/** The Admin multi-factor section: the indicator and the enrolment panel. */
function AdminMfaSection({ accountId }: AdminMfaSectionProps) {
  const { t } = useTranslation(NAMESPACES)
  const api = useApiClient()
  const queryClient = useQueryClient()

  const own = useQuery<Account | null>({
    queryKey: ownAccountQueryKey(accountId),
    queryFn: ({ signal }) => findOwnAccount(api, accountId, signal),
  })

  return (
    <Stack gap="md">
      <Paper withBorder p="md" data-testid="account-mfa-state">
        <Stack gap="xs">
          <Title order={2} size="h5">
            {t('auth:mfa.stateTitle')}
          </Title>
          {own.isPending ? (
            <LoadingState label={t('auth:mfa.stateTitle')} />
          ) : own.isError ? (
            <ErrorState
              error={own.error}
              onRetry={() => {
                void own.refetch()
              }}
            />
          ) : own.data === null ? (
            <Text size="sm" data-testid="account-mfa-unknown">
              {t('auth:mfa.enrolmentUnknown')}
            </Text>
          ) : (
            <Group gap="xs" align="center" wrap="wrap">
              <MfaEnrolmentIndicator account={own.data} />
            </Group>
          )}
        </Stack>
      </Paper>

      {/* AC4, AC5, AC6. */}
      <MfaEnrolmentPanel
        accountId={accountId}
        onVerified={() => {
          // A verified code means the stored secret is the one the authenticator
          // holds, so the indicator is re-read from the Backend_Api rather than
          // guessed at locally.
          void queryClient.invalidateQueries({ queryKey: ownAccountQueryKey(accountId) })
        }}
      />
    </Stack>
  )
}

/**
 * The `/account` screen.
 *
 * Registered by the shell through the route `elements` table for the `account`
 * path id; it holds no route knowledge of its own.
 */
export function AccountScreen() {
  const { t } = useTranslation(NAMESPACES)
  const principal = usePrincipal()

  return (
    <Container size="sm" py="md" data-testid="account-screen">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('shell:nav.account')}
          </Title>
          <Text c="dimmed">{t('auth:account.description')}</Text>
        </Stack>

        {principal === null ? (
          // The guard above this screen redirects an unauthenticated visit, so this
          // is the honest answer for the one frame in which a session is ending.
          <Text data-testid="account-no-session">{t('shell:session.expired')}</Text>
        ) : (
          <>
            <Paper withBorder p="md" data-testid="account-identity">
              <Stack gap="sm">
                <Fact label={t('auth:account.id')} testId="account-id">
                  <Text component="span" ff="monospace">
                    <BidiText value={principal.sub} />
                  </Text>
                </Fact>
                <Fact label={t('auth:account.activeContext')} testId="account-active-context">
                  {t(`shell:context.${principal.act}`)}
                </Fact>
                <Fact label={t('auth:account.roles')} testId="account-roles">
                  <Group gap="xs" component="span" wrap="wrap">
                    {principal.roles.map((role) => (
                      <Badge key={role} variant="light" data-testid={`account-role-${role}`}>
                        {t(`shell:context.${role}`)}
                      </Badge>
                    ))}
                  </Group>
                </Fact>
              </Stack>
            </Paper>

            {/* AC4, AC6, AC7: WHERE the account holds the Admin role. */}
            {principal.roles.includes(ADMIN_ROLE) ? (
              <AdminMfaSection accountId={principal.sub} />
            ) : null}
          </>
        )}
      </Stack>
    </Container>
  )
}
