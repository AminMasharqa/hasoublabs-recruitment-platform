/**
 * `/admin/jobs` — the Admin all-status listing (Requirement 13 AC17).
 *
 * `GET /api/v1/jobs` browses `Open` Job_Descriptions only, so this read is the one
 * through which a `Draft` or a `Closed` posting is reachable at all. AC17 asks for
 * every status plus a status filter control, and both live in the address bar: the
 * applied filter *is* the query string, which makes a filtered listing linkable,
 * reload-proof and navigable with the browser's back button.
 *
 * Pagination is `after_id`, not a token: the endpoint reports `has_next` but always
 * answers `next_cursor: null`, so the cursor is the identifier of the last row
 * returned — see `nextAdminJobsPage`. Changing the filter drops the cursor, because a
 * position in one filtered result set means nothing in another.
 *
 * Each row links to the authoring surface, which is where the lifecycle controls of
 * AC11–AC16 live. The Admin role is required by the route group (`ADMIN_ACCESS`), so
 * AC17's "WHERE the authenticated account holds the Admin role" is structural rather
 * than a check this screen performs on itself (Req 8 AC4, AC8).
 *
 * Requirements: 13.17, 19.2, 19.10, 20.7, 21.6, 21.7, 21.8.
 */

import { Anchor, Box, Button, Container, Group, Paper, Select, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import type { JdStatus } from '../../api/enums'
import { EmptyState, ErrorState, LiveAnnouncement, LoadingState } from '../../errors/ErrorPresenter'
import { JD_STATUS_VALUES } from '../../forms/validators'
import { BidiText } from '../../i18n/DirectionProvider'
import { formatDateTime, formatNumber } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'
import { DEFAULT_PAGE_SIZE } from '../../lib/cursor'
import { ROUTE_PATHS, adminJobPath } from '../../routing/paths'

import {
  readAdminJobsCursor,
  readAdminJobStatus,
  writeAdminJobsParams,
} from './adminJobFilters'
import { nextAdminJobsPage } from './authoringApi'
import { useAdminJobsQuery } from './authoringQueries'
import { JobField } from './JobCard'
import type { JobDescription } from './jobsApi'
import { JobStatusBadge } from './JobStatusControls'

/** Namespaces this screen resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['jobs', 'shell', 'errors'] as const

interface AdminJobRowProps {
  readonly job: JobDescription
}

/** One listing row: the fields an Admin scans, and the link to author it. */
function AdminJobRow({ job }: AdminJobRowProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const notStated = t('jobs:card.notStated')

  return (
    <Paper withBorder p="md" component="li" data-testid={`admin-job-${job.id}`}>
      <Stack gap="xs">
        <Group gap="xs" justify="space-between" wrap="wrap">
          <Title order={3} size="h5">
            <BidiText value={job.title} />
          </Title>
          <JobStatusBadge status={job.status} />
        </Group>
        <Group gap="lg" wrap="wrap">
          <JobField label={t('jobs:card.company')} testId={`admin-job-company-${job.id}`}>
            <BidiText value={job.company} />
          </JobField>
          <JobField label={t('jobs:card.location')} testId={`admin-job-location-${job.id}`}>
            {job.location === null || job.location === '' ? (
              notStated
            ) : (
              <BidiText value={job.location} />
            )}
          </JobField>
          <JobField label={t('jobs:card.publishedAt')} testId={`admin-job-published-${job.id}`}>
            {job.published_at === null
              ? t('jobs:card.notPublished')
              : formatDateTime(job.published_at, locale)}
          </JobField>
          <JobField label={t('jobs:detail.creator')} testId={`admin-job-creator-${job.id}`}>
            {job.creator_account_id}
          </JobField>
        </Group>
        <Anchor
          component={Link}
          to={adminJobPath(job.id)}
          size="sm"
          aria-label={t('jobs:authoring.manageFor', { title: job.title })}
          data-testid={`admin-job-manage-${job.id}`}
        >
          {t('jobs:authoring.manage')}
        </Anchor>
      </Stack>
    </Paper>
  )
}

/** The Admin all-status Job_Description listing (AC17). */
export function AdminJobsScreen() {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const [searchParams, setSearchParams] = useSearchParams()

  const status = readAdminJobStatus(searchParams)
  const cursor = readAdminJobsCursor(searchParams)
  const listing = useAdminJobsQuery(status, cursor)

  const items = listing.data?.items ?? []
  const next = nextAdminJobsPage(listing.data)

  /** Applies a status filter, starting a new keyset walk. */
  const applyStatus = (selected: JdStatus | null): void => {
    setSearchParams(writeAdminJobsParams(selected))
  }

  const goToPage = (afterId: string | null): void => {
    setSearchParams(writeAdminJobsParams(status, afterId))
  }

  return (
    <Container size="lg" py="md" data-testid="admin-jobs-screen">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('jobs:admin.title')}
          </Title>
          <Text c="dimmed">{t('jobs:admin.description')}</Text>
        </Stack>

        <Group gap="sm" align="flex-end" wrap="wrap">
          {/* AC17: the status filter control. */}
          <Select
            label={t('jobs:status.label')}
            placeholder={t('jobs:admin.anyStatus')}
            data={JD_STATUS_VALUES.values.map((value) => ({
              value,
              label: t(`jobs:status.${value}`),
            }))}
            value={status}
            clearable
            comboboxProps={{ withinPortal: false }}
            onChange={(value) => applyStatus((value as JdStatus | null) ?? null)}
            data-testid="admin-jobs-status-filter"
          />
          <Button
            component={Link}
            to={ROUTE_PATHS.adminJobNew}
            variant="light"
            data-testid="admin-jobs-create"
          >
            {t('jobs:authoring.create')}
          </Button>
        </Group>

        <Text size="sm" c="dimmed" data-testid="admin-jobs-page-size">
          {t('jobs:pagination.pageSize', { size: formatNumber(DEFAULT_PAGE_SIZE, locale) })}
        </Text>

        {listing.isPending ? (
          <LoadingState label={t('jobs:browse.loading')} />
        ) : listing.isError ? (
          <>
            <ErrorState
              error={listing.error}
              onRetry={() => {
                void listing.refetch()
              }}
            />
            <LiveAnnouncement message={t('jobs:announce.failed')} assertive />
          </>
        ) : items.length === 0 ? (
          <>
            {status === null ? (
              <EmptyState destination={t('jobs:admin.title')} />
            ) : (
              <EmptyState
                destination={t('jobs:admin.title')}
                filtered
                onClearFilters={() => applyStatus(null)}
              />
            )}
            <LiveAnnouncement message={t('jobs:announce.empty')} />
          </>
        ) : (
          <>
            <Box
              component="ul"
              aria-label={t('jobs:admin.resultsLabel')}
              data-testid="admin-jobs-list"
              style={{ listStyle: 'none', margin: 0, padding: 0 }}
            >
              <Stack gap="md">
                {items.map((job) => (
                  <AdminJobRow key={job.id} job={job} />
                ))}
              </Stack>
            </Box>

            <Group gap="sm">
              {next.hasNextPage ? (
                <Button
                  type="button"
                  onClick={() => goToPage(next.nextCursor)}
                  data-testid="admin-jobs-next-page"
                >
                  {t('jobs:pagination.next')}
                </Button>
              ) : null}
              {cursor === null ? null : (
                <Button
                  type="button"
                  variant="default"
                  onClick={() => goToPage(null)}
                  data-testid="admin-jobs-first-page"
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
