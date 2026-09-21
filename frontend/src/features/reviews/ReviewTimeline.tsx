/**
 * The rendered Review_Timeline: ascending order, correction indicators and the
 * keyset next-page control (Requirement 15 AC6, AC7, AC11).
 *
 * Shared by both timeline screens on purpose. The Admin full timeline and the
 * Senior own-only timeline read different endpoints — which is how the scoping of
 * AC7 and AC9 is enforced — but they render the same `ReviewDTO` list the same
 * way, and two copies of "ascending order, correction indicator, 20 rows, next
 * page by last `seq`" would be two places for those four rules to drift.
 *
 * The loading, empty and error surfaces are the Error_Presenter primitives, so
 * both screens inherit the localized message, the Support_Reference and the retry
 * control of Requirement 21 AC6–AC8 rather than inventing their own.
 *
 * Requirements: 15.6, 15.7, 15.9, 15.11, 20.7, 21.6, 21.7, 21.8.
 */

import { Box, Button, Group, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { EmptyState, ErrorState, LiveAnnouncement, LoadingState } from '../../errors/ErrorPresenter'
import { formatNumber } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'

import { ReviewCard } from './ReviewCard'
import {
  correctionLinks,
  lastReviewId,
  nextReviewPage,
  orderTimelineAscending,
  REVIEW_PAGE_SIZE,
  type Review,
} from './reviewRules'
import type { TimelineCursor } from './timelineFilters'

/** Namespaces this component resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['reviews', 'shell', 'errors'] as const

export interface ReviewTimelineProps {
  /** The page as it arrived, in whatever order; rendered ascending (AC7). */
  readonly reviews: readonly Review[] | undefined
  readonly isPending: boolean
  readonly isError: boolean
  readonly error?: unknown
  readonly onRetry: () => void
  /** Whether any filter is applied, so the empty state can offer to clear it. */
  readonly filtered?: boolean
  readonly onClearFilters?: () => void
  /** Walks to the page the last returned `seq` addresses (AC11). */
  readonly onNextPage?: (cursor: TimelineCursor) => void
  /** Returns to the first page; omitted while already on it. */
  readonly onFirstPage?: () => void
  /** Opens the pre-filled correction form (AC4). Omitted where not offered. */
  readonly onCorrect?: (review: Review) => void
}

/** A Candidate's Reviews, in ascending creation order, at most 20 per page. */
export function ReviewTimeline({
  reviews,
  isPending,
  isError,
  error,
  onRetry,
  filtered = false,
  onClearFilters,
  onNextPage,
  onFirstPage,
  onCorrect,
}: ReviewTimelineProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)

  if (isPending) {
    return <LoadingState label={t('reviews:timeline.loading')} />
  }

  if (isError) {
    return (
      <>
        <ErrorState error={error} onRetry={onRetry} />
        <LiveAnnouncement message={t('reviews:announce.failed')} assertive />
      </>
    )
  }

  // AC7: ascending creation order, re-applied rather than trusted.
  const ordered = orderTimelineAscending(reviews)

  if (ordered.length === 0) {
    return (
      <>
        {filtered && onClearFilters !== undefined ? (
          <EmptyState destination={t('shell:nav.reviews')} filtered onClearFilters={onClearFilters} />
        ) : (
          <EmptyState destination={t('shell:nav.reviews')} />
        )}
        <LiveAnnouncement message={t('reviews:announce.empty')} />
      </>
    )
  }

  // AC6: who corrects whom, computed over the page actually rendered.
  const corrections = correctionLinks(ordered)
  // AC11: the next page carries the last returned `seq`.
  const next = nextReviewPage(ordered)
  const afterId = lastReviewId(ordered)

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed" data-testid="review-page-size">
        {t('reviews:timeline.pageSize', { size: formatNumber(REVIEW_PAGE_SIZE, locale) })}
      </Text>

      <Box
        component="ul"
        aria-label={t('reviews:timeline.listLabel')}
        data-testid="review-timeline"
        style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--mantine-spacing-md)' }}
      >
        {ordered.map((review) => (
          <ReviewCard
            key={review.id}
            review={review}
            correction={corrections.linkFor(review.id)}
            {...(onCorrect === undefined ? {} : { onCorrect })}
          />
        ))}
      </Box>

      <Group gap="sm">
        {/* AC11: enabled only while a further page is reported. */}
        {next.hasNextPage && onNextPage !== undefined ? (
          <Button
            type="button"
            onClick={() => onNextPage({ afterSeq: next.nextCursor, afterId })}
            data-testid="review-next-page"
          >
            {t('reviews:timeline.next')}
          </Button>
        ) : null}
        {onFirstPage === undefined ? null : (
          <Button
            type="button"
            variant="default"
            onClick={onFirstPage}
            data-testid="review-first-page"
          >
            {t('reviews:timeline.first')}
          </Button>
        )}
      </Group>

      <LiveAnnouncement message={t('reviews:announce.loaded')} />
    </Stack>
  )
}
