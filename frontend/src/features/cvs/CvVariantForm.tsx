/**
 * The name-and-description form behind the create and edit controls
 * (Requirement 11 AC2, AC4).
 *
 * One component for both, because the two differ only in what they open with and
 * what their submit control says: the fields, the bounds, the violation placement
 * and the accessible wiring are identical, and a second copy would be the place
 * where they drift.
 *
 * ## What it does with a failed submission
 *
 * Client-side first: {@link validateVariantDraft} applies the 1–100 name and
 * ≤300 description bounds of AC2 — mirrored from the Pydantic schemas by
 * `forms/validators.ts`, not restated here — and a failing draft never reaches
 * the network. The Backend_Api remains the authority, so a 422 it reports is
 * placed the same way: both sources are partitioned against the *rendered* inputs
 * by `forms/violations.ts`, so every reported violation is rendered
 * simultaneously, one that addresses no rendered input lands in the form-level
 * region rather than vanishing, and the entered values are untouched
 * (Req 22 AC9–AC11). Focus moves to the first affected input (Req 20 AC6).
 *
 * A failure that carries no Field_Violation at all — `cv_limit_exceeded` when the
 * limit was reached between render and submit, for instance — is not a field
 * problem, so it renders through the Error_Presenter instead of being forced onto
 * an input.
 *
 * ## Why the messages go through Mantine's `error` and `description` slots
 *
 * `describeField` decides the element ids, and they are handed to Mantine as
 * `errorProps.id` / `descriptionProps.id`. Mantine's `Input.Wrapper` builds the
 * input's `aria-describedby` from exactly those ids and spreads it onto the input
 * *after* any caller-supplied attribute, so passing `aria-describedby` directly
 * would be silently discarded. Naming the ids instead keeps the association of
 * Req 20 AC6 — and keeps it in one place — while letting the component library
 * own the wiring it insists on owning.
 *
 * ## Why the draft is local state
 *
 * The form owns the draft and hands the parent only a validated one. The parent
 * therefore cannot re-render the values out from under the user mid-typing, and
 * "the entered values are retained after a failed submission" (Req 22 AC11) is
 * structural: nothing in the failure path writes to the draft. The parent resets
 * the form by unmounting it — which is what closing the dialog does.
 *
 * Requirements: 11.2, 11.4, 19.2, 20.6, 22.9, 22.10, 22.11.
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
  partitionViolations,
  useViolationFocus,
  violationsForPath,
  type PlaceableIssue,
  type RenderedInput,
  type ViolationPartition,
} from '../../forms/violations'
import { textForSubmission } from '../../i18n/formatting'

import { issueMessages } from './variantMessages'
import {
  draftFromVariant,
  validateVariantDraft,
  VARIANT_DESCRIPTION_BOUNDS,
  VARIANT_NAME_BOUNDS,
  type CvVariant,
  type VariantDraft,
} from './variantRules'

/** Namespaces the form resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['cvs', 'shell', 'errors', 'validation'] as const

/** The `path` members the two inputs are addressed by, in rendering order. */
const NAME_PATH = 'name'
const DESCRIPTION_PATH = 'description'

/** A partition of issues from either source over this form's inputs. */
type FormPartition = ViolationPartition<PlaceableIssue, RenderedInput>

export interface CvVariantFormProps {
  /**
   * Distinguishes this form's element ids and test ids from another form's on the
   * same screen — the create panel and an edit dialog can be open at once.
   */
  readonly idPrefix: string
  /** The variant being edited (AC4), or `null`/absent to create one (AC2). */
  readonly variant?: CvVariant | null
  /** Localized label of the submit control. */
  readonly submitLabel: string
  /** Whether the submission is in flight. */
  readonly pending: boolean
  /** The most recent submission failure, if any. */
  readonly error?: unknown
  /** Receives a draft that already satisfies every client-side bound. */
  readonly onSubmit: (draft: VariantDraft) => void
  /** Renders a cancel control when supplied. */
  readonly onCancel?: () => void
}

/** The localized messages both partitions placed on one input, in report order. */
function messagesFor(
  instance: I18nextInstance,
  partitions: readonly FormPartition[],
  path: string,
): readonly string[] {
  return partitions.flatMap((partition) =>
    issueMessages(instance, violationsForPath(partition, path)),
  )
}

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

/**
 * The create/edit form for a CV_Variant.
 *
 * Submits only a draft that passed every client-side bound; the parent owns the
 * request and passes its failure back in through `error`.
 */
export function CvVariantForm({
  idPrefix,
  variant,
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel,
}: CvVariantFormProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const scope = useId()
  const [draft, setDraft] = useState<VariantDraft>(() => draftFromVariant(variant))
  const [issues, setIssues] = useState<readonly ValidationIssue[]>([])

  const nameInput = useMemo<RenderedInput>(
    () => ({ path: NAME_PATH, id: `${idPrefix}${scope}name` }),
    [idPrefix, scope],
  )
  const descriptionInput = useMemo<RenderedInput>(
    () => ({ path: DESCRIPTION_PATH, id: `${idPrefix}${scope}description` }),
    [idPrefix, scope],
  )
  const inputs = useMemo(() => [nameInput, descriptionInput], [nameInput, descriptionInput])

  // Memoized because `useViolationFocus` treats a new partition as a new failed
  // submission: rebuilding one on every render would keep pulling focus back to
  // the first affected input while the user is fixing a later one.
  const clientPartition = useMemo<FormPartition>(
    () => partitionViolations<PlaceableIssue, RenderedInput>(issues, inputs),
    [issues, inputs],
  )
  const serverPartition = useMemo<FormPartition>(
    () =>
      partitionViolations<PlaceableIssue, RenderedInput>(
        isApiFailure(error) ? error.fieldViolations : null,
        inputs,
      ),
    [error, inputs],
  )
  const partitions = useMemo(
    () => [clientPartition, serverPartition],
    [clientPartition, serverPartition],
  )

  // Req 20 AC6. The server's report wins when it placed anything: it is the more
  // recent verdict on the same draft.
  useViolationFocus(serverPartition.fields.length > 0 ? serverPartition : clientPartition)

  const nameMessages = messagesFor(i18n, partitions, NAME_PATH)
  const descriptionMessages = messagesFor(i18n, partitions, DESCRIPTION_PATH)
  const formLevelMessages = issueMessages(i18n, [
    ...clientPartition.formLevel,
    ...serverPartition.formLevel,
  ])

  /**
   * A failure that named no field: `cv_limit_exceeded`, a timeout, a denial. It
   * belongs to the Error_Presenter, which also retains its Support_Reference.
   */
  const presentableError =
    error == null || (isApiFailure(error) && error.fieldViolations.length > 0) ? null : error

  const nameDescribed = describeField(nameInput)
  const descriptionDescribed = describeField(descriptionInput)
  const nameHintId = `${nameDescribed.inputId}-hint`
  const descriptionHintId = `${descriptionDescribed.inputId}-hint`

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const found = validateVariantDraft(draft)
    setIssues(found)
    if (found.length > 0) {
      return
    }
    onSubmit(draft)
  }

  return (
    <form onSubmit={submit} noValidate data-testid={`${idPrefix}-form`}>
      <Stack gap="sm">
        {presentableError === null ? null : <ErrorPresenter error={presentableError} />}

        {formLevelMessages.length === 0 ? null : (
          <Stack
            gap={2}
            id={`${nameDescribed.inputId}-${FORM_LEVEL_REGION_ID}`}
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

        <TextInput
          id={nameDescribed.inputId}
          label={t('cvs:field.name')}
          description={t('cvs:field.nameHint', {
            min: VARIANT_NAME_BOUNDS.minLength,
            max: VARIANT_NAME_BOUNDS.maxLength,
          })}
          descriptionProps={{ id: nameHintId }}
          error={errorContent(nameMessages)}
          errorProps={{ id: nameDescribed.messageId }}
          value={draft.name}
          onChange={(event) => {
            setDraft({ ...draft, name: textForSubmission(event.currentTarget.value) })
          }}
          withAsterisk
          disabled={pending}
          data-testid={`${idPrefix}-name`}
        />

        <Textarea
          id={descriptionDescribed.inputId}
          label={t('cvs:field.description')}
          description={t('cvs:field.descriptionHint', {
            max: VARIANT_DESCRIPTION_BOUNDS.maxLength,
          })}
          descriptionProps={{ id: descriptionHintId }}
          error={errorContent(descriptionMessages)}
          errorProps={{ id: descriptionDescribed.messageId }}
          value={draft.description}
          onChange={(event) => {
            setDraft({ ...draft, description: textForSubmission(event.currentTarget.value) })
          }}
          autosize
          minRows={2}
          maxRows={6}
          disabled={pending}
          data-testid={`${idPrefix}-description`}
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
