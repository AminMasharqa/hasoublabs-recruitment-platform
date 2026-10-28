/**
 * The role control of one account (Requirement 16 AC13, AC14).
 *
 * AC13 asks for a control that calls `PUT /admin/accounts/{account_id}/roles` with
 * the *complete* target role set, so the control is a checkbox group over the three
 * platform roles rather than an add/remove pair: what is submitted is exactly what
 * is on screen, and there is no partial update to reason about.
 *
 * ## AC14, client-side
 *
 * `ADMIN` together with any other role is refused before a request is issued: the
 * save control is disabled and the rule is stated as text beside it, associated
 * with the group through `aria-describedby` (Req 20 AC6). Disabled rather than
 * hidden — a control that vanishes explains nothing.
 *
 * The block is an aid, not a verdict (Req 22 AC12): the Backend_Api enforces the
 * same exclusivity constraint, and a 422 it reports still renders here through the
 * Error_Presenter.
 *
 * Requirements: 16.13, 16.14, 16.15, 19.2, 20.5, 20.6, 20.7.
 */

import { Button, Checkbox, Group, Stack, Text } from '@mantine/core'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorPresenter, LiveAnnouncement } from '../../errors/ErrorPresenter'
import { ROLE_VALUES } from '../../forms/validators'

import { useUpdateAccountRoles } from './accountQueries'
import { normalizeRoleSet, roleSetRefusal, type Account } from './accountRules'

/** Namespaces the control resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['adminAccounts', 'shell', 'errors'] as const

export interface AccountRolesControlProps {
  /** The account whose role set this control replaces. */
  readonly account: Account
}

/** The complete-role-set control of one account (AC13, AC14). */
export function AccountRolesControl({ account }: AccountRolesControlProps) {
  const { t } = useTranslation(NAMESPACES)
  const scope = useId()
  const update = useUpdateAccountRoles()

  const [draft, setDraft] = useState<readonly string[]>(() => normalizeRoleSet(account.roles))

  const refusal = roleSetRefusal(account, draft)
  const reasonId = `${scope}-roles-reason`
  /** AC14 and the empty set are stated; "unchanged" needs no sentence. */
  const statedRefusal = refusal === 'admin_exclusive' || refusal === 'empty' ? refusal : null

  return (
    <Stack gap="xs" data-testid={`account-roles-${account.id}`}>
      <Checkbox.Group
        label={t('adminAccounts:roles.label')}
        description={t('adminAccounts:roles.hint')}
        value={[...draft]}
        onChange={(selected) => {
          update.reset()
          setDraft(normalizeRoleSet(selected))
        }}
        {...(statedRefusal === null ? {} : { 'aria-describedby': reasonId })}
        data-testid={`account-roles-group-${account.id}`}
      >
        <Group gap="md" pt={4}>
          {ROLE_VALUES.values.map((role) => (
            <Checkbox
              key={role}
              value={role}
              label={t(`adminAccounts:role.${role}`)}
              data-testid={`account-role-${role}-${account.id}`}
            />
          ))}
        </Group>
      </Checkbox.Group>

      {/* AC14: the rule is stated, not merely enacted. */}
      {statedRefusal === null ? null : (
        <Text id={reasonId} size="sm" c="red" data-testid={`account-roles-refusal-${account.id}`}>
          {t(`adminAccounts:roles.refusal.${statedRefusal}`)}
        </Text>
      )}

      {update.isError ? <ErrorPresenter error={update.error} /> : null}

      <Group gap="sm">
        <Button
          type="button"
          size="xs"
          disabled={refusal !== null}
          loading={update.isPending}
          onClick={() => {
            update.mutate({ accountId: account.id, roles: draft })
          }}
          data-testid={`account-roles-save-${account.id}`}
        >
          {t('adminAccounts:roles.save')}
        </Button>
        {refusal === 'unchanged' ? null : (
          <Button
            type="button"
            size="xs"
            variant="default"
            disabled={update.isPending}
            onClick={() => {
              update.reset()
              setDraft(normalizeRoleSet(account.roles))
            }}
            data-testid={`account-roles-reset-${account.id}`}
          >
            {t('shell:action.cancel')}
          </Button>
        )}
      </Group>

      {/* Req 20 AC7: announced without moving focus. */}
      <LiveAnnouncement message={update.isSuccess ? t('adminAccounts:announce.rolesSaved') : null} />
    </Stack>
  )
}
