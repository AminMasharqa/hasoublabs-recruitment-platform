/**
 * `/senior/reviews` — a Senior's own Reviews of one Candidate (Requirement 15 AC1–AC6,
 * AC9, AC11).
 *
 * The read is `GET /api/v1/candidates/{candidate_id}/reviews/mine`, and that choice of
 * endpoint *is* AC9: the own-only scoping is the Backend_Api's, applied before the
 * response is formed, so there is no request on this screen in which another
 * reviewer's Review could arrive and then be filtered out client-side. The Admin
 * endpoint is not reachable from here at all.
 *
 * The filter controls of AC8 are deliberately absent: `/reviews/mine` declares no
 * `reviewer_id`, `jd_id`, `date_from` or `date_to` parameter — a reviewer filter over
 * one's own Reviews would be meaningless anyway — and sending a parameter the endpoint
 * does not declare would earn a 422. It does accept `limit` and `after_seq`, so the
 * 20-row page and the keyset walk of AC11 work exactly as on the Admin timeline.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.9, 15.11, 19.2, 21.6, 21.7, 21.8.
 */

import { Button, Container, Divider, Paper, Stack, Text, Title } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { CandidateSelector } from './CandidateSelector'
import { readCandidateId, writeCandidateId } from './candidateSelection'
import { useOwnReviewsQuery } from './reviewQueries'
import type { Review } from './reviewRules'
import { ReviewSubmissionPanel } from './ReviewSubmissionPanel'
import { ReviewTimeline } from './ReviewTimeline'
import { readTimelineCursor, TIMELINE_PARAM } from './timelineFilters'

/** Namespaces this screen resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['reviews', 'shell', 'errors'] as const

/** The Senior own-only Review_Timeline (AC9). */
export function SeniorReviewsScreen() {
  const { t } = useTranslation(NAMESPACES)
  const [searchParams, setSearchParams] = useSearchParams()

  const candidateId = readCandidateId(searchParams)
  const cursor = readTimelineCursor(searchParams)
  const timeline = useOwnReviewsQuery(candidateId, cursor)

  /** Open panel state: `undefined` closed, `null` a first Review, else a correction. */
  const [composing, setComposing] = useState<Review | null | undefined>(undefined)

  return (
    <Container size="md" py="md" data-testid="senior-reviews-screen">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('reviews:senior.title')}
          </Title>
          <Text c="dimmed">{t('reviews:senior.description')}</Text>
        </Stack>

        <Paper withBorder p="md">
          <CandidateSelector
            candidateId={candidateId}
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

            <ReviewTimeline
              reviews={timeline.data}
              isPending={timeline.isPending}
              isError={timeline.isError}
              error={timeline.error}
              onRetry={() => {
                void timeline.refetch()
              }}
              onNextPage={(next) => {
                const params = writeCandidateId(candidateId)
                params.set(TIMELINE_PARAM.afterSeq, String(next.afterSeq))
                setSearchParams(params)
              }}
              {...(cursor === null
                ? {}
                : { onFirstPage: () => setSearchParams(writeCandidateId(candidateId)) })}
              // AC4: the correction control opens the form pre-filled.
              onCorrect={(review) => setComposing(review)}
            />
          </>
        )}
      </Stack>
    </Container>
  )
}
