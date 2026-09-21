/**
 * The Job_Description authoring form — creation and edit, one component
 * (Requirement 13 AC1, AC6, AC8, AC11).
 *
 * AC1 fixes the field set: role title, company, location, work model, employment
 * type, experience level, description, required skill terms, Application_Channel and
 * external URL. The same inputs serve the edit control of AC11, because "edit" and
 * "create" differ only in which request the submission produces — which is the
 * caller's decision, not this form's.
 *
 * ## Pre-population is state, not a mode (AC6)
 *
 * The form edits a {@link JobDraft} held in its own state and seeded from `initial`.
 * A ready extraction therefore pre-populates it by *being* the initial draft, and
 * every pre-populated input is editable for the same reason every other input is:
 * it is the form's own value. The caller remounts the form with a new `key` when the
 * seed changes — the mechanism `JobFilters` already uses — so there is no effect
 * synchronizing two sources of truth and no chance of a stale draft surviving a new
 * extraction.
 *
 * ## Warnings against unfilled inputs (AC8)
 *
 * `missingExtracted` names the inputs an extraction left empty, and each renders a
 * localized warning as its accessible description — so the prompt to enter the value
 * manually is announced with the input rather than floating beside it (Req 20 AC5).
 * Outside an extraction the list is empty and no warning appears: an empty field the
 * user simply has not reached yet is not a problem to report.
 *
 * ## Violations (Req 22 AC9–AC11, Req 20 AC6)
 *
 * Two sources, one placement. The client-side pass runs the Form_Validator's `POST
 * /jobs` schema on submit; a 422 contributes its Field_Violations. Both are
 * partitioned against the same rendered-input registry by `forms/violations.ts`, so
 * every reported violation is rendered — on its input where one matches, in the
 * form-level region where none does — nothing is dropped, and no entered value is
 * touched. Focus moves to the first affected input.
 *
 * A failure that named no field — a denial, a timeout, an `illegal_transition` —
 * belongs to the Error_Presenter rather than being forced onto an input, and the
 * presenter renders its Support_Reference.
 *
 * Requirements: 13.1, 13.6, 13.8, 13.11, 13.13, 19.2, 20.5, 20.6, 20.7, 22.9, 22.10, 22.11, 22.12.
 */

import { Button, Group, Select, Stack, Text, Textarea, TextInput } from '@mantine/core'
import { useId, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { isApiFailure } from '../../api/client'
import type { ApplicationChannel, EmploymentType, ExperienceLevel, WorkModel } from '../../api/enums'
import { ErrorPresenter, LiveAnnouncement } from '../../errors/ErrorPresenter'
import {
  BOUNDS,
  EMPLOYMENT_TYPE_VALUES,
  EXPERIENCE_LEVEL_VALUES,
  WORK_MODEL_VALUES,
  type EnumValues,
  type ValidationIssue,
} from '../../forms/validators'
import {
  inputElementId,
  partitionViolations,
  useViolationFocus,
  violationMessageId,
  violationsForPath,
  type PlaceableIssue,
  type RenderedInput,
  type ViolationPartition,
} from '../../forms/violations'
import { textForSubmission } from '../../i18n/formatting'
// The localization of a client issue and of a Field_Violation is one mapping, and it
// is already published by the Admin slice. Importing it keeps one implementation
// rather than a third copy that could disagree about a violation code.
import { issueTexts } from '../admin-accounts'

import {
  APPLICATION_CHANNELS,
  EXTERNAL_URL_MAX_LENGTH,
  JOB_FIELD,
  requiresExternalUrl,
  SKILL_TERMS_PATH,
  skillTermPath,
  validateJobDraft,
  type JobDraft,
} from './authoringRules'
import type { ExtractableField } from './extraction'
import { JobSkillTermsField } from './JobSkillTermsField'

/** Namespaces this form resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['jobs', 'shell', 'errors', 'validation'] as const

/** A partition of issues from either source over this form's inputs. */
type JobPartition = ViolationPartition<PlaceableIssue, RenderedInput>

/** The draft field each warnable input belongs to (AC8). */
const WARNING_FIELD_PATHS: Readonly<Record<ExtractableField, string>> = Object.freeze({
  title: JOB_FIELD.title,
  company: JOB_FIELD.company,
  location: JOB_FIELD.location,
  workModel: JOB_FIELD.workModel,
  employmentType: JOB_FIELD.employmentType,
  experienceLevel: JOB_FIELD.experienceLevel,
  description: JOB_FIELD.description,
})

/** Options of one enumerated field, labelled from the `jobs` catalogue. */
function enumOptions<T extends string>(
  members: EnumValues<T>,
  label: (value: T) => string,
): { readonly value: T; readonly label: string }[] {
  return members.values.map((value) => ({ value, label: label(value) }))
}

/** Renders every message of a set, not merely the first (Req 22 AC9). */
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

export interface JobFormProps {
  /** The draft the form starts from. Remount with a new `key` to reseed it (AC6). */
  readonly initial: JobDraft
  /** Localized label of the submit control. */
  readonly submitLabel: string
  /** Called with the edited draft once the client-side rules pass. */
  readonly onSubmit: (draft: JobDraft) => void
  /** Whether the submission is in flight; disables the control (Req 21 AC12). */
  readonly pending?: boolean
  /** The failure of the last submission, for violations and the Error_Presenter. */
  readonly error?: unknown
  /** Inputs an extraction left empty, which carry the manual-entry warning (AC8). */
  readonly missingExtracted?: readonly ExtractableField[]
  /** Required skills the taxonomy could not name; skill editing is disabled (AC11). */
  readonly unresolvedSkillIds?: readonly string[]
  /**
   * Localized reason the submit control is disabled — the extraction confirmation
   * gate of AC7/AC10, for instance. `null` leaves the control enabled.
   */
  readonly blockedReason?: string | null
  /** Rendered between the fields and the actions, e.g. the skill-candidate panel. */
  readonly children?: ReactNode
  /** Rendered beside the submit control, e.g. a cancel link. */
  readonly secondaryAction?: ReactNode
  /** Announced once the submission succeeded (Req 20 AC7). */
  readonly successMessage?: string | null
  readonly testId?: string
}

/** The Job_Description creation and edit form (AC1). */
export function JobForm({
  initial,
  submitLabel,
  onSubmit,
  pending = false,
  error,
  missingExtracted = [],
  unresolvedSkillIds = [],
  blockedReason = null,
  children,
  secondaryAction,
  successMessage = null,
  testId = 'job-form',
}: JobFormProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const scope = useId()
  const [draft, setDraft] = useState<JobDraft>(initial)
  const [issues, setIssues] = useState<readonly ValidationIssue[]>([])

  /**
   * The inputs this form renders, in rendering order.
   *
   * The order is what makes "the first affected input" of Req 20 AC6 the first one
   * a person reaches, and the paths are the contract member names, so a server
   * violation lands without a translation table.
   */
  const inputs = useMemo<readonly RenderedInput[]>(() => {
    const scalar = [
      JOB_FIELD.title,
      JOB_FIELD.company,
      JOB_FIELD.location,
      JOB_FIELD.workModel,
      JOB_FIELD.employmentType,
      JOB_FIELD.experienceLevel,
      JOB_FIELD.description,
      JOB_FIELD.applicationChannel,
      JOB_FIELD.externalUrl,
    ].map((path) => ({ path, id: `${scope}-${path}` }))
    const terms = draft.skillTerms.map((_, index) => ({
      path: skillTermPath(index),
      id: `${scope}-${skillTermPath(index)}`,
    }))
    // The collection itself, so a size violation against `required_skill_terms`
    // lands on the editor rather than in the form-level region.
    return [
      ...scalar,
      ...terms,
      { path: SKILL_TERMS_PATH, id: `${scope}-${SKILL_TERMS_PATH}` },
    ]
  }, [scope, draft.skillTerms])

  // Memoized because `useViolationFocus` treats a new partition as a new failed
  // submission; rebuilding one per render would keep pulling focus back.
  const clientPartition = useMemo<JobPartition>(
    () => partitionViolations<PlaceableIssue, RenderedInput>(issues, inputs),
    [issues, inputs],
  )
  const serverPartition = useMemo<JobPartition>(
    () =>
      partitionViolations<PlaceableIssue, RenderedInput>(
        isApiFailure(error) ? error.fieldViolations : null,
        inputs,
      ),
    [error, inputs],
  )

  // The server's report wins when it placed anything: it is the more recent verdict
  // on the same values.
  useViolationFocus(serverPartition.fields.length > 0 ? serverPartition : clientPartition)

  const messagesFor = (path: string): readonly string[] =>
    issueTexts(i18n, [
      ...violationsForPath(clientPartition, path),
      ...violationsForPath(serverPartition, path),
    ])

  const formLevelMessages = issueTexts(i18n, [
    ...clientPartition.formLevel,
    ...serverPartition.formLevel,
  ])

  /** A failure that named no field belongs to the Error_Presenter. */
  const presentableError =
    error == null || (isApiFailure(error) && error.fieldViolations.length > 0) ? null : error

  const warnedFields = new Set(missingExtracted.map((field) => WARNING_FIELD_PATHS[field]))
  const warningId = (path: string): string => `${scope}-${path}-warning`

  /** The accessible description of one input: the AC8 warning, else the hint. */
  const describe = (
    path: string,
    hint?: string,
  ): { description?: ReactNode; descriptionProps?: { id: string } } => {
    if (warnedFields.has(path)) {
      return {
        description: t('jobs:form.missingExtracted'),
        descriptionProps: { id: warningId(path) },
      }
    }
    return hint === undefined ? {} : { description: hint, descriptionProps: { id: warningId(path) } }
  }

  const fieldProps = (path: string, hint?: string) => {
    const messages = messagesFor(path)
    return {
      id: inputElementId({ path, id: `${scope}-${path}` }),
      ...describe(path, hint),
      ...(messages.length === 0
        ? {}
        : {
            error: errorContent(messages),
            errorProps: { id: violationMessageId({ path, id: `${scope}-${path}` }) },
          }),
      ...(warnedFields.has(path) ? { 'data-warned': 'true' } : {}),
    }
  }

  const blocked = blockedReason !== null && blockedReason !== ''
  const blockedId = `${scope}-blocked`

  return (
    <form
      noValidate
      data-testid={testId}
      onSubmit={(event) => {
        event.preventDefault()
        // Req 22 AC12: the client-side pass is an aid. A clean draft still goes to
        // the Backend_Api, which remains the authoritative validator.
        const found = validateJobDraft(draft)
        setIssues(found)
        if (found.length > 0 || blocked) {
          return
        }
        onSubmit(draft)
      }}
    >
      <Stack gap="md">
        {presentableError === null ? null : <ErrorPresenter error={presentableError} />}

        {formLevelMessages.length === 0 ? null : (
          <Stack gap={2} role="alert" data-testid="job-form-violations">
            {formLevelMessages.map((message) => (
              <Text key={message} size="sm" c="red">
                {message}
              </Text>
            ))}
          </Stack>
        )}

        <TextInput
          {...fieldProps(JOB_FIELD.title)}
          label={t('jobs:form.title')}
          value={draft.title}
          withAsterisk
          maxLength={BOUNDS.job.title.maxLength}
          onChange={(event) => {
            const title = textForSubmission(event.currentTarget.value)
            setDraft((current) => ({ ...current, title }))
          }}
          data-testid="job-form-title"
        />

        <TextInput
          {...fieldProps(JOB_FIELD.company)}
          label={t('jobs:form.company')}
          value={draft.company}
          withAsterisk
          maxLength={BOUNDS.job.company.maxLength}
          onChange={(event) => {
            const company = textForSubmission(event.currentTarget.value)
            setDraft((current) => ({ ...current, company }))
          }}
          data-testid="job-form-company"
        />

        <TextInput
          {...fieldProps(JOB_FIELD.location)}
          label={t('jobs:form.location')}
          value={draft.location}
          maxLength={BOUNDS.job.location.maxLength}
          onChange={(event) => {
            const location = textForSubmission(event.currentTarget.value)
            setDraft((current) => ({ ...current, location }))
          }}
          data-testid="job-form-location"
        />

        <Select
          {...fieldProps(JOB_FIELD.workModel)}
          label={t('jobs:card.workModel')}
          placeholder={t('jobs:form.unselected')}
          data={enumOptions(WORK_MODEL_VALUES, (value) => t(`jobs:workModel.${value}`))}
          value={draft.workModel}
          clearable
          comboboxProps={{ withinPortal: false }}
          onChange={(value) =>
            setDraft((current) => ({ ...current, workModel: (value as WorkModel | null) ?? null }))
          }
          data-testid="job-form-work-model"
        />

        <Select
          {...fieldProps(JOB_FIELD.employmentType)}
          label={t('jobs:card.employmentType')}
          placeholder={t('jobs:form.unselected')}
          data={enumOptions(EMPLOYMENT_TYPE_VALUES, (value) => t(`jobs:employmentType.${value}`))}
          value={draft.employmentType}
          clearable
          comboboxProps={{ withinPortal: false }}
          onChange={(value) =>
            setDraft((current) => ({
              ...current,
              employmentType: (value as EmploymentType | null) ?? null,
            }))
          }
          data-testid="job-form-employment-type"
        />

        <Select
          {...fieldProps(JOB_FIELD.experienceLevel)}
          label={t('jobs:card.experienceLevel')}
          placeholder={t('jobs:form.unselected')}
          data={enumOptions(EXPERIENCE_LEVEL_VALUES, (value) => t(`jobs:experienceLevel.${value}`))}
          value={draft.experienceLevel}
          clearable
          comboboxProps={{ withinPortal: false }}
          onChange={(value) =>
            setDraft((current) => ({
              ...current,
              experienceLevel: (value as ExperienceLevel | null) ?? null,
            }))
          }
          data-testid="job-form-experience-level"
        />

        <Textarea
          {...fieldProps(JOB_FIELD.description)}
          label={t('jobs:detail.description')}
          value={draft.description}
          autosize
          minRows={4}
          maxRows={16}
          maxLength={BOUNDS.job.description.maxLength}
          onChange={(event) => {
            const description = textForSubmission(event.currentTarget.value)
            setDraft((current) => ({ ...current, description }))
          }}
          data-testid="job-form-description"
        />

        <JobSkillTermsField
          terms={draft.skillTerms}
          messagesFor={messagesFor}
          inputIdFor={(path) => `${scope}-${path}`}
          messageIdFor={(path) => violationMessageId({ path, id: `${scope}-${path}` })}
          onChange={(skillTerms) => setDraft((current) => ({ ...current, skillTerms }))}
          unresolvedSkillIds={unresolvedSkillIds}
          disabled={pending}
        />

        <Select
          {...fieldProps(JOB_FIELD.applicationChannel)}
          label={t('jobs:detail.applicationChannel')}
          placeholder={t('jobs:form.unselected')}
          data={APPLICATION_CHANNELS.map((value) => ({
            value,
            label: t(`jobs:channel.${value}`),
          }))}
          value={draft.applicationChannel}
          clearable
          comboboxProps={{ withinPortal: false }}
          onChange={(value) =>
            setDraft((current) => ({
              ...current,
              applicationChannel: (value as ApplicationChannel | null) ?? null,
            }))
          }
          data-testid="job-form-application-channel"
        />

        {/* AC13: the publish precondition is stated where the URL is entered. */}
        <TextInput
          {...fieldProps(
            JOB_FIELD.externalUrl,
            requiresExternalUrl(draft.applicationChannel)
              ? t('jobs:form.externalUrlRequired', { max: EXTERNAL_URL_MAX_LENGTH })
              : t('jobs:form.externalUrlHint', { max: EXTERNAL_URL_MAX_LENGTH }),
          )}
          label={t('jobs:form.externalUrl')}
          value={draft.externalUrl}
          inputMode="url"
          maxLength={EXTERNAL_URL_MAX_LENGTH}
          withAsterisk={requiresExternalUrl(draft.applicationChannel)}
          onChange={(event) => {
            const externalUrl = textForSubmission(event.currentTarget.value)
            setDraft((current) => ({ ...current, externalUrl }))
          }}
          data-testid="job-form-external-url"
        />

        {children}

        <Group gap="sm" align="center">
          <Button
            type="submit"
            loading={pending}
            disabled={blocked}
            aria-disabled={blocked}
            {...(blocked ? { 'aria-describedby': blockedId } : {})}
            data-testid="job-form-submit"
          >
            {submitLabel}
          </Button>
          {secondaryAction}
          {blocked ? (
            <Text id={blockedId} size="sm" c="dimmed" data-testid="job-form-blocked">
              {blockedReason}
            </Text>
          ) : null}
        </Group>

        <LiveAnnouncement message={successMessage} />
      </Stack>
    </form>
  )
}
