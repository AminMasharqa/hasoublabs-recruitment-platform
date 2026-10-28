/**
 * `/candidate/applications` — the Candidate's own Applications (Requirement 14 AC9,
 * AC10).
 *
 * One read, `GET /api/v1/me/applications`, and everything on the screen is decided
 * from it and from the address bar:
 *
 * - **AC9** each entry renders the role title, the company, the status and the
 *   submission date (`ApplicationCard`), ordered newest first by
 *   `orderApplicationsNewestFirst` rather than by whatever order the response
 *   happened to arrive in.
 * - **AC10** the page size is the shared 20-row bound of `lib/cursor.ts`, and the
 *   next-page control carries the last returned Application identifier as `after_id`.
 *
 * The cursor lives in the address bar, so a page is linkable, survives a reload and
 * is walkable with the browser's back button — the same round trip the job browse and
 * account lists use.
 *
 * The Candidate Active_Context is the route group's requirement (`CANDIDATE_ACCESS`),
 * so AC9's "while the Active_Context is CANDIDATE" is structural: this screen holds no
 * context check of its own, and a Senior or Admin session never mounts it
 * (Requirement 8 AC4, AC6).
 *
 * Requirements: 14.9, 14.10, 19.2, 19.12, 20.7, 21.6, 21.7, 21.8.
 */

import { Box, Button, Container, Group, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { EmptyState, ErrorState, LiveAnnouncement, LoadingState } from '../../errors/ErrorPresenter'
import { formatNumber } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'

import { ApplicationCard } from './ApplicationCard'
import { useMyApplicationsQuery } from './applicationQueries'
import {
  APPLICATIONS_PAGE_SIZE,
  nextApplicationsPage,
  orderApplicationsNewestFirst,
} from './applicationRules'
import { readApplicationsCursor, writeApplicationsCursor } from './selection'

/** Namespaces this screen resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['applications', 'shell', 'errors'] as const

/** The Candidate's own Application list (AC9, AC10). */
export function MyApplicationsScreen() {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const [searchParams, setSearchParams] = useSearchParams()

  const cursor = readApplicationsCursor(searchParams)
  const applications = useMyApplicationsQuery(cursor)

  // AC9: newest first, decided here rather than trusted from the response.
  const items = orderApplicationsNewestFirst(applications.data)
  // AC10: the cursor names where the Backend_Api stopped, so it is derived from the
  // response order rather than from the display order.
  const next = nextApplicationsPage(applications.data)

  return (
    <Container size="md" py="md" data-testid="my-applications-screen">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('applications:mine.title')}
          </Title>
          <Text c="dimmed">{t('applications:mine.description')}</Text>
        </Stack>

        <Text size="sm" c="dimmed" data-testid="applications-page-size">
          {t('applications:mine.pageSize', {
            size: formatNumber(APPLICATIONS_PAGE_SIZE, locale),
          })}
        </Text>

        {applications.isPending ? (
          <LoadingState label={t('applications:mine.loading')} />
        ) : applications.isError ? (
          <>
            <ErrorState
              error={applications.error}
              onRetry={() => {
                void applications.refetch()
              }}
            />
            <LiveAnnouncement message={t('applications:announce.listFailed')} assertive />
          </>
        ) : items.length === 0 ? (
          <>
            {/* No filter control exists on this list, so there is none to clear. */}
            <EmptyState
              destination={t('shell:nav.applications')}
              description={cursor === null ? undefined : t('applications:mine.emptyPage')}
            >
              {cursor === null ? null : (
                <Button
                  type="button"
                  variant="default"
                  onClick={() => setSearchParams(new URLSearchParams())}
                  data-testid="applications-first-page"
                >
                  {t('applications:mine.first')}
                </Button>
              )}
            </EmptyState>
            <LiveAnnouncement message={t('applications:announce.listEmpty')} />
          </>
        ) : (
          <>
            <Box
              component="ul"
              aria-label={t('applications:mine.listLabel')}
              data-testid="applications-list"
              style={{ listStyle: 'none', margin: 0, padding: 0 }}
            >
              <Stack gap="md">
                {items.map((application) => (
                  <ApplicationCard key={application.id} application={application} />
                ))}
              </Stack>
            </Box>

            <Group gap="sm">
              {/* AC10: enabled only while a further page is reported. */}
              {next.hasNextPage ? (
                <Button
                  type="button"
                  onClick={() => setSearchParams(writeApplicationsCursor(next.nextCursor))}
                  data-testid="applications-next-page"
                >
                  {t('shell:action.nextPage')}
                </Button>
              ) : null}
              {cursor === null ? null : (
                <Button
                  type="button"
                  variant="default"
                  onClick={() => setSearchParams(new URLSearchParams())}
                  data-testid="applications-first-page"
                >
                  {t('applications:mine.first')}
                </Button>
              )}
            </Group>

            <LiveAnnouncement message={t('applications:announce.listLoaded')} />
          </>
        )}
      </Stack>
    </Container>
  )
}
