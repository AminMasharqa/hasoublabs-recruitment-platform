/**
 * `/admin/reports` — the activity and candidate-progress reports, with the export
 * control beside them (Requirement 18 AC1–AC11).
 *
 * Two reads and one panel:
 *
 * - **AC1, AC2** the activity report, under the date-range and Job_Description
 *   filters the address bar carries. Every returned metric is rendered by
 *   {@link ActivityReportPanel}.
 * - **AC3, AC4** the candidate-progress report: at most 20 rows per page, and a
 *   next-page control that sends the response's `next_cursor` as `after_id`.
 * - **AC5** every row carries drill-down controls to the account, the
 *   Job_Description and the Application.
 * - **AC6–AC10** {@link ExportPanel}, which receives the same applied filters the
 *   activity report is read with. Its polling never blocks this screen: both
 *   reports stay readable, refetchable and filterable while an export runs
 *   (AC10).
 *
 * ## The filters and the cursor live in the address bar
 *
 * The applied filter set *is* the query string, read back through
 * `readReportFilters`. That makes a filtered report linkable and reload-proof,
 * keeps the controls showing what was asked for when a read comes back empty, and
 * lets the browser's own back button walk the candidate-progress pages. Applying a
 * filter deliberately drops the cursor: a cursor names a position in one result
 * set and means nothing in another.
 *
 * The date range and the Job_Description bound the activity report and the export
 * only. `GET /admin/reports/candidate-progress` declares neither parameter, so its
 * page is unaffected by them — see `reportFilters.ts`.
 *
 * ## AC11 is a property of the route, not of this screen
 *
 * `/admin/reports` and `/admin/exports` sit in the `admin` guarded group, whose
 * {@link import('../../routing/routeAccess').ADMIN_ACCESS} demands the Admin role,
 * and the Navigation_Menu derives its entries from that same metadata. So no report
 * or export destination is presented or reachable while the Active_Context is
 * `CANDIDATE` or `SENIOR`, and this screen holds no role check of its own — a
 * second, weaker check here would be the one a reader trusts.
 *
 * Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9, 18.10,
 * 18.11, 19.2, 20.7, 21.6, 21.7, 21.8.
 */

import { Button, Container, Group, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { EmptyState, ErrorState, LiveAnnouncement, LoadingState } from '../../errors/ErrorPresenter'
import { formatNumber } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'
import { DEFAULT_PAGE_SIZE } from '../../lib/cursor'

import { ActivityReportPanel } from './ActivityReportPanel'
import { CandidateProgressTable } from './CandidateProgressTable'
import { ExportPanel } from './ExportPanel'
import { ReportFilterControls } from './ReportFilterControls'
import { useActivityReportQuery, useCandidateProgressQuery } from './reportQueries'
import {
  hasActiveReportFilters,
  nextProgressPage,
  readProgressCursor,
  readReportFilters,
  writeReportFilters,
  REPORT_PARAM,
  type ReportFilters,
} from './reportFilters'

/** Namespaces this screen resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['reports', 'shell', 'errors'] as const

/** The reports destination. */
export function ReportsScreen() {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const [searchParams, setSearchParams] = useSearchParams()

  const filters = readReportFilters(searchParams)
  const cursor = readProgressCursor(searchParams)
  const appliedQuery = writeReportFilters(filters).toString()
  const filtered = hasActiveReportFilters(filters)

  const activity = useActivityReportQuery(filters)
  const progress = useCandidateProgressQuery(cursor)
  const rows = progress.data?.rows ?? []
  const next = nextProgressPage(progress.data)

  /** Applies a filter set, starting the candidate-progress walk again (AC2). */
  const applyFilters = (applied: ReportFilters) => {
    setSearchParams(writeReportFilters(applied))
  }

  /** Walks to the page the response's `next_cursor` addresses (AC4). */
  const goToNextPage = (token: string) => {
    const params = writeReportFilters(filters)
    params.set(REPORT_PARAM.cursor, token)
    setSearchParams(params)
  }

  return (
    <Container size="lg" py="md" data-testid="reports-screen">
      <Stack gap="lg">
        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('reports:title')}
          </Title>
          <Text c="dimmed">{t('reports:description')}</Text>
        </Stack>

        {/*
          Remounted whenever the applied set changes, so the controls are seeded
          from the address rather than from a stale draft.
        */}
        <ReportFilterControls
          key={appliedQuery}
          applied={filters}
          onApply={applyFilters}
          onClear={() => setSearchParams(new URLSearchParams())}
        />

        {/* AC6–AC10. Rendered above the reports so the progress indicator is not
            pushed below a long table, and independent of both reads. */}
        <ExportPanel filters={filters} />

        <Stack gap="sm">
          <Title order={2} size="h4">
            {t('reports:activity.title')}
          </Title>
          {activity.isPending ? (
            <LoadingState label={t('reports:activity.loading')} />
          ) : activity.isError ? (
            <>
              <ErrorState
                error={activity.error}
                onRetry={() => {
                  void activity.refetch()
                }}
              />
              <LiveAnnouncement message={t('reports:announce.activityFailed')} assertive />
            </>
          ) : (
            <>
              <ActivityReportPanel report={activity.data} />
              <LiveAnnouncement message={t('reports:announce.activityLoaded')} />
            </>
          )}
        </Stack>

        <Stack gap="sm">
          <Title order={2} size="h4">
            {t('reports:progress.title')}
          </Title>
          <Text size="sm" c="dimmed" data-testid="progress-page-size">
            {t('reports:progress.pageSize', { size: formatNumber(DEFAULT_PAGE_SIZE, locale) })}
          </Text>

          {progress.isPending ? (
            <LoadingState label={t('reports:progress.loading')} />
          ) : progress.isError ? (
            <>
              <ErrorState
                error={progress.error}
                onRetry={() => {
                  void progress.refetch()
                }}
              />
              <LiveAnnouncement message={t('reports:announce.progressFailed')} assertive />
            </>
          ) : rows.length === 0 ? (
            <>
              {filtered ? (
                <EmptyState
                  destination={t('shell:nav.reports')}
                  filtered
                  onClearFilters={() => setSearchParams(new URLSearchParams())}
                />
              ) : (
                <EmptyState destination={t('shell:nav.reports')} />
              )}
              <LiveAnnouncement message={t('reports:announce.progressEmpty')} />
            </>
          ) : (
            <>
              <CandidateProgressTable rows={rows} />
              <Group gap="sm">
                {/* AC4: enabled only while the response advertises a usable token. */}
                {next.hasNextPage ? (
                  <Button
                    type="button"
                    onClick={() => goToNextPage(next.nextCursor)}
                    data-testid="progress-next-page"
                  >
                    {t('shell:action.nextPage')}
                  </Button>
                ) : null}
                {cursor === null ? null : (
                  <Button
                    type="button"
                    variant="default"
                    onClick={() => setSearchParams(writeReportFilters(filters))}
                    data-testid="progress-first-page"
                  >
                    {t('reports:progress.firstPage')}
                  </Button>
                )}
              </Group>
              <LiveAnnouncement message={t('reports:announce.progressLoaded')} />
            </>
          )}
        </Stack>
      </Stack>
    </Container>
  )
}
