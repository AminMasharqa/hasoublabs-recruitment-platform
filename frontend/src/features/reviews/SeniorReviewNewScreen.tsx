/**
 * `/senior/reviews/new` — the review form on its own (Requirement 15 AC1–AC3).
 *
 * The same panel `/senior/reviews` opens inline, addressable directly so that a
 * Senior can reach the form from a link rather than only from the timeline — and so
 * that submitting a Review does not require loading a timeline first, which matters
 * for the very first Review of a Candidate.
 *
 * A correction is *not* reachable here: AC4 says the correction control sits on a
 * submitted Review and opens pre-filled with its values, so it belongs beside that
 * Review on the timeline. This address always opens a blank form.
 *
 * Requirements: 15.1, 15.2, 15.3, 19.2.
 */

import { Anchor, Container, Paper, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { ROUTE_PATHS } from '../../routing/paths'

import { CandidateSelector } from './CandidateSelector'
import { CANDIDATE_PARAM, readCandidateId, writeCandidateId } from './candidateSelection'
import { ReviewSubmissionPanel } from './ReviewSubmissionPanel'

/** Namespaces this screen resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['reviews', 'shell', 'errors'] as const

/** The standalone review submission screen (AC1, AC2). */
export function SeniorReviewNewScreen() {
  const { t } = useTranslation(NAMESPACES)
  const [searchParams, setSearchParams] = useSearchParams()
  const candidateId = readCandidateId(searchParams)

  const timelinePath =
    candidateId === ''
      ? ROUTE_PATHS.seniorReviews
      : `${ROUTE_PATHS.seniorReviews}?${CANDIDATE_PARAM}=${encodeURIComponent(candidateId)}`

  return (
    <Container size="md" py="md" data-testid="senior-review-new-screen">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('reviews:form.title')}
          </Title>
          <Text c="dimmed">{t('reviews:form.description')}</Text>
        </Stack>

        <Paper withBorder p="md">
          <CandidateSelector
            candidateId={candidateId}
            onSelect={(selected) => setSearchParams(writeCandidateId(selected))}
          />
        </Paper>

        {candidateId === '' ? (
          <Text c="dimmed" data-testid="review-no-candidate">
            {t('reviews:candidate.none')}
          </Text>
        ) : (
          <ReviewSubmissionPanel
            candidateId={candidateId}
            correcting={null}
            // Nothing to close on this address; a submitted Review is read on the
            // timeline, which the link below reaches.
            onClose={() => undefined}
          />
        )}

        <Anchor component={Link} to={timelinePath} data-testid="review-timeline-link">
          {t('reviews:senior.timelineLink')}
        </Anchor>
      </Stack>
    </Container>
  )
}
