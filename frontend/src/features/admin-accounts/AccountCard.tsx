/**
 * One listed account (Requirement 16 AC1) together with the controls it offers
 * (AC7–AC14).
 *
 * AC1 fixes what is rendered per account: the email address, the role set, the
 * Account_Status, the language preference, the creation timestamp and the enrolment
 * indicator. All six come from the one `AccountDTO` the list returned, so there is
 * no second read behind this card and no field it has to guess.
 *
 * The status is rendered from the cached account, which the lifecycle mutation
 * replaces with the Backend_Api's answer on a 200 — so AC15's "render the returned
 * Account_Status" happens here without this component knowing a transition took
 * place.
 *
 * The creation timestamp is formatted per the active Locale in UTC, with the
 * authoritative UTC instant rendered beside it (Req 19 AC12): an Admin comparing a
 * lifecycle decision against the Audit_Log needs the same instant both surfaces
 * quote.
 *
 * Requirements: 16.1, 16.15, 19.2, 19.10, 19.12.
 */

import { Badge, Card, Group, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { BidiText } from '../../i18n/DirectionProvider'
import { formatDateTime, utcTimestamp } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'
import { LOCALE_VALUES } from '../../forms/validators'

import { AccountLifecycleControls } from './AccountLifecycleControls'
import { AccountRolesControl } from './AccountRolesControl'
import { normalizeRoleSet, type Account } from './accountRules'

/** Namespaces the card resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['adminAccounts', 'shell'] as const

/** Colour per Account_Status, so the lifecycle is readable at a glance. */
const STATUS_COLOURS: Readonly<Record<string, string>> = Object.freeze({
  PendingVerification: 'gray',
  PendingApproval: 'yellow',
  ApprovedPendingMeeting: 'blue',
  Approved: 'green',
  Rejected: 'red',
  Suspended: 'orange',
  Deactivated: 'dark',
})

export interface AccountCardProps {
  /** The account this card renders. */
  readonly account: Account
}

/** One listed account and its controls (AC1, AC7–AC14). */
export function AccountCard({ account }: AccountCardProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)

  const roles = normalizeRoleSet(account.roles)
  /**
   * The language preference, named in the reader's Locale when it names a supported
   * one and rendered verbatim otherwise — an account may carry a preference this
   * build does not offer, and hiding that would misreport the stored value.
   */
  const languageLabel = LOCALE_VALUES.includes(account.language_preference)
    ? t(`shell:locale.${account.language_preference}`)
    : account.language_preference

  return (
    <Card
      component="li"
      withBorder
      padding="md"
      data-testid={`account-card-${account.id}`}
      data-account-status={account.status}
    >
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <Stack gap={2}>
            <Text fw={600} data-testid={`account-email-${account.id}`}>
              <BidiText value={account.email} />
            </Text>
            <Text size="sm" c="dimmed" data-testid={`account-created-${account.id}`}>
              {t('adminAccounts:card.created', {
                value: formatDateTime(account.created_at, locale),
              })}{' '}
              <Text component="span" size="xs" c="dimmed">
                {t('adminAccounts:card.utc', { value: utcTimestamp(account.created_at) })}
              </Text>
            </Text>
          </Stack>

          <Group gap="xs" wrap="wrap">
            <Badge
              variant="light"
              color={STATUS_COLOURS[account.status] ?? 'gray'}
              data-testid={`account-status-${account.id}`}
            >
              {t(`adminAccounts:status.${account.status}`)}
            </Badge>
            {/* AC1: the enrolment indicator. */}
            <Badge
              variant="outline"
              color={account.mfa_enrolled ? 'green' : 'gray'}
              data-testid={`account-mfa-${account.id}`}
              data-mfa-enrolled={account.mfa_enrolled ? 'true' : 'false'}
            >
              {account.mfa_enrolled
                ? t('adminAccounts:card.mfaEnrolled')
                : t('adminAccounts:card.mfaNotEnrolled')}
            </Badge>
          </Group>
        </Group>

        <Group gap="xs" wrap="wrap">
          <Text size="sm" c="dimmed">
            {t('adminAccounts:card.roles')}
          </Text>
          <Group gap={4} data-testid={`account-role-set-${account.id}`}>
            {roles.length === 0 ? (
              <Text size="sm" c="dimmed">
                {t('adminAccounts:card.noRoles')}
              </Text>
            ) : (
              roles.map((role) => (
                <Badge key={role} variant="default" size="sm">
                  {t(`adminAccounts:role.${role}`)}
                </Badge>
              ))
            )}
          </Group>
        </Group>

        <Text size="sm" c="dimmed" data-testid={`account-language-${account.id}`}>
          {t('adminAccounts:card.language', { value: languageLabel })}
        </Text>

        <AccountLifecycleControls account={account} />
        <AccountRolesControl account={account} />
      </Stack>
    </Card>
  )
}
