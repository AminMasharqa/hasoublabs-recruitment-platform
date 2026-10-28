/**
 * The Admin status control of one Application (Requirement 14 AC13, AC14).
 *
 * AC13 fixes the shape: a target status drawn from `Submitted`, `Under Review`,
 * `Forwarded to Recruiter` and `Closed`, an optional reason, and a call to
 * `PATCH /admin/applications/{application_id}/status`. The four targets come from the
 * contract's `ApplicationStatus` union (`APPLICATION_STATUS_TARGETS`), so a status the
 * Backend_Api renames fails the typecheck instead of quietly leaving the control.
 *
 * AC14 is the mutation's, not this component's: `useUpdateApplicationStatus`
 * invalidates the cached applicant list of the affected Job_Description and the cached
 * Application detail on a 200, so what is rendered afterwards is the Backend_Api's
 * answer rather than a locally patched guess.
 *
 * ## The reason
 *
 * Optional, so a blank one is omitted from the request rather than sent empty. Entered
 * text is checked client-side against the bounds the Backend_Api declares, and a
 * failing reason never reaches the network; the Backend_Api remains the authority, so a
 * 422 it reports is placed on the same input by `forms/violations.ts` — every reported
 * violation rendered, an unaddressed one in the form-level region, and the entered text
 * untouched (Req 22 AC9–AC11, Req 20 AC6).
 *
 * Requirements: 14.13, 14.14, 19.2, 19.11, 20.5, 20.6, 20.7, 22.9, 22.10, 22.11.
 */

import { Button, Group, Select, Stack, Text, Textarea } from '@mantine/core'
import { useId, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { isApiFailure } from '../../api/client'
import type { ApplicationStatus } from '../../api/enums'
import { ErrorPresenter, LiveAnnouncement } from '../../errors/ErrorPresenter'
import { textForSubmission } from '../../i18n/formatting'
import type { ValidationIssue } from '../../forms/validators'
import {
  describeField,
  partitionViolations,
  useViolationFocus,
  violationsForPath,
  type PlaceableIssue,
  type RenderedInput,
  type ViolationPartition,
} from '../../forms/violations'

import { applicationStatusLabel, fieldIssueTexts } from './applicationMessages'
import { useUpdateApplicationStatus } from './applicationQueries'
import {
  APPLICATION_STATUS_TARGETS,
  isApplicationStatus,
  STATUS_REASON_BOUNDS,
  STATUS_REASON_PATH,
  validateStatusReason,
} from './applicationRules'

/** Namespaces this control resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['applications', 'shell', 'errors', 'validation'] as const

/** A partition of issues from either source over the reason input. */
type ReasonPartition = ViolationPartition<PlaceableIssue, RenderedInput>

export interface ApplicationStatusControlProps {
  /** The Application whose status is being changed (AC13). */
  readonly applicationId: string
  /**
   * The Job_Description whose applicant list to invalidate (AC14), when the screen
   * knows it. Omitted, the returned Application names it.
   */
  readonly jdId?: string
  /** The current status, used to seed the target selection. */
  readonly currentStatus?: string
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

/** The status control of one Application (AC13, AC14). */
export function ApplicationStatusControl({
  applicationId,
  jdId,
  currentStatus,
}: ApplicationStatusControlProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const scope = useId()
  const change = useUpdateApplicationStatus()

  const [status, setStatus] = useState<ApplicationStatus | null>(
    isApplicationStatus(currentStatus) ? currentStatus : null,
  )
  const [reason, setReason] = useState('')
  const [issues, setIssues] = useState<readonly ValidationIssue[]>([])

  const reasonInput = useMemo<RenderedInput>(
    () => ({ path: STATUS_REASON_PATH, id: `${scope}-reason` }),
    [scope],
  )
  const inputs = useMemo(() => [reasonInput], [reasonInput])

  // Memoized because `useViolationFocus` treats a new partition as a new failed
  // submission; rebuilding one per render would keep pulling focus back.
  const clientPartition = useMemo<ReasonPartition>(
    () => partitionViolations<PlaceableIssue, RenderedInput>(issues, inputs),
    [issues, inputs],
  )
  const serverPartition = useMemo<ReasonPartition>(
    () =>
      partitionViolations<PlaceableIssue, RenderedInput>(
        isApiFailure(change.error) ? change.error.fieldViolations : null,
        inputs,
      ),
    [change.error, inputs],
  )

  // Req 20 AC6. The server's report wins when it placed anything: it is the more
  // recent verdict on the same reason.
  useViolationFocus(serverPartition.fields.length > 0 ? serverPartition : clientPartition)

  const reasonMessages = fieldIssueTexts(i18n, [
    ...violationsForPath(clientPartition, STATUS_REASON_PATH),
    ...violationsForPath(serverPartition, STATUS_REASON_PATH),
  ])
  const formLevelMessages = fieldIssueTexts(i18n, [
    ...clientPartition.formLevel,
    ...serverPartition.formLevel,
  ])

  /**
   * A failure that named no field — a denial, an illegal transition, a timeout. It
   * belongs to the Error_Presenter rather than being forced onto the reason input,
   * and the presenter also renders its Support_Reference.
   */
  const presentableError =
    change.error == null ||
    (isApiFailure(change.error) && change.error.fieldViolations.length > 0)
      ? null
      : change.error

  const described = describeField(reasonInput)
  const hintId = `${described.inputId}-hint`

  const submit = (): void => {
    if (status === null) {
      return
    }
    const found = validateStatusReason(reason)
    setIssues(found === null ? [] : [found])
    if (found !== null) {
      return
    }
    change.mutate({
      applicationId,
      status,
      reason: reason.trim() === '' ? null : reason,
      ...(jdId === undefined ? {} : { jdId }),
    })
  }

  return (
    <Stack gap="sm" data-testid={`application-status-control-${applicationId}`}>
      <Select
        label={t('applications:admin.statusLabel')}
        description={t('applications:admin.statusHint')}
        data={APPLICATION_STATUS_TARGETS.map((value) => ({
          value,
          label: applicationStatusLabel(i18n, value),
        }))}
        value={status}
        onChange={(value) => setStatus(isApplicationStatus(value) ? value : null)}
        allowDeselect={false}
        disabled={change.isPending}
        data-testid="application-status-target"
      />

      <Textarea
        id={described.inputId}
        label={t('applications:admin.reasonLabel')}
        description={t('applications:admin.reasonHint', {
          max: STATUS_REASON_BOUNDS.maxLength,
        })}
        descriptionProps={{ id: hintId }}
        error={errorContent(reasonMessages)}
        errorProps={{ id: described.messageId }}
        value={reason}
        onChange={(event) => {
          // Req 19 AC11: submitted exactly as entered.
          setReason(textForSubmission(event.currentTarget.value))
        }}
        autosize
        minRows={2}
        maxRows={6}
        disabled={change.isPending}
        data-testid="application-status-reason"
      />

      {formLevelMessages.length === 0 ? null : (
        <Stack gap={2} role="alert" data-testid="application-status-form-violations">
          {formLevelMessages.map((message) => (
            <Text key={message} size="sm" c="red">
              {message}
            </Text>
          ))}
        </Stack>
      )}

      {presentableError === null ? null : <ErrorPresenter error={presentableError} />}

      <Group gap="sm">
        <Button
          type="button"
          loading={change.isPending}
          disabled={status === null}
          onClick={submit}
          data-testid="application-status-submit"
        >
          {t('applications:admin.submit')}
        </Button>
      </Group>

      {change.isSuccess ? (
        <Text size="sm" data-testid="application-status-result">
          {t('applications:admin.changed', {
            status: applicationStatusLabel(i18n, change.data.status),
          })}
        </Text>
      ) : null}

      {/* Req 20 AC7: the outcome is announced without moving focus. */}
      <LiveAnnouncement
        message={
          change.isSuccess
            ? t('applications:announce.statusChanged', {
                status: applicationStatusLabel(i18n, change.data.status),
              })
            : null
        }
      />
    </Stack>
  )
}
