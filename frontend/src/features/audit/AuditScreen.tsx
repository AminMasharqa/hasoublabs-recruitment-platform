/**
 * `/admin/audit` — the Audit_Log_Viewer (Requirement 17).
 *
 * One read, `GET /admin/audit`, plus the on-demand chain verification, and
 * everything on the screen is decided from the address bar and those two answers:
 *
 * - **AC1** each entry renders the occurrence timestamp, the action, the entity
 *   type, the entity identifier, the outcome and the reason (`AuditEntryRow`).
 * - **AC2** the filter controls are `AuditFiltersPanel`, and every applied value
 *   becomes a query parameter through `auditQueryParams`.
 * - **AC3** the page size is the shared 20-row bound, and the next-page control
 *   carries `meta.next_after_id` as `after_id`.
 * - **AC4** while `meta.has_more` is false the next-page control is disabled —
 *   present, so the reader can see there is no more, and inert.
 * - **AC5** the selected entry's `before` and `after` render as a field-level
 *   comparison (`FieldComparisonTable`).
 * - **AC6/AC7** the verification surface is `ChainVerifyPanel`.
 * - **AC8** no control here edits or deletes anything; see below.
 * - **AC9** every timestamp is UTC with millisecond precision beside the reader's
 *   local equivalent (`AuditTimestamp`).
 *
 * ## Why the filters and the cursor live in the address bar
 *
 * The applied filter set *is* the query string, read back through
 * `readAuditFilters`. That makes a filtered audit search linkable, reload-proof and
 * navigable with the browser's own back button, which matters more here than
 * anywhere else in the application: an Admin demonstrating accountability needs to
 * be able to hand someone else the exact search they are looking at. It also gives
 * the empty state its filter retention for free — a zero-row answer changes nothing
 * about the address, so the controls still show what was asked for.
 *
 * Applying a filter deliberately drops the cursor: an `after_id` names a position
 * in one filtered result set and means nothing in another.
 *
 * ## Why the selected entry is *not* in the address bar
 *
 * Unlike the filters, the selection is ephemeral: it is a disclosure on a row of
 * the page currently on screen, and an entry identifier carried in a URL alongside
 * a filter set that no longer returns it would address nothing. So it is component
 * state, cleared implicitly whenever the page changes because the row that owned it
 * is gone.
 *
 * ## AC8 is structural
 *
 * Nothing on this screen writes. `auditApi.ts` exports two `get` reads and no
 * mutation, `auditQueries.ts` exposes no `useMutation`, and the only control on a
 * row is the comparison disclosure. An editing or deleting control could not be
 * wired up here without first adding a request function that does not exist.
 *
 * ## AC1's "WHERE the account holds the Admin role" is a property of the route
 *
 * `/admin/audit` sits in the `admin` guarded group, whose
 * {@link import('../../routing/routeAccess').ADMIN_ACCESS} demands an approved
 * Admin session. A non-Admin navigation renders the uniform authorization-denied
 * surface before this element mounts, so no Audit_Log entry is rendered for a
 * non-Admin and no search request is issued for one. This screen therefore holds no
 * role check of its own — a second, weaker check here would be the one a reader
 * trusts.
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 19.2, 20.7, 21.6, 21.7, 21.8.
 */

import { Box, Button, Container, Group, Stack, Table, Text, Title } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { EmptyState, ErrorState, LiveAnnouncement, LoadingState } from '../../errors/ErrorPresenter'
import { formatNumber } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'
import { DEFAULT_PAGE_SIZE } from '../../lib/cursor'

import { AuditEntryRow } from './AuditEntryRow'
import { AuditFiltersPanel } from './AuditFiltersPanel'
import {
  AUDIT_PARAM,
  hasActiveAuditFilters,
  nextAuditPage,
  readAuditCursor,
  readAuditFilters,
  writeAuditFilters,
  type AuditFilters,
} from './auditFilters'
import { useAuditSearchQuery } from './auditQueries'
import { ChainVerifyPanel } from './ChainVerifyPanel'
import { FieldComparisonTable } from './FieldComparisonTable'

/** Namespaces this screen resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['audit', 'shell', 'errors'] as const

/** The Audit_Log_Viewer. */
export function AuditScreen() {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const [searchParams, setSearchParams] = useSearchParams()

  const filters = readAuditFilters(searchParams)
  const cursor = readAuditCursor(searchParams)
  const search = useAuditSearchQuery(filters, cursor)

  const appliedQuery = writeAuditFilters(filters).toString()
  const filtered = hasActiveAuditFilters(filters)
  const entries = search.data?.data ?? []
  const next = nextAuditPage(search.data)

  /** The entry whose comparison is open (AC5), or `null`. */
  const [selectedId, setSelectedId] = useState<number | null>(null)

  /** Applies a filter set, starting a new keyset walk (AC2). */
  const applyFilters = (applied: AuditFilters) => {
    setSelectedId(null)
    setSearchParams(writeAuditFilters(applied))
  }

  /** Drops every filter and returns to the unfiltered first page (Req 21 AC7). */
  const clearFilters = () => {
    setSelectedId(null)
    setSearchParams(new URLSearchParams())
  }

  /** Walks to the page `meta.next_after_id` addresses (AC3). */
  const goToNextPage = (afterId: number) => {
    const params = writeAuditFilters(filters)
    params.set(AUDIT_PARAM.cursor, String(afterId))
    setSelectedId(null)
    setSearchParams(params)
  }

  return (
    <Container size="xl" py="md" data-testid="audit-screen">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('audit:title')}
          </Title>
          <Text c="dimmed">{t('audit:description')}</Text>
          {/* AC8, stated where a reader of the screen will see it. */}
          <Text size="sm" c="dimmed" data-testid="audit-read-only-notice">
            {t('audit:readOnly')}
          </Text>
        </Stack>

        {/* AC6, AC7. */}
        <ChainVerifyPanel />

        {/*
          Remounted whenever the applied set changes, so the controls are seeded
          from the address rather than from a stale draft — which is what makes the
          clear-filter control of the empty state reach these inputs too.
        */}
        <AuditFiltersPanel
          key={appliedQuery}
          applied={filters}
          onApply={applyFilters}
          onClear={clearFilters}
        />

        <Text size="sm" c="dimmed" data-testid="audit-page-size">
          {t('audit:pagination.pageSize', { size: formatNumber(DEFAULT_PAGE_SIZE, locale) })}
        </Text>

        {search.isPending ? (
          <LoadingState label={t('audit:loading')} />
        ) : search.isError ? (
          <>
            <ErrorState
              error={search.error}
              onRetry={() => {
                void search.refetch()
              }}
            />
            <LiveAnnouncement message={t('audit:announce.failed')} assertive />
          </>
        ) : entries.length === 0 ? (
          <>
            {filtered ? (
              <EmptyState
                destination={t('shell:nav.audit')}
                filtered
                onClearFilters={clearFilters}
              />
            ) : (
              <EmptyState destination={t('shell:nav.audit')} />
            )}
            <LiveAnnouncement message={t('audit:announce.empty')} />
          </>
        ) : (
          <>
            <Box data-testid="audit-list">
              {/*
                Req 20 AC9: a 320px viewport gets a horizontally scrollable region
                rather than a squeezed or overflowing seven-column table — the same
                pattern `reports/CandidateProgressTable.tsx` uses.
              */}
              <Table.ScrollContainer minWidth={320}>
                <Table
                  withTableBorder
                  striped
                  highlightOnHover
                  captionSide="top"
                  aria-label={t('audit:table.label')}
                >
                  <Table.Caption>{t('audit:table.caption')}</Table.Caption>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th scope="col">{t('audit:column.occurredAt')}</Table.Th>
                      <Table.Th scope="col">{t('audit:column.action')}</Table.Th>
                      <Table.Th scope="col">{t('audit:column.entityType')}</Table.Th>
                      <Table.Th scope="col">{t('audit:column.entityId')}</Table.Th>
                      <Table.Th scope="col">{t('audit:column.outcome')}</Table.Th>
                      <Table.Th scope="col">{t('audit:column.reason')}</Table.Th>
                      <Table.Th scope="col">{t('audit:column.comparison')}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {entries.map((entry) => {
                      const selected = selectedId === entry.id
                      return [
                        <AuditEntryRow
                          key={entry.id}
                          entry={entry}
                          selected={selected}
                          onToggleSelect={() => setSelectedId(selected ? null : entry.id)}
                        />,
                        // AC5: the comparison of the selected entry, in a row of its
                        // own so the two-column table is not squeezed into a cell.
                        selected ? (
                          <Table.Tr key={`${entry.id}-comparison`}>
                            <Table.Td colSpan={7} id={`audit-comparison-panel-${entry.id}`}>
                              <FieldComparisonTable
                                before={entry.before}
                                after={entry.after}
                                entryId={entry.id}
                              />
                            </Table.Td>
                          </Table.Tr>
                        ) : null,
                      ]
                    })}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Box>

            <Group gap="sm">
              {/*
                AC3 and AC4: always present, carrying `meta.next_after_id`, and
                disabled while `meta.has_more` is false. `aria-disabled` is set
                alongside the native attribute so assistive technology reports the
                control as present-but-unavailable rather than silently skipping it.
              */}
              <Button
                type="button"
                disabled={!next.hasNextPage}
                aria-disabled={!next.hasNextPage}
                onClick={() => {
                  if (next.hasNextPage) {
                    goToNextPage(next.nextCursor)
                  }
                }}
                data-testid="audit-next-page"
              >
                {t('audit:pagination.next')}
              </Button>
              {cursor === null ? null : (
                <Button
                  type="button"
                  variant="default"
                  onClick={() => {
                    setSelectedId(null)
                    setSearchParams(writeAuditFilters(filters))
                  }}
                  data-testid="audit-first-page"
                >
                  {t('audit:pagination.first')}
                </Button>
              )}
            </Group>

            <LiveAnnouncement message={t('audit:announce.loaded')} />
          </>
        )}
      </Stack>
    </Container>
  )
}
