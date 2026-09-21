/**
 * The submission panel both timeline screens mount: the review form, the request
 * it issues and the outcome it announces (Requirement 15 AC1–AC4).
 *
 * The screen owns *whether* the panel is open and *which* Review is being
 * corrected, because both are decided by controls the screen renders — the "add a
 * review" control and the per-Review correction control. This component owns the
 * request: it builds the body from the draft the form validated, posts it and, on
 * success, closes the panel and announces the outcome without moving focus
 * (Req 20 AC7).
 *
 * The form is keyed on the Review being corrected, so opening a correction for a
 * different Review remounts it and it opens pre-filled with *that* Review's values
 * (AC4). Remounting is also how the draft is reset after a successful submission —
 * nothing writes to the draft, which is what keeps a failed submission's entered
 * values intact (AC3).
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 19.2, 20.7.
 */

import { Divider, Paper, Stack, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { LiveAnnouncement } from '../../errors/ErrorPresenter'

import { useSubmitReview } from './reviewQueries'
import { ReviewForm } from './ReviewForm'
import { submitReviewBody, type Review } from './reviewRules'

/** Namespaces the panel resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['reviews', 'shell', 'errors'] as const

export interface ReviewSubmissionPanelProps {
  /** The reviewed Candidate's account identifier — the `candidate_id` path member. */
  readonly candidateId: string
  /** The Review being corrected (AC4), or `null` for a first Review. */
  readonly correcting: Review | null
  /** Closes the panel; called on a successful submission and on cancel. */
  readonly onClose: () => void
}

/** The review form together with the request it issues (AC1–AC4). */
export function ReviewSubmissionPanel({
  candidateId,
  correcting,
  onClose,
}: ReviewSubmissionPanelProps) {
  const { t } = useTranslation(NAMESPACES)
  const submit = useSubmitReview()

  return (
    <Paper withBorder p="md" data-testid="review-submission-panel">
      <Stack gap="sm">
        <Title order={2} size="h5">
          {correcting === null ? t('reviews:form.title') : t('reviews:correction.title')}
        </Title>
        <Divider />

        <ReviewForm
          // Remounted per correction target, so the pre-fill of AC4 is seeded from
          // the Review the control names rather than from whatever was open before.
          key={correcting === null ? 'new' : correcting.id}
          idPrefix={correcting === null ? 'review-new' : 'review-correction'}
          corrects={correcting}
          submitLabel={
            correcting === null ? t('reviews:form.submit') : t('reviews:correction.submit')
          }
          pending={submit.isPending}
          error={submit.error}
          onCancel={() => {
            submit.reset()
            onClose()
          }}
          onSubmit={({ draft, correctsReviewId }) => {
            submit.mutate(
              { candidateId, body: submitReviewBody(draft, correctsReviewId) },
              { onSuccess: onClose },
            )
          }}
        />

        {/* Req 20 AC7: announced in a live region, focus left where the user put it. */}
        <LiveAnnouncement message={submit.isSuccess ? t('reviews:announce.submitted') : null} />
      </Stack>
    </Paper>
  )
}
