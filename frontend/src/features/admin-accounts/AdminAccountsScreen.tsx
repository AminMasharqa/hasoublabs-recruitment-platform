/**
 * `/admin/accounts` — Admin account management (Requirement 16).
 *
 * One read, `GET /api/v1/admin/accounts`, and everything on the screen is decided
 * from the address bar and that read:
 *
 * - **AC1** each account renders its six contract fields (`AccountCard`).
 * - **AC2** the status and role filters are `AccountFiltersPanel`, and every applied
 *   value becomes a query parameter through `accountsQueryParams`.
 * - **AC3** the page size is the shared 20-row bound of `lib/cursor.ts`, and the
 *   next-page control carries the last returned account identifier as `after_id`.
 * - **AC4–AC6** the create-link control and the single rendering of the token it
 *   returns are `RegistrationLinkPanel`.
 * - **AC7–AC16** the per-account controls, in `AccountLifecycleControls` and
 *   `AccountRolesControl`.
 * - **AC17** the pending-skill review is the second view of this destination,
 *   addressed as `?view=pending-skills`.
 *
 * ## Why the filters and the cursor live in the address bar
 *
 * The applied filter set *is* the query string, read back through
 * `readAccountFilters`. A filtered page is then linkable, reload-proof and walkable
 * with the browser's back button, and the filter values stay on screen through an
 * empty result without a second source of truth. Applying a filter drops the cursor:
 * `after_id` names a position in one filtered result set and means nothing in
 * another.
 *
 * ## Admin-only is a property of the route, not of this screen
 *
 * `/admin/accounts` sits in the `admin` guarded group, whose `ADMIN_ACCESS` demands
 * the Admin role, so an unauthorized navigation renders the uniform denial before
 * this element mounts and no account request is issued from it (Req 8 AC4, AC8).
 * This screen therefore holds no role check of its own — a second, weaker check here
 * would be the one a reader trusts.
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.15, 16.17, 19.2, 20.7, 21.6, 21.7, 21.8.
 */

import { Anchor, Box, Button, Container, Group, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { EmptyState, ErrorState, LiveAnnouncement, LoadingState } from '../../errors/ErrorPresenter'
import { formatNumber } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'
import { DEFAULT_PAGE_SIZE } from '../../lib/cursor'
import { ROUTE_PATHS } from '../../routing/paths'

import { AccountCard } from './AccountCard'
import { AccountFiltersPanel } from './AccountFiltersPanel'
import {
  ACCOUNTS_PARAM,
  hasActiveAccountFilters,
  nextAccountsPage,
  pendingSkillsSearch,
  PENDING_SKILLS_VIEW,
  readAccountCursor,
  readAccountFilters,
  readAccountsView,
  writeAccountFilters,
  type AccountFilters,
} from './accountFilters'
import { useAccountsQuery } from './accountQueries'
import { PendingSkillsPanel } from './PendingSkillsPanel'
import { RegistrationLinkPanel } from './RegistrationLinkPanel'

/** Namespaces this screen resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['adminAccounts', 'shell', 'errors'] as const

/** The account list, its filters, its pagination and the create-link control. */
function AccountsView() {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const [searchParams, setSearchParams] = useSearchParams()

  const filters = readAccountFilters(searchParams)
  const cursor = readAccountCursor(searchParams)
  const accounts = useAccountsQuery(filters, cursor)

  const appliedQuery = writeAccountFilters(filters).toString()
  const filtered = hasActiveAccountFilters(filters)
  const items = accounts.data ?? []
  const next = nextAccountsPage(accounts.data)

  /** Applies a filter set, starting a new keyset walk (AC2). */
  const applyFilters = (applied: AccountFilters) => {
    setSearchParams(writeAccountFilters(applied))
  }

  /** Walks to the page beginning after the last account of this one (AC3). */
  const goToNextPage = (afterId: string) => {
    const params = writeAccountFilters(filters)
    params.set(ACCOUNTS_PARAM.afterId, afterId)
    setSearchParams(params)
  }

  return (
    <>
      <RegistrationLinkPanel />

      {/*
        Remounted whenever the applied set changes, so the controls are seeded from
        the address rather than from a stale draft — which is what lets the empty
        state's clear-filter control reach these inputs too.
      */}
      <AccountFiltersPanel
        key={appliedQuery}
        applied={filters}
        onApply={applyFilters}
        onClear={() => setSearchParams(new URLSearchParams())}
      />

      <Text size="sm" c="dimmed" data-testid="accounts-page-size">
        {t('adminAccounts:pagination.pageSize', {
          size: formatNumber(DEFAULT_PAGE_SIZE, locale),
        })}
      </Text>

      {accounts.isPending ? (
        <LoadingState label={t('adminAccounts:title')} />
      ) : accounts.isError ? (
        <>
          <ErrorState
            error={accounts.error}
            onRetry={() => {
              void accounts.refetch()
            }}
          />
          <LiveAnnouncement message={t('adminAccounts:announce.failed')} assertive />
        </>
      ) : items.length === 0 ? (
        <>
          {filtered ? (
            <EmptyState
              destination={t('shell:nav.accounts')}
              filtered
              onClearFilters={() => setSearchParams(new URLSearchParams())}
            />
          ) : (
            <EmptyState destination={t('shell:nav.accounts')} />
          )}
          <LiveAnnouncement message={t('adminAccounts:announce.empty')} />
        </>
      ) : (
        <>
          <Box
            component="ul"
            aria-label={t('adminAccounts:listLabel')}
            data-testid="accounts-list"
            style={{ listStyle: 'none', margin: 0, padding: 0 }}
          >
            <Stack gap="md">
              {items.map((account) => (
                <AccountCard key={account.id} account={account} />
              ))}
            </Stack>
          </Box>

          <Group gap="sm">
            {/* AC3: enabled only while a further page is reported. */}
            {next.hasNextPage ? (
              <Button
                type="button"
                onClick={() => goToNextPage(next.nextCursor)}
                data-testid="accounts-next-page"
              >
                {t('shell:action.nextPage')}
              </Button>
            ) : null}
            {cursor === null ? null : (
              <Button
                type="button"
                variant="default"
                onClick={() => setSearchParams(writeAccountFilters(filters))}
                data-testid="accounts-first-page"
              >
                {t('adminAccounts:pagination.first')}
              </Button>
            )}
          </Group>

          <LiveAnnouncement message={t('adminAccounts:announce.loaded')} />
        </>
      )}
    </>
  )
}

/** The Admin account-management screen (Requirement 16). */
export function AdminAccountsScreen() {
  const { t } = useTranslation(NAMESPACES)
  const [searchParams] = useSearchParams()
  const view = readAccountsView(searchParams)
  const reviewing = view === PENDING_SKILLS_VIEW

  return (
    <Container size="lg" py="md" data-testid="admin-accounts-screen" data-view={view}>
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('adminAccounts:title')}
          </Title>
          <Text c="dimmed">{t('adminAccounts:description')}</Text>
        </Stack>

        {/*
          AC17: the pending-skill review as the second view of this destination. It
          carries its own address, so it is linkable and the back button returns from
          it, without adding a route the Navigation_Menu of Req 8 AC8 does not name.
        */}
        <Group gap="sm">
          {reviewing ? (
            <Anchor
              component={Link}
              to={ROUTE_PATHS.adminAccounts}
              data-testid="accounts-view-accounts"
            >
              {t('adminAccounts:view.accounts')}
            </Anchor>
          ) : (
            <Anchor
              component={Link}
              to={{ pathname: ROUTE_PATHS.adminAccounts, search: pendingSkillsSearch().toString() }}
              data-testid="accounts-view-pending-skills"
            >
              {t('adminAccounts:view.pendingSkills')}
            </Anchor>
          )}
        </Group>

        {reviewing ? <PendingSkillsPanel /> : <AccountsView />}
      </Stack>
    </Container>
  )
}
