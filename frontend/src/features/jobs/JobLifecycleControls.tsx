/**
 * The lifecycle controls of one Job_Description
 * (Requirement 13 AC12–AC16, AC18).
 *
 * Which controls exist is not decided here: {@link jobAuthoringActions} answers it
 * from the `status`, so the requirement's status-to-control table lives in one pure,
 * assertable place and this component renders whatever that table returns. A
 * `Closed` Job_Description therefore renders no publish, no close and no channel
 * control, and there is no `reopen` control anywhere in the union to render — which
 * is how AC15 holds structurally rather than by a conditional someone has to notice.
 *
 * ## The irreversible-close dialog (AC14)
 *
 * The close request is issued from inside the dialog and from nowhere else, so
 * there is no path to an unconfirmed close: the visible control only opens the
 * dialog, whose text states that closing cannot be undone. The dialog is a `Modal`
 * from `@mantine/core`, which confines focus while open and restores it to the
 * control that opened it on close (Req 20 AC11).
 *
 * ## The publish precondition (AC13)
 *
 * While the Application_Channel is `External_Careers_URL`, a well-formed HTTPS URL
 * of at most 500 characters is required *before* the publish request is issued.
 * {@link validatePublishPrecondition} decides that from the loaded
 * Job_Description, so the rule applies whether or not the form was touched, and a
 * failing one is reported against the external-URL field with the edit form pointed
 * at rather than a request the Backend_Api would refuse.
 *
 * ## illegal_transition (AC18)
 *
 * A refused transition renders a localized message naming the reported `details.from`
 * and `details.to`, and the displayed Job_Description is refetched: the refusal means
 * the client's picture of the lifecycle is stale, so the controls are re-derived from
 * whatever the Backend_Api now reports rather than from what this screen believed.
 * Both halves come from one reading of the envelope, {@link illegalTransitionOf}.
 *
 * Requirements: 13.12, 13.13, 13.14, 13.15, 13.16, 13.18, 19.2, 20.5, 20.7, 20.11, 21.1.
 */

import { Button, Group, Modal, Select, Stack, Text } from '@mantine/core'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ApplicationChannel } from '../../api/enums'
import { ErrorPresenter, LiveAnnouncement } from '../../errors/ErrorPresenter'
import { issueTexts } from '../admin-accounts'

import { useCloseJob, usePublishJob, useSetApplicationChannel } from './authoringQueries'
import {
  APPLICATION_CHANNELS,
  canCloseJob,
  canPublishJob,
  canSetApplicationChannel,
  validatePublishPrecondition,
} from './authoringRules'
import { IllegalTransitionNotice } from './IllegalTransitionNotice'
import type { JobDescription } from './jobsApi'

/** Namespaces these controls resolve their strings against (Req 19 AC2). */
const NAMESPACES = ['jobs', 'shell', 'errors', 'validation'] as const

export interface JobLifecycleControlsProps {
  /** The Job_Description these controls act on. */
  readonly job: JobDescription
}

/** A channel the user picked, and the channel it was picked against (AC16). */
interface ChannelSelection {
  readonly against: ApplicationChannel | null
  readonly chosen: ApplicationChannel | null
}

/** The publish, close and Application_Channel controls (AC12–AC16, AC18). */
export function JobLifecycleControls({ job }: JobLifecycleControlsProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const scope = useId()

  const publish = usePublishJob()
  const close = useCloseJob()
  const channel = useSetApplicationChannel()

  const [confirmingClose, setConfirmingClose] = useState(false)
  const [selectedChannel, setSelectedChannel] = useState<ChannelSelection | null>(null)

  const failure = publish.error ?? close.error ?? channel.error ?? null

  /**
   * The channel the select shows: the user's choice while it was made against the
   * channel the Job_Description still carries, else the Job_Description's own.
   *
   * Derived rather than synchronized, so the select follows the Backend_Api's answer
   * — after a successful change, and after the AC18 refresh — without an effect that
   * would overwrite a choice the user is in the middle of making.
   */
  const channelDraft: ApplicationChannel | null =
    selectedChannel !== null && selectedChannel.against === job.application_channel
      ? selectedChannel.chosen
      : job.application_channel

  const publishBlocker = validatePublishPrecondition(job)
  const publishBlockerMessage =
    publishBlocker === null ? null : (issueTexts(i18n, [publishBlocker])[0] ?? null)
  const publishBlockedId = `${scope}-publish-blocked`

  const showPublish = canPublishJob(job.status)
  const showClose = canCloseJob(job.status)
  const showChannel = canSetApplicationChannel(job.status)

  const busy = publish.isPending || close.isPending || channel.isPending

  if (!showPublish && !showClose && !showChannel) {
    // AC15: a `Closed` Job_Description offers no transition at all.
    return (
      <Text size="sm" c="dimmed" data-testid="job-lifecycle-none">
        {t('jobs:lifecycle.noneAvailable')}
      </Text>
    )
  }

  return (
    <Stack gap="sm" data-testid="job-lifecycle-controls">
      {/* AC1 of Requirement 21: the failure renders its localized catalogue entry
          and its Support_Reference; AC18 adds the two reported states beside it. */}
      {failure === null ? null : (
        <Stack gap={4}>
          <ErrorPresenter error={failure} />
          <IllegalTransitionNotice jdId={job.id} error={failure} />
        </Stack>
      )}

      <Group gap="sm" align="center" wrap="wrap">
        {/* AC12 */}
        {showPublish ? (
          <Button
            type="button"
            loading={publish.isPending}
            disabled={busy || publishBlocker !== null}
            aria-disabled={busy || publishBlocker !== null}
            {...(publishBlocker === null ? {} : { 'aria-describedby': publishBlockedId })}
            onClick={() => {
              publish.reset()
              publish.mutate(job.id)
            }}
            data-testid="job-publish"
          >
            {t('jobs:lifecycle.publish')}
          </Button>
        ) : null}

        {/* AC14: the visible control only opens the confirmation dialog. */}
        {showClose ? (
          <Button
            type="button"
            variant="default"
            color="red"
            disabled={busy}
            onClick={() => {
              close.reset()
              setConfirmingClose(true)
            }}
            data-testid="job-close"
          >
            {t('jobs:lifecycle.close')}
          </Button>
        ) : null}
      </Group>

      {/* AC13: the reason the publish control is disabled, wired to it. */}
      {publishBlockerMessage === null || !showPublish ? null : (
        <Text id={publishBlockedId} size="sm" c="red" data-testid="job-publish-blocked">
          {t('jobs:lifecycle.publishNeedsUrl')} {publishBlockerMessage}
        </Text>
      )}

      {/* AC16 */}
      {showChannel ? (
        <Group gap="sm" align="flex-end">
          <Select
            id={`${scope}-channel`}
            label={t('jobs:lifecycle.channelLabel')}
            description={t('jobs:lifecycle.channelHint')}
            data={APPLICATION_CHANNELS.map((value) => ({
              value,
              label: t(`jobs:channel.${value}`),
            }))}
            value={channelDraft}
            comboboxProps={{ withinPortal: false }}
            disabled={busy}
            onChange={(value) =>
              setSelectedChannel({
                against: job.application_channel,
                chosen: (value as ApplicationChannel | null) ?? null,
              })
            }
            data-testid="job-channel-select"
          />
          <Button
            type="button"
            variant="light"
            loading={channel.isPending}
            disabled={busy || channelDraft === null || channelDraft === job.application_channel}
            onClick={() => {
              if (channelDraft === null) {
                return
              }
              channel.reset()
              channel.mutate({ jdId: job.id, channel: channelDraft })
            }}
            data-testid="job-channel-save"
          >
            {t('jobs:lifecycle.channelSave')}
          </Button>
        </Group>
      ) : null}

      {/* AC14: the irreversible-close confirmation. */}
      <Modal
        opened={confirmingClose}
        onClose={() => setConfirmingClose(false)}
        title={t('jobs:lifecycle.confirmCloseTitle')}
        closeButtonProps={{ 'aria-label': t('shell:action.close') }}
      >
        <Stack gap="sm" data-testid="job-close-confirm">
          <Text>{t('jobs:lifecycle.confirmCloseBody')}</Text>
          <Text fw={500} c="red">
            {t('jobs:lifecycle.confirmCloseIrreversible')}
          </Text>
          {close.error == null ? null : <ErrorPresenter error={close.error} />}
          <Group gap="sm">
            <Button
              type="button"
              color="red"
              loading={close.isPending}
              onClick={() => {
                close.mutate(job.id, { onSuccess: () => setConfirmingClose(false) })
              }}
              data-testid="job-close-confirm-submit"
            >
              {t('jobs:lifecycle.confirmCloseAction')}
            </Button>
            <Button
              type="button"
              variant="default"
              disabled={close.isPending}
              onClick={() => setConfirmingClose(false)}
              data-testid="job-close-confirm-cancel"
            >
              {t('shell:action.cancel')}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Req 20 AC7: the outcome is announced without moving focus. */}
      <LiveAnnouncement
        message={
          publish.isSuccess
            ? t('jobs:announce.published')
            : close.isSuccess
              ? t('jobs:announce.closed')
              : channel.isSuccess
                ? t('jobs:announce.channelChanged')
                : null
        }
      />
    </Stack>
  )
}
