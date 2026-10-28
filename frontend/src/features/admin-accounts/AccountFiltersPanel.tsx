/**
 * The Account_Status and role filter controls (Requirement 16 AC2).
 *
 * AC2 fixes the set at exactly two, and each applied value becomes a query
 * parameter of `GET /api/v1/admin/accounts` — that mapping is `accountFilters.ts`,
 * so this file only collects values.
 *
 * ## Why the filters are applied on submit
 *
 * The panel edits a draft and hands the whole set to
 * {@link AccountFiltersPanelProps.onApply} when the form is submitted. A keyset
 * walk restarts whenever the filter set changes, so applying on every change would
 * throw away the Admin's page position mid-decision; and each application is one
 * request and one history entry rather than one per keystroke.
 *
 * The draft is seeded from the applied set and the accounts screen remounts this
 * panel whenever that set changes, so the controls keep showing what was asked for
 * even when the result is empty — which is what makes the empty state's
 * clear-filter control reach these inputs (Req 21 AC7).
 *
 * Requirements: 16.2, 19.2, 20.3, 20.5.
 */

import { Button, Fieldset, Group, Select, Stack } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AccountStatus, Role } from '../../api/enums'
import { ROLE_VALUES } from '../../forms/validators'

import {
  ACCOUNT_STATUS_VALUES,
  EMPTY_ACCOUNT_FILTERS,
  type AccountFilters,
} from './accountFilters'

/** Namespaces the panel resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['adminAccounts', 'shell'] as const

export interface AccountFiltersPanelProps {
  /** The filter set currently applied to the list, i.e. the one in the address. */
  readonly applied: AccountFilters
  /** Called with the edited set when the panel is submitted (AC2). */
  readonly onApply: (filters: AccountFilters) => void
  /** Called when both filters are to be dropped. */
  readonly onClear: () => void
}

/** The status and role filters (AC2). */
export function AccountFiltersPanel({ applied, onApply, onClear }: AccountFiltersPanelProps) {
  const { t } = useTranslation(NAMESPACES)
  const [draft, setDraft] = useState<AccountFilters>(applied)

  return (
    <form
      data-testid="account-filters"
      onSubmit={(event) => {
        event.preventDefault()
        onApply(draft)
      }}
      onReset={(event) => {
        event.preventDefault()
        setDraft(EMPTY_ACCOUNT_FILTERS)
        onClear()
      }}
    >
      <Fieldset legend={t('adminAccounts:filters.legend')}>
        <Stack gap="sm">
          <Select
            label={t('adminAccounts:filters.status')}
            placeholder={t('adminAccounts:filters.any')}
            data={ACCOUNT_STATUS_VALUES.values.map((value) => ({
              value,
              label: t(`adminAccounts:status.${value}`),
            }))}
            value={draft.status}
            clearable
            comboboxProps={{ withinPortal: false }}
            onChange={(value) =>
              setDraft((current) => ({
                ...current,
                status: (value as AccountStatus | null) ?? null,
              }))
            }
            data-testid="account-filter-status"
          />

          <Select
            label={t('adminAccounts:filters.role')}
            placeholder={t('adminAccounts:filters.any')}
            data={ROLE_VALUES.values.map((value) => ({
              value,
              label: t(`adminAccounts:role.${value}`),
            }))}
            value={draft.role}
            clearable
            comboboxProps={{ withinPortal: false }}
            onChange={(value) =>
              setDraft((current) => ({ ...current, role: (value as Role | null) ?? null }))
            }
            data-testid="account-filter-role"
          />

          <Group gap="sm">
            <Button type="submit" data-testid="account-filters-apply">
              {t('adminAccounts:filters.apply')}
            </Button>
            <Button type="reset" variant="default" data-testid="account-filters-clear">
              {t('shell:action.clearFilters')}
            </Button>
          </Group>
        </Stack>
      </Fieldset>
    </form>
  )
}
