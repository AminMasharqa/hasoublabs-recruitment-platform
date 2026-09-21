/**
 * `/admin/candidates/:accountId/reviews` — one Candidate's full Review_Timeline as
 * an Admin reads it (Requirement 15 AC1–AC8, AC11).
 *
 * The read is `GET /api/v1/candidates/{candidate_id}/reviews` and everything on the
 * screen is decided from the address and that read:
 *
 * - **AC1–AC3** the submission panel collects the four 1–5 ratings, the 1–2000
 *   character assessment and the optional Job_Description association, posts them,
 *   and places a 422's Field_Violations on the inputs they address while retaining
 *   every entered value.
 * - **AC4** each listed Review carries a correction control, which opens the same
 *   form pre-filled with that Review's values and submits `corrects_review_id`.
 * - **AC5** no edit control and no delete control exists anywhere on the screen.
 * - **AC6** a correcting Review and the Review it corrects each render an
 *   indicator linking them.
 * - **AC7** the timeline renders in ascending creation order.
 * - **AC8** the reviewer, Job_Description and creation-bound filters are the
 *   filter panel, and every applied value becomes a query parameter.
 * - **AC11** at most 20 Reviews per page, with the next page addressed by the last
 *   returned `seq`.
 *
 * ## The Admin scoping is the route's, not this screen's
 *
 * `/admin/candidates/:accountId/reviews` sits in the `admin` guarded group, so the
 * Route_Guard demands the Admin role above this element and a refused navigation
 * never mounts it (Req 8 AC4, AC8). That is also what makes AC10 structural: there
 * is no Candidate-context route in the tree that renders a Review_Timeline, so a
 * Candidate is not presented with one. This screen therefore holds no role check of
 * its own — a second, weaker check here would be the one a reader trusts.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.10, 15.11, 19.2, 21.6, 21.7, 21.8.
 */

import { Alert, Button, Container, Stack, Text, Title } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router-dom'

import { useCandidateReviewsQuery } from './reviewQueries'
import type { Review } from './reviewRules'
import { ReviewSubmissionPanel } from './ReviewSubmissionPanel'
import { ReviewTimeline } from './ReviewTimeline'
import { TimelineFilterPanel } from './TimelineFilterPanel'
import {
  hasActiveTimelineFilters,
  readTimelineCursor,
  readTimelineFilters,
  writeTimelineCursor,
  writeTimelineFilters,
  type TimelineFilters,
} from './timelineFilters'

/** Namespaces this screen resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['reviews', 'shell', 'errors'] as const

/** The Admin Review_Timeline of one Candidate (AC7). */
export function AdminCandidateReviewsScreen() {
  const { t } = useTranslation(NAMESPACES)
  const { accountId } = useParams<{ accountId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()

  const candidateId = (accountId ?? '').trim()
  const filters = readTimelineFilters(searchParams)
  const cursor = readTimelineCursor(searchParams)
  const timeline = useCandidateReviewsQuery(candidateId, filters, cursor)

  /** Open panel state: `undefined` closed, `null` a first Review, else a correction. */
  const [composing, setComposing] = useState<Review | null | undefined>(undefined)

  const appliedQuery = writeTimelineFilters(filters).toString()
  const filtered = hasActiveTimelineFilters(filters)

  /** Applies a filter set, starting a new keyset walk (AC8). */
  const applyFilters = (applied: TimelineFilters) => {
    setSearchParams(writeTimelineFilters(applied))
  }

  return (
    <Container size="md" py="md" data-testid="admin-candidate-reviews-screen">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('reviews:admin.title')}
          </Title>
          <Text c="dimmed">{t('reviews:admin.description')}</Text>
          {candidateId === '' ? null : (
            <Text size="sm" c="dimmed" data-testid="review-candidate-id">
              {t('reviews:candidate.label')}: {candidateId}
            </Text>
          )}
        </Stack>

        {candidateId === '' ? (
          // No Candidate in the address: nothing was asked for, so nothing is read.
          <Alert
            role="alert"
            color="yellow"
            variant="light"
            withCloseButton={false}
            data-testid="review-missing-candidate"
          >
            {t('reviews:candidate.missing')}
          </Alert>
        ) : (
          <>
            {composing === undefined ? (
              <Button
                type="button"
                onClick={() => setComposing(null)}
                data-testid="review-compose-open"
              >
                {t('reviews:form.open')}
              </Button>
            ) : (
              <ReviewSubmissionPanel
                candidateId={candidateId}
                correcting={composing}
                onClose={() => setComposing(undefined)}
              />
            )}

            {/*
              Remounted whenever the applied set changes, so the controls are seeded
              from the address rather than from a stale draft — which is what lets
              the empty state's clear-filter control reach these inputs too.
            */}
            <TimelineFilterPanel
              key={appliedQuery}
              applied={filters}
              onApply={applyFilters}
              onClear={() => setSearchParams(new URLSearchParams())}
            />

            <ReviewTimeline
              reviews={timeline.data}
              isPending={timeline.isPending}
              isError={timeline.isError}
              error={timeline.error}
              onRetry={() => {
                void timeline.refetch()
              }}
              filtered={filtered}
              onClearFilters={() => setSearchParams(new URLSearchParams())}
              onNextPage={(next) => setSearchParams(writeTimelineCursor(filters, next))}
              {...(cursor === null
                ? {}
                : { onFirstPage: () => setSearchParams(writeTimelineFilters(filters)) })}
              // AC4: the correction control opens the form pre-filled.
              onCorrect={(review) => setComposing(review)}
            />
          </>
        )}
      </Stack>
    </Container>
  )
}
