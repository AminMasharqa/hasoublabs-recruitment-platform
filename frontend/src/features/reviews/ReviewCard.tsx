/**
 * One Review in a Review_Timeline (Requirement 15 AC4, AC5, AC6).
 *
 * Renders every member of the contract's `ReviewDTO` — the four ratings, the
 * assessment, the reviewer, the linked Job_Description, the sequence number and
 * the creation timestamp — plus exactly two controls' worth of behaviour:
 *
 * - **AC4** a correction control, when the viewer may submit one. It does not edit
 *   this Review; it opens the form pre-filled with these values and submits a new
 *   Review carrying this one's identifier in `corrects_review_id`. The label says
 *   "correct", not "edit", because that is what the Backend_Api does.
 * - **AC5** no edit control and no delete control. Not disabled ones — none at
 *   all. A Review is append-only, and there is no request in `reviewsApi.ts` that
 *   could update or remove one, so there is nothing for such a control to call.
 * - **AC6** a correction indicator on a Review carrying `corrects_review_id`,
 *   linking it to the Review it corrects, and the reverse indicator on the
 *   corrected Review. The link is an in-page anchor to the corrected Review's
 *   element when that Review is on the page, and the sequence number alone when it
 *   is not — an earlier page or an excluded filter must not make the indicator
 *   disappear.
 *
 * Timestamps are rendered in the active Locale with UTC authoritative
 * (Req 19 AC12), and the assessment is rendered byte-identically to the stored
 * value (Req 19 AC10).
 *
 * Requirements: 15.4, 15.5, 15.6, 19.2, 19.10, 19.12.
 */

import { Anchor, Badge, Button, Card, Group, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { formatDateTime, formatNumber, textForDisplay } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'

import {
  REVIEW_RATING_PATHS,
  reviewElementId,
  type CorrectionLink,
  type Review,
} from './reviewRules'

/** Namespaces this component resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['reviews', 'shell'] as const

export interface ReviewCardProps {
  readonly review: Review
  /** How this Review relates to the correction chain around it (AC6). */
  readonly correction: CorrectionLink
  /** Opens the pre-filled correction form (AC4). Omitted where corrections are not offered. */
  readonly onCorrect?: (review: Review) => void
}

/** One Review, with its correction indicator and correction control. */
export function ReviewCard({ review, correction, onCorrect }: ReviewCardProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)

  const correctedOnPage = correction.corrects
  const correctsId = correction.correctsId

  return (
    <Card
      component="li"
      withBorder
      padding="md"
      id={reviewElementId(review.id)}
      data-testid={`review-card-${review.id}`}
    >
      <Stack gap="xs">
        <Group gap="xs" justify="space-between" align="flex-start">
          <Stack gap={0}>
            <Text size="sm" c="dimmed">
              {t('reviews:card.sequence', { value: formatNumber(review.seq, locale) })}
            </Text>
            <Text size="sm" data-testid={`review-created-${review.id}`}>
              {formatDateTime(review.created_at, locale)}
            </Text>
          </Stack>
          <Stack gap={4} align="flex-end">
            {/* AC6: this Review corrects an earlier one. */}
            {correctsId === null ? null : (
              <Badge
                variant="light"
                color="orange"
                data-testid={`review-correction-badge-${review.id}`}
              >
                {t('reviews:correction.indicator')}
              </Badge>
            )}
            {/* AC6: this Review has been corrected by a later one. */}
            {correction.correctedBy.length === 0 ? null : (
              <Badge
                variant="light"
                color="gray"
                data-testid={`review-corrected-badge-${review.id}`}
              >
                {t('reviews:correction.corrected')}
              </Badge>
            )}
          </Stack>
        </Group>

        {/* AC6: the link between the correcting Review and the corrected one. */}
        {correctsId === null ? null : (
          <Text size="sm" data-testid={`review-corrects-link-${review.id}`}>
            {correctedOnPage === null ? (
              t('reviews:correction.correctsOffPage', { id: correctsId })
            ) : (
              <Anchor href={`#${reviewElementId(correctedOnPage.id)}`}>
                {t('reviews:correction.correctsSeq', {
                  value: formatNumber(correctedOnPage.seq, locale),
                })}
              </Anchor>
            )}
          </Text>
        )}
        {correction.correctedBy.length === 0 ? null : (
          <Text size="sm" data-testid={`review-corrected-link-${review.id}`}>
            {correction.correctedBy.map((later, index) => (
              <span key={later.id}>
                {index === 0 ? '' : ', '}
                <Anchor href={`#${reviewElementId(later.id)}`}>
                  {t('reviews:correction.correctedBySeq', {
                    value: formatNumber(later.seq, locale),
                  })}
                </Anchor>
              </span>
            ))}
          </Text>
        )}

        <Group gap="md" data-testid={`review-ratings-${review.id}`}>
          {REVIEW_RATING_PATHS.map((path) => (
            <Stack key={path} gap={0}>
              <Text size="xs" c="dimmed">
                {t(`reviews:rating.${path}`)}
              </Text>
              <Text fw={600} data-testid={`review-${path}-${review.id}`}>
                {formatNumber(review[path], locale)}
              </Text>
            </Stack>
          ))}
        </Group>

        {/*
          Rendered verbatim — no trimming, no reordering, no transliteration — so
          Arabic and Hebrew content is the bytes the Backend_Api returned
          (Req 19 AC10).
        */}
        <Text data-testid={`review-assessment-${review.id}`} style={{ whiteSpace: 'pre-wrap' }}>
          {textForDisplay(review.assessment)}
        </Text>

        <Stack gap={0}>
          <Text size="xs" c="dimmed">
            {t('reviews:card.reviewer')}
          </Text>
          <Text size="sm" data-testid={`review-reviewer-${review.id}`}>
            {review.reviewer_account_id}
          </Text>
        </Stack>

        <Stack gap={0}>
          <Text size="xs" c="dimmed">
            {t('reviews:card.jd')}
          </Text>
          <Text size="sm" c={review.jd_id === null ? 'dimmed' : undefined} data-testid={`review-jd-${review.id}`}>
            {review.jd_id === null ? t('reviews:card.jdNone') : review.jd_id}
          </Text>
        </Stack>

        {/*
          AC4. AC5 is the absence beside it: no edit control, no delete control,
          not even disabled ones.
        */}
        {onCorrect === undefined ? null : (
          <Group gap="sm">
            <Button
              type="button"
              variant="default"
              size="xs"
              onClick={() => onCorrect(review)}
              data-testid={`review-correct-${review.id}`}
            >
              {t('reviews:correction.open')}
            </Button>
          </Group>
        )}
      </Stack>
    </Card>
  )
}
