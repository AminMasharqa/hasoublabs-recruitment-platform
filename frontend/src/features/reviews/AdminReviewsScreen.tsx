/**
 * `/admin/reviews` — the Admin Review_Timeline destination, which is a Candidate
 * picker plus the timeline of whichever Candidate the address names (Requirement 15
 * AC1–AC8, AC11).
 *
 * The Navigation_Menu presents "Reviews" as an Admin destination (Req 8 AC8) while
 * every review endpoint is scoped to one Candidate. So this screen collects the
 * Candidate — into the `candidate` query parameter, where the address keeps it — and
 * then renders the same timeline `/admin/candidates/:accountId/reviews` renders, from
 * the same components. Nothing is duplicated: the two addresses differ only in where
 * the Candidate comes from, and the whole screen is composed rather than copied.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.11, 19.2.
 */

import { Button, Container, Divider, Paper, Stack, Text, Title } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { CandidateSelector } from './CandidateSelector'
import { CANDIDATE_PARAM, readCandidateId, writeCandidateId } from './candidateSelection'
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

/** The Admin reviews destination: pick a Candidate, then read their timeline. */
export function AdminReviewsScreen() {
  const { t } = useTranslation(NAMESPACES)
  const [searchParams, setSearchParams] = useSearchParams()

  const candidateId = readCandidateId(searchParams)
  const filters = readTimelineFilters(searchParams)
  const cursor = readTimelineCursor(searchParams)
  const timeline = useCandidateReviewsQuery(candidateId, filters, cursor)

  /** Open panel state: `undefined` closed, `null` a first Review, else a correction. */
  const [composing, setComposing] = useState<Review | null | undefined>(undefined)

  const appliedQuery = writeTimelineFilters(filters).toString()
  const filtered = hasActiveTimelineFilters(filters)

  /** The address of a filter set, keeping the selected Candidate (AC8). */
  const addressFor = (applied: TimelineFilters): URLSearchParams => {
    const params = writeTimelineFilters(applied)
    if (candidateId !== '') {
      params.set(CANDIDATE_PARAM, candidateId)
    }
    return params
  }

  return (
    <Container size="md" py="md" data-testid="admin-reviews-screen">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('reviews:admin.title')}
          </Title>
          <Text c="dimmed">{t('reviews:admin.description')}</Text>
        </Stack>

        <Paper withBorder p="md">
          <CandidateSelector
            candidateId={candidateId}
            // Selecting a Candidate drops the filters and the cursor: both name
            // positions in one Candidate's timeline.
            onSelect={(selected) => {
              setComposing(undefined)
              setSearchParams(writeCandidateId(selected))
            }}
          />
        </Paper>

        {candidateId === '' ? (
          <Text c="dimmed" data-testid="review-no-candidate">
            {t('reviews:candidate.none')}
          </Text>
        ) : (
          <>
            <Divider />

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

            <TimelineFilterPanel
              key={`${candidateId}:${appliedQuery}`}
              applied={filters}
              onApply={(applied) => setSearchParams(addressFor(applied))}
              onClear={() => setSearchParams(writeCandidateId(candidateId))}
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
              onClearFilters={() => setSearchParams(writeCandidateId(candidateId))}
              onNextPage={(next) => {
                const params = writeTimelineCursor(filters, next)
                params.set(CANDIDATE_PARAM, candidateId)
                setSearchParams(params)
              }}
              {...(cursor === null ? {} : { onFirstPage: () => setSearchParams(addressFor(filters)) })}
              onCorrect={(review) => setComposing(review)}
            />
          </>
        )}
      </Stack>
    </Container>
  )
}
