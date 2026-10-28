/**
 * `/jobs` — browsing Job_Descriptions (Requirement 12 AC1–AC5, AC7, AC11).
 *
 * One read, `GET /api/v1/jobs`, and everything on the screen is decided from the
 * address bar and that read:
 *
 * - **AC1** each entry renders the seven contract fields (`JobCard`).
 * - **AC2** the filter controls are `JobFilters`, and every applied value becomes
 *   a query parameter through `browseQueryParams`.
 * - **AC3** the page size is the shared 20-row bound of `cursor.ts`.
 * - **AC4** while `has_next` is reported with a usable `next_cursor`, the
 *   next-page control carries that token as the keyset cursor of the next request.
 * - **AC5** a zero-item page renders the localized empty state while the applied
 *   filter values stay in the address and in the controls.
 * - **AC7** a `Closed` entry carries the closed indicator and a disabled apply
 *   control, from the components the detail view uses.
 *
 * ## Why the filters and the cursor live in the address bar
 *
 * The applied filter set *is* the query string, read back through
 * `readBrowseFilters`. That gives AC5's retention for free — an empty result
 * changes nothing about the address, so the controls still show what was asked
 * for — and it makes a filtered list linkable, reload-proof and navigable with the
 * browser's own back button, which a component-state filter set is none of.
 *
 * Applying a filter deliberately drops the cursor: a token names a position in one
 * filtered result set and means nothing in another, so a changed filter set starts
 * a new keyset walk from the first page.
 *
 * ## AC11 is a property of the route, not of this screen
 *
 * `/jobs` and `/jobs/:jdId` sit under the `job-browsing` guarded group, whose
 * {@link import('../../routing/routeAccess').JOB_BROWSING_ACCESS} demands an
 * approved Candidate or Senior session. An unauthenticated navigation is
 * redirected to the login screen before this element mounts, so no
 * Job_Description is rendered on an unauthenticated route and no browse request is
 * issued from one. This screen therefore holds no authentication check of its
 * own — a second, weaker check here would be the one a reader trusts.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.7, 12.11, 19.2, 20.7, 21.6, 21.7, 21.8.
 */

import { Box, Button, Container, Group, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { EmptyState, ErrorState, LiveAnnouncement, LoadingState } from '../../errors/ErrorPresenter'
import { formatNumber } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'
import { DEFAULT_PAGE_SIZE } from '../../lib/cursor'

import {
  hasActiveFilters,
  nextBrowsePage,
  readBrowseCursor,
  readBrowseFilters,
  writeBrowseFilters,
  BROWSE_PARAM,
  type JobBrowseFilters,
} from './browseFilters'
import { JobCard } from './JobCard'
import { JobFilters } from './JobFilters'
import { useJobBrowseQuery } from './jobQueries'

/** Namespaces this screen resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['jobs', 'shell', 'errors'] as const

/** The Job_Description browse screen. */
export function JobsBrowseScreen() {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const [searchParams, setSearchParams] = useSearchParams()

  const filters = readBrowseFilters(searchParams)
  const cursor = readBrowseCursor(searchParams)
  const browse = useJobBrowseQuery(filters, cursor)

  const appliedQuery = writeBrowseFilters(filters).toString()
  const filtered = hasActiveFilters(filters)
  const items = browse.data?.items ?? []
  const next = nextBrowsePage(browse.data)

  /** Applies a filter set, starting a new keyset walk (AC2). */
  const applyFilters = (applied: JobBrowseFilters) => {
    setSearchParams(writeBrowseFilters(applied))
  }

  /** Walks to the page the response's `next_cursor` addresses (AC4). */
  const goToNextPage = (token: string) => {
    const params = writeBrowseFilters(filters)
    params.set(BROWSE_PARAM.cursor, token)
    setSearchParams(params)
  }

  return (
    <Container size="lg" py="md" data-testid="jobs-browse-screen">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('jobs:browse.title')}
          </Title>
          <Text c="dimmed">{t('jobs:browse.description')}</Text>
        </Stack>

        {/*
          Remounted whenever the applied set changes, so the controls are seeded
          from the address rather than from a stale draft — which is what makes the
          clear-filter control of the empty state reach these inputs too (AC5).
        */}
        <JobFilters
          key={appliedQuery}
          applied={filters}
          onApply={applyFilters}
          onClear={() => setSearchParams(new URLSearchParams())}
        />

        <Text size="sm" c="dimmed" data-testid="jobs-page-size">
          {t('jobs:pagination.pageSize', { size: formatNumber(DEFAULT_PAGE_SIZE, locale) })}
        </Text>

        {browse.isPending ? (
          <LoadingState label={t('jobs:browse.loading')} />
        ) : browse.isError ? (
          <>
            <ErrorState
              error={browse.error}
              onRetry={() => {
                void browse.refetch()
              }}
            />
            <LiveAnnouncement message={t('jobs:announce.failed')} assertive />
          </>
        ) : items.length === 0 ? (
          <>
            {/* AC5: the applied values stay in the address, so they stay on screen. */}
            {filtered ? (
              <EmptyState
                destination={t('shell:nav.jobs')}
                filtered
                onClearFilters={() => setSearchParams(new URLSearchParams())}
              />
            ) : (
              <EmptyState destination={t('shell:nav.jobs')} />
            )}
            <LiveAnnouncement message={t('jobs:announce.empty')} />
          </>
        ) : (
          <>
            <Box
              component="ul"
              aria-label={t('jobs:browse.resultsLabel')}
              data-testid="jobs-list"
              style={{ listStyle: 'none', margin: 0, padding: 0 }}
            >
              <Stack gap="md">
                {items.map((job) => (
                  <JobCard key={job.id} job={job} />
                ))}
              </Stack>
            </Box>

            <Group gap="sm">
              {/* AC4: enabled only while the response advertises a usable token. */}
              {next.hasNextPage ? (
                <Button
                  type="button"
                  onClick={() => goToNextPage(next.nextCursor)}
                  data-testid="jobs-next-page"
                >
                  {t('jobs:pagination.next')}
                </Button>
              ) : null}
              {cursor === null ? null : (
                <Button
                  type="button"
                  variant="default"
                  onClick={() => setSearchParams(writeBrowseFilters(filters))}
                  data-testid="jobs-first-page"
                >
                  {t('jobs:pagination.first')}
                </Button>
              )}
            </Group>

            <LiveAnnouncement message={t('jobs:announce.loaded')} />
          </>
        )}
      </Stack>
    </Container>
  )
}
