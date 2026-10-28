/**
 * The review form: four 1–5 ratings, a 1–2000 character assessment and an optional
 * Job_Description association (Requirement 15 AC1–AC4).
 *
 * One component for both the first Review and a correction, because the two differ
 * only in what the form opens with and what the submit control says. A correction
 * opens pre-filled from the prior Review ({@link draftFromReview}) and carries its
 * identifier in `corrects_review_id` (AC4); everything else — the fields, the
 * bounds, the violation placement, the accessible wiring — is identical, and a
 * second copy would be where the two drifted.
 *
 * ## What a failed submission does, and does not do
 *
 * Client-side first: {@link validateReviewDraft} applies `SCHEMAS.review`, which
 * mirrors `SubmitReviewRequest` — four integer 1–5 ratings and a 1–2000 character
 * assessment — so the numbers live in `forms/validators.ts` and are not restated
 * here, and a failing draft never reaches the network. The Backend_Api remains the
 * authority, so a 422 it reports is placed the same way: both sources are
 * partitioned against the *rendered* inputs by `forms/violations.ts`, so every
 * reported violation is rendered simultaneously, one addressing no rendered input
 * lands in the form-level region rather than vanishing, and focus moves to the
 * first affected input (AC3, Req 22 AC9, AC10, Req 20 AC6).
 *
 * The entered values are untouched (AC3): the draft is this component's own state
 * and no code path in the failure branch writes to it. The parent resets the form
 * by unmounting it, which is what closing the correction panel does.
 *
 * A failure that carries no Field_Violation at all — a denial, a timeout, a
 * `conflicting_state` — is not a field problem, so it renders through the
 * Error_Presenter instead of being forced onto an input.
 *
 * ## Why the messages go through Mantine's `error` slot
 *
 * `describeField` decides the element ids and they are handed to Mantine as
 * `errorProps.id`. Mantine's `Input.Wrapper` builds the input's `aria-describedby`
 * from exactly those ids and spreads it onto the input *after* any caller-supplied
 * attribute, so passing `aria-describedby` directly would be silently discarded.
 * Naming the ids instead keeps the association of Req 20 AC6 in one place while
 * letting the component library own the wiring it insists on owning.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 19.2, 20.6, 22.9, 22.10, 22.11.
 */

import { Button, Group, Stack, Text, TextInput, Textarea } from '@mantine/core'
import type { i18n as I18nextInstance } from 'i18next'
import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { isApiFailure } from '../../api/client'
import { ErrorPresenter } from '../../errors/ErrorPresenter'
import type { ValidationIssue } from '../../forms/validators'
import {
  describeField,
  FORM_LEVEL_REGION_ID,
  useViolationFocus,
  type RenderedInput,
} from '../../forms/violations'
import { textForSubmission } from '../../i18n/formatting'

import {
  localizeReviewIssues,
  messagesForPath,
  partitionReviewIssues,
  type ReviewIssuePartition,
} from './reviewMessages'
import {
  ASSESSMENT_BOUNDS,
  ASSESSMENT_PATH,
  draftFromReview,
  JD_PATH,
  RATING_BOUNDS,
  REVIEW_RATING_PATHS,
  validateReviewDraft,
  type Review,
  type ReviewDraft,
  type ReviewRatingPath,
} from './reviewRules'

/** Namespaces this form resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['reviews', 'shell', 'errors', 'validation'] as const

/**
 * The inputs the form renders, in rendering order: the four ratings, the
 * assessment, then the optional Job_Description association.
 *
 * Order is load-bearing — `forms/violations.ts` reports the first affected input in
 * registration order and that is where focus lands (Req 20 AC6).
 */
const INPUT_PATHS: readonly string[] = Object.freeze([
  ...REVIEW_RATING_PATHS,
  ASSESSMENT_PATH,
  JD_PATH,
])

/**
 * The `error` slot content for a set of messages, or `undefined` when there are
 * none.
 *
 * Every message is rendered, not just the first (Req 22 AC9); `span` elements
 * because Mantine renders the slot inside a paragraph.
 */
function errorContent(messages: readonly string[]): ReactNode | undefined {
  if (messages.length === 0) {
    return undefined
  }
  return messages.map((message) => (
    <span key={message} style={{ display: 'block' }}>
      {message}
    </span>
  ))
}

export interface ReviewFormProps {
  /**
   * Distinguishes this form's element ids and test ids from another form's on the
   * same screen — the submission panel and a correction panel can be open at once.
   */
  readonly idPrefix: string
  /**
   * The Review being corrected (AC4), or `null`/absent for a first Review.
   *
   * Supplying it pre-fills every collected value from the prior Review; the parent
   * is responsible for passing its identifier as `corrects_review_id` when it
   * builds the request, which {@link ReviewFormSubmission} carries for it.
   */
  readonly corrects?: Review | null
  /** Localized label of the submit control. */
  readonly submitLabel: string
  /** Whether the submission is in flight. */
  readonly pending: boolean
  /** The most recent submission failure, if any. */
  readonly error?: unknown
  /** Receives a draft that already satisfies every client-side bound. */
  readonly onSubmit: (submission: ReviewFormSubmission) => void
  /** Renders a cancel control when supplied. */
  readonly onCancel?: () => void
}

/** What the form hands its parent: the draft and the Review it corrects, if any. */
export interface ReviewFormSubmission {
  readonly draft: ReviewDraft
  /** The prior Review's identifier for a correction (AC4), else `null`. */
  readonly correctsReviewId: string | null
}

/** The localized label of one rating field. */
function ratingLabel(t: (key: string) => string, path: ReviewRatingPath): string {
  return t(`reviews:rating.${path}`)
}

/**
 * The review form.
 *
 * Submits only a draft that passed every client-side bound; the parent owns the
 * request and passes its failure back in through `error`.
 */
export function ReviewForm({
  idPrefix,
  corrects,
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel,
}: ReviewFormProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const scope = useId()
  // Initialized once: a correction opens pre-filled with the prior values (AC4)
  // and is never re-seeded, so a re-render cannot pull the user's edits back.
  const [draft, setDraft] = useState<ReviewDraft>(() => draftFromReview(corrects))
  const [issues, setIssues] = useState<readonly ValidationIssue[]>([])

  const inputs = useMemo<readonly RenderedInput[]>(
    () => INPUT_PATHS.map((path) => ({ path, id: `${idPrefix}${scope}${path}` })),
    [idPrefix, scope],
  )
  const inputByPath = useMemo(() => {
    const index = new Map<string, RenderedInput>()
    for (const input of inputs) {
      index.set(input.path, input)
    }
    return index
  }, [inputs])

  // Memoized because `useViolationFocus` treats a new partition as a new failed
  // submission: rebuilding one every render would keep pulling focus back to the
  // first affected input while the user is fixing a later one.
  const clientPartition = useMemo<ReviewIssuePartition>(
    () => partitionReviewIssues(issues, inputs),
    [issues, inputs],
  )
  const serverPartition = useMemo<ReviewIssuePartition>(
    () => partitionReviewIssues(isApiFailure(error) ? error.fieldViolations : null, inputs),
    [error, inputs],
  )
  const partitions = useMemo(
    () => [clientPartition, serverPartition],
    [clientPartition, serverPartition],
  )

  // Req 20 AC6. The server's report wins when it placed anything: it is the more
  // recent verdict on the same draft.
  useViolationFocus(serverPartition.fields.length > 0 ? serverPartition : clientPartition)

  const formLevelMessages = localizeReviewIssues(i18n, [
    ...clientPartition.formLevel,
    ...serverPartition.formLevel,
  ])

  /**
   * A failure that named no field: a denial, a timeout, a `conflicting_state`. It
   * belongs to the Error_Presenter, which also retains its Support_Reference.
   */
  const presentableError =
    error == null || (isApiFailure(error) && error.fieldViolations.length > 0) ? null : error

  /** The identity and message wiring of one input. */
  const fieldProps = (path: string, instance: I18nextInstance) => {
    const input = inputByPath.get(path) as RenderedInput
    const described = describeField(input)
    const messages = messagesForPath(instance, partitions, path)
    if (messages.length === 0) {
      return { id: described.inputId }
    }
    return {
      id: described.inputId,
      error: errorContent(messages),
      errorProps: { id: described.messageId },
    }
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const found = validateReviewDraft(draft)
    setIssues(found)
    if (found.length > 0) {
      return
    }
    onSubmit({
      draft,
      correctsReviewId: corrects == null ? null : corrects.id,
    })
  }

  return (
    <form onSubmit={submit} noValidate data-testid={`${idPrefix}-form`}>
      <Stack gap="sm">
        {presentableError === null ? null : <ErrorPresenter error={presentableError} />}

        {/* AC4: the correction states which Review it replaces. */}
        {corrects == null ? null : (
          <Text size="sm" c="dimmed" data-testid={`${idPrefix}-corrects`}>
            {t('reviews:correction.correcting', { seq: corrects.seq })}
          </Text>
        )}

        {/* Req 22 AC10: violations addressing no rendered input are shown, not dropped. */}
        {formLevelMessages.length === 0 ? null : (
          <Stack
            gap={2}
            id={`${idPrefix}${scope}${FORM_LEVEL_REGION_ID}`}
            role="alert"
            data-testid={`${idPrefix}-form-violations`}
          >
            {formLevelMessages.map((message) => (
              <Text key={message} size="sm" c="red">
                {message}
              </Text>
            ))}
          </Stack>
        )}

        {/* AC1: four integer ratings between 1 and 5. */}
        {REVIEW_RATING_PATHS.map((path) => (
          <TextInput
            key={path}
            {...fieldProps(path, i18n)}
            type="number"
            inputMode="numeric"
            min={RATING_BOUNDS.min}
            max={RATING_BOUNDS.max}
            step={1}
            label={ratingLabel(t, path)}
            description={t('reviews:rating.hint', {
              min: RATING_BOUNDS.min,
              max: RATING_BOUNDS.max,
            })}
            value={draft[path]}
            onChange={(event) => {
              setDraft({ ...draft, [path]: textForSubmission(event.currentTarget.value) })
            }}
            withAsterisk
            disabled={pending}
            data-testid={`${idPrefix}-${path}`}
          />
        ))}

        {/* AC1: a free-text assessment of 1 to 2000 characters. */}
        <Textarea
          {...fieldProps(ASSESSMENT_PATH, i18n)}
          label={t('reviews:field.assessment')}
          description={t('reviews:field.assessmentHint', {
            min: ASSESSMENT_BOUNDS.minLength,
            max: ASSESSMENT_BOUNDS.maxLength,
          })}
          value={draft.assessment}
          onChange={(event) => {
            // Byte-identical passthrough: Arabic and Hebrew text is submitted as
            // entered (Req 19 AC11).
            setDraft({ ...draft, assessment: textForSubmission(event.currentTarget.value) })
          }}
          maxLength={ASSESSMENT_BOUNDS.maxLength}
          autosize
          minRows={4}
          maxRows={12}
          withAsterisk
          disabled={pending}
          data-testid={`${idPrefix}-assessment`}
        />

        {/* AC1: an optional Job_Description association. */}
        <TextInput
          {...fieldProps(JD_PATH, i18n)}
          label={t('reviews:field.jd')}
          description={t('reviews:field.jdHint')}
          value={draft.jd_id}
          onChange={(event) => {
            setDraft({ ...draft, jd_id: textForSubmission(event.currentTarget.value) })
          }}
          disabled={pending}
          data-testid={`${idPrefix}-jd`}
        />

        <Group gap="sm">
          <Button type="submit" loading={pending} data-testid={`${idPrefix}-submit`}>
            {submitLabel}
          </Button>
          {onCancel === undefined ? null : (
            <Button
              type="button"
              variant="default"
              onClick={onCancel}
              disabled={pending}
              data-testid={`${idPrefix}-cancel`}
            >
              {t('shell:action.cancel')}
            </Button>
          )}
        </Group>
      </Stack>
    </form>
  )
}
