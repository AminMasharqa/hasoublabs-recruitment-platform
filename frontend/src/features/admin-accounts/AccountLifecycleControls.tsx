/**
 * The status-driven lifecycle controls of one account (Requirement 16 AC7–AC12,
 * AC15, AC16).
 *
 * Which controls exist is not decided here: {@link lifecycleActionsFor} answers it
 * from the account's Account_Status, so the requirement's status-to-control table
 * lives in one pure, assertable place and this component renders whatever that
 * table returns. A status offering nothing — `Deactivated` — therefore renders
 * nothing, without a special case.
 *
 * ## The confirmation dialog (AC16)
 *
 * Reject, suspend and deactivate are issued from inside the dialog and from nowhere
 * else, so there is no path to an unconfirmed request: the list control only opens
 * the dialog. The same three carry a reason (AC8, AC10), which is entered in that
 * dialog — one surface, one deliberate act.
 *
 * The dialog is a `Modal` from `@mantine/core`, which confines focus while it is
 * open and restores it to the control that opened it on close (Req 20 AC11).
 *
 * ## The reason
 *
 * Client-side first: {@link validateLifecycleReason} applies the 10–500 bound of a
 * rejection and the 1–500 bound of a suspension or deactivation, and a failing
 * reason never reaches the network. The Backend_Api remains the authority, so a 422
 * it reports is placed on the same input by `forms/violations.ts` — every reported
 * violation rendered, an unaddressed one in the form-level region, and the entered
 * text untouched (Req 22 AC9–AC11).
 *
 * ## AC15
 *
 * The mutation writes the returned account into every cached page and invalidates
 * the list (`accountQueries.ts`), so the status this card renders after a 200 is the
 * status the Backend_Api returned. Nothing here predicts where a transition leads.
 *
 * Requirements: 16.7, 16.8, 16.9, 16.10, 16.11, 16.12, 16.15, 16.16, 19.2, 20.6, 20.7, 20.11, 22.9, 22.10, 22.11.
 */

import { Button, Checkbox, Group, Modal, Stack, Text, Textarea } from '@mantine/core'
import { useId, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { isApiFailure } from '../../api/client'
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

import { useAccountLifecycleMutation } from './accountQueries'
import {
  lifecycleActionsFor,
  reasonBoundsFor,
  REASON_PATH,
  requiresConfirmation,
  requiresReason,
  validateLifecycleReason,
  type Account,
  type LifecycleAction,
} from './accountRules'
import { issueTexts } from './issueText'

/** Namespaces the controls resolve their strings against (Req 19 AC2). */
const NAMESPACES = ['adminAccounts', 'shell', 'errors', 'validation'] as const

/** A partition of issues from either source over the reason input. */
type ReasonPartition = ViolationPartition<PlaceableIssue, RenderedInput>

/** The destructive transitions, rendered in the warning colour. */
const DESTRUCTIVE_ACTIONS: readonly LifecycleAction[] = ['reject', 'suspend', 'deactivate']

export interface AccountLifecycleControlsProps {
  /** The account these controls act on. */
  readonly account: Account
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

/** The lifecycle controls of one account (AC7–AC12, AC16). */
export function AccountLifecycleControls({ account }: AccountLifecycleControlsProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const scope = useId()
  const lifecycle = useAccountLifecycleMutation()

  /** The transition awaiting confirmation, or `null` while no dialog is open. */
  const [confirming, setConfirming] = useState<LifecycleAction | null>(null)
  const [reason, setReason] = useState('')
  const [issues, setIssues] = useState<readonly ValidationIssue[]>([])
  /** AC7: the fast-track indicator the approve call carries. */
  const [fastTrack, setFastTrack] = useState(false)

  const actions = lifecycleActionsFor(account.status)

  const reasonInput = useMemo<RenderedInput>(
    () => ({ path: REASON_PATH, id: `${scope}-reason` }),
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
        isApiFailure(lifecycle.error) ? lifecycle.error.fieldViolations : null,
        inputs,
      ),
    [lifecycle.error, inputs],
  )

  // Req 20 AC6. The server's report wins when it placed anything: it is the more
  // recent verdict on the same reason.
  useViolationFocus(serverPartition.fields.length > 0 ? serverPartition : clientPartition)

  const reasonMessages = issueTexts(i18n, [
    ...violationsForPath(clientPartition, REASON_PATH),
    ...violationsForPath(serverPartition, REASON_PATH),
  ])
  const formLevelMessages = issueTexts(i18n, [
    ...clientPartition.formLevel,
    ...serverPartition.formLevel,
  ])

  /**
   * A failure that named no field — `illegal_transition`, a denial, a timeout. It
   * belongs to the Error_Presenter rather than being forced onto the reason input,
   * and the presenter also renders its Support_Reference.
   */
  const presentableError =
    lifecycle.error == null ||
    (isApiFailure(lifecycle.error) && lifecycle.error.fieldViolations.length > 0)
      ? null
      : lifecycle.error

  const described = describeField(reasonInput)
  const hintId = `${described.inputId}-hint`

  const closeDialog = (): void => {
    setConfirming(null)
    setReason('')
    setIssues([])
    lifecycle.reset()
  }

  /** Issues a transition that needs no confirmation (AC7, AC9, AC11, AC12). */
  const issueDirectly = (action: LifecycleAction): void => {
    lifecycle.reset()
    setIssues([])
    lifecycle.mutate({
      accountId: account.id,
      action,
      ...(action === 'approve' ? { fastTrack } : {}),
    })
  }

  /** Issues the confirmed transition, reason and all (AC8, AC10, AC16). */
  const issueConfirmed = (): void => {
    if (confirming === null) {
      return
    }
    const found = validateLifecycleReason(confirming, reason)
    setIssues(found === null ? [] : [found])
    if (found !== null) {
      return
    }
    lifecycle.mutate(
      { accountId: account.id, action: confirming, reason },
      { onSuccess: () => closeDialog() },
    )
  }

  if (actions.length === 0) {
    return (
      <Text size="sm" c="dimmed" data-testid={`account-no-actions-${account.id}`}>
        {t('adminAccounts:lifecycle.noneAvailable')}
      </Text>
    )
  }

  const bounds = confirming === null ? null : reasonBoundsFor(confirming)

  return (
    <Stack gap="xs">
      <Group gap="xs" align="center" wrap="wrap">
        {actions.map((action) => (
          <Button
            key={action}
            type="button"
            size="xs"
            variant={DESTRUCTIVE_ACTIONS.includes(action) ? 'default' : 'light'}
            color={DESTRUCTIVE_ACTIONS.includes(action) ? 'red' : undefined}
            loading={lifecycle.isPending && lifecycle.variables?.action === action}
            onClick={() => {
              if (requiresConfirmation(action)) {
                // AC16: the control opens the dialog; the request is issued there.
                setIssues([])
                lifecycle.reset()
                setReason('')
                setConfirming(action)
                return
              }
              issueDirectly(action)
            }}
            data-testid={`account-action-${action}-${account.id}`}
          >
            {t(`adminAccounts:lifecycle.${action}`)}
          </Button>
        ))}

        {/* AC7: the fast-track indicator the approve call carries. */}
        {actions.includes('approve') ? (
          <Checkbox
            label={t('adminAccounts:lifecycle.fastTrack')}
            description={t('adminAccounts:lifecycle.fastTrackHint')}
            checked={fastTrack}
            onChange={(event) => setFastTrack(event.currentTarget.checked)}
            data-testid={`account-fast-track-${account.id}`}
          />
        ) : null}
      </Group>

      {presentableError === null || confirming !== null ? null : (
        <ErrorPresenter error={presentableError} />
      )}

      {/* AC8, AC10, AC16: reason entry and confirmation, in one dialog. */}
      <Modal
        opened={confirming !== null}
        onClose={closeDialog}
        title={confirming === null ? '' : t(`adminAccounts:confirm.${confirming}.title`)}
        closeButtonProps={{ 'aria-label': t('shell:action.close') }}
      >
        {confirming === null ? null : (
          <Stack gap="sm" data-testid={`account-confirm-${account.id}`}>
            <Text>{t(`adminAccounts:confirm.${confirming}.body`)}</Text>

            {presentableError === null ? null : <ErrorPresenter error={presentableError} />}

            {formLevelMessages.length === 0 ? null : (
              <Stack gap={2} role="alert" data-testid="account-confirm-form-violations">
                {formLevelMessages.map((message) => (
                  <Text key={message} size="sm" c="red">
                    {message}
                  </Text>
                ))}
              </Stack>
            )}

            {requiresReason(confirming) && bounds !== null ? (
              <Textarea
                id={described.inputId}
                label={t('adminAccounts:confirm.reasonLabel')}
                description={t('adminAccounts:confirm.reasonHint', {
                  min: bounds.minLength,
                  max: bounds.maxLength,
                })}
                descriptionProps={{ id: hintId }}
                error={errorContent(reasonMessages)}
                errorProps={{ id: described.messageId }}
                value={reason}
                onChange={(event) => {
                  // Req 19 AC11: submitted exactly as entered.
                  setReason(textForSubmission(event.currentTarget.value))
                }}
                withAsterisk
                autosize
                minRows={3}
                maxRows={8}
                disabled={lifecycle.isPending}
                data-testid="account-confirm-reason"
              />
            ) : null}

            <Group gap="sm">
              <Button
                type="button"
                color="red"
                loading={lifecycle.isPending}
                onClick={issueConfirmed}
                data-testid="account-confirm-submit"
              >
                {t(`adminAccounts:confirm.${confirming}.confirm`)}
              </Button>
              <Button
                type="button"
                variant="default"
                disabled={lifecycle.isPending}
                onClick={closeDialog}
                data-testid="account-confirm-cancel"
              >
                {t('shell:action.cancel')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      {/* Req 20 AC7: the outcome is announced without moving focus. */}
      <LiveAnnouncement
        message={
          lifecycle.isSuccess
            ? t('adminAccounts:announce.statusChanged', {
                status: t(`adminAccounts:status.${lifecycle.data.status}`),
              })
            : null
        }
      />
    </Stack>
  )
}
