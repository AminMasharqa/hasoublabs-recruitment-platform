/**
 * The Job_Description status indicator and the apply control
 * (Requirement 12 AC7).
 *
 * Both are shared by the list entry and the detail view, which is what makes AC7
 * — "a closed indicator in both the list entry and the detail view, and the apply
 * control disabled" — one behaviour with one implementation instead of two that
 * have to be kept in step. The verdict itself is `jobStatus.ts`.
 *
 * Named `JobStatusControls` rather than `JobStatus` because the verdict module
 * beside it is `jobStatus.ts`: on a case-insensitive file system two modules
 * differing only in the case of their first letter are one file to the resolver,
 * so importing both from the same program fails to build.
 *
 * ## The seam for the apply flow (Requirement 14)
 *
 * Requirement 12 owns whether the apply control is *present and enabled*;
 * Requirement 14 owns what happens when it is pressed — the CV_Variant choice, the
 * `POST /jobs/{jd_id}/apply` call, the confirmation, the `redirect_url` handling
 * and the `precondition_unmet` / `conflicting_state` / `rate_limited` outcomes. That
 * flow is the application slice's `ApplyDialog`, which this control opens once it
 * knows *which* Job_Description is being applied to: the `jdId` prop, falling back to
 * the `:jdId` route parameter so the detail screen needs no wiring of its own.
 *
 * `onApply` still overrides both, for a surface that wants to handle the activation
 * itself. Both surfaces of AC7 name the identifier — the detail screen from the loaded
 * Job_Description, the list entry from the entry it renders — so the fallback is for a
 * control mounted outside a `:jdId` route by a surface that names no role at all.
 * There, pressing it says so in words rather than doing nothing: a control that
 * silently ignores a click is indistinguishable from a broken one, and a disabled
 * control would be indistinguishable from the closed Job_Description AC7 is about.
 *
 * ## The second condition: profile readiness (Req 9 AC13)
 *
 * Requirement 9 AC13 disables every apply control while the Candidate's profile is
 * `Draft` and presents the unmet conditions as the reason. That rule belongs to the
 * profile slice, which publishes it as the apply gate (`useApplyGate`), so this
 * control reads one verdict rather than re-deriving profile completeness. Outside
 * the gate's provider — a control mounted on its own in a component test — the gate
 * is open and only the Job_Description status decides.
 *
 * The two conditions are independent and both are stated: a closed role and a draft
 * profile are different problems with different remedies, and collapsing them into
 * one message would leave a Candidate fixing the wrong thing.
 *
 * Requirements: 12.7, 9.13.
 */

import { Badge, Button, List, Stack, Text } from '@mantine/core'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'

import type { JdStatus } from '../../api/enums'
// Imported by module rather than through the application slice's barrel: the only
// thing this control needs from it is the dialog, and a barrel import would make the
// two slices' entry points reference each other.
import { ApplyDialog } from '../applications/ApplyDialog'
import { useApplyGate } from '../profiles'

import { applyAvailability, isClosed } from './jobStatus'

/** Namespaces these controls resolve their strings against (Req 19 AC2). */
const NAMESPACES = ['jobs', 'profiles', 'shell'] as const

export interface JobStatusBadgeProps {
  readonly status: JdStatus
}

/**
 * The status indicator of a Job_Description (AC7).
 *
 * Rendered for every status, not only for `Closed`: a badge that only ever
 * appears on closed roles reads as a warning label, while a status that is always
 * stated is information. The `Closed` variant is the one AC7 requires, and it is
 * marked in the accessibility tree as well as by colour — colour alone carries no
 * meaning (Requirement 20 AC1).
 */
export function JobStatusBadge({ status }: JobStatusBadgeProps) {
  const { t } = useTranslation(NAMESPACES)
  const closed = isClosed(status)

  return (
    <Badge
      color={closed ? 'red' : status === 'Open' ? 'green' : 'gray'}
      variant="light"
      data-testid={closed ? 'job-status-closed' : 'job-status'}
      data-status={status}
    >
      {t('jobs:status.label')}
      {': '}
      {t(`jobs:status.${status}`)}
    </Badge>
  )
}

export interface ApplyControlProps {
  readonly status: JdStatus
  /** The role title, for the accessible name of the control. */
  readonly title: string
  /**
   * The Job_Description being applied to (Req 14 AC2). Defaults to the `:jdId` route
   * parameter, which the detail screen carries.
   */
  readonly jdId?: string
  /**
   * Handles the activation instead of opening the apply dialog. For a surface that
   * runs the flow itself; absent, the dialog of Requirement 14 opens.
   */
  readonly onApply?: () => void
  /** Render the reason the control is disabled. Off in a dense list entry. */
  readonly showReason?: boolean
}

/**
 * The apply control of one Job_Description (Req 12 AC7, Req 9 AC13).
 *
 * Disabled — and explained — for every status but `Open`, which is what Req 12 AC7
 * asks for on a `Closed` Job_Description, and disabled again while the apply gate
 * reports the Candidate's profile as a `Draft` (Req 9 AC13). `aria-disabled`
 * accompanies `disabled` so the state is announced rather than only inferred from
 * the control being unreachable, and `aria-describedby` binds the control to
 * whichever reasons are on screen so the explanation is part of its accessible
 * description (Req 20 AC5, AC8).
 *
 * The profile reason is rendered on every surface, dense list included: Req 9 AC13
 * asks for the reason wherever the control is disabled, and a list entry that
 * simply goes grey is the dead control that requirement exists to prevent. The
 * individual unmet conditions are itemized where there is room for them
 * (`showReason`, the detail view); the list entry states the condition and leaves
 * the itemized list to the profile screen it points at.
 */
export function ApplyControl({
  status,
  title,
  jdId,
  onApply,
  showReason = false,
}: ApplyControlProps) {
  const { t } = useTranslation(NAMESPACES)
  const [notice, setNotice] = useState<string | null>(null)
  // Req 14 AC2: which role is being applied to. `useParams` reports `{}` outside a
  // route match, so a control mounted on its own simply has no identifier.
  const routeParams = useParams<{ jdId: string }>()
  const target = (jdId ?? routeParams.jdId ?? '').trim()
  /** Whether the apply dialog of Requirement 14 is open. */
  const [applying, setApplying] = useState(false)
  const availability = applyAvailability(status)
  // Req 9 AC13, published by the profile slice. Open outside its provider.
  const gate = useApplyGate()
  const reasonIdPrefix = useId()

  const enabled = availability.enabled && !gate.blocked
  const statusReasonShown = showReason && availability.reason !== null
  const statusReasonId = `${reasonIdPrefix}-status-reason`
  const profileReasonId = `${reasonIdPrefix}-profile-reason`
  const describedBy = [
    statusReasonShown ? statusReasonId : null,
    gate.blocked ? profileReasonId : null,
  ]
    .filter((id): id is string => id !== null)
    .join(' ')

  return (
    <Stack gap={4} align="flex-start">
      <Button
        type="button"
        disabled={!enabled}
        aria-disabled={!enabled}
        aria-label={t('jobs:apply.actionFor', { title })}
        {...(describedBy === '' ? {} : { 'aria-describedby': describedBy })}
        onClick={() => {
          if (onApply !== undefined) {
            onApply()
            return
          }
          if (target === '') {
            setNotice(t('jobs:apply.unavailable'))
            return
          }
          // Req 14 AC2: the CV_Variant choice and the submission happen in the dialog.
          setNotice(null)
          setApplying(true)
        }}
        data-testid="job-apply"
        data-enabled={enabled ? 'true' : 'false'}
      >
        {t('jobs:apply.action')}
      </Button>
      {statusReasonShown ? (
        <Text id={statusReasonId} size="sm" c="dimmed" data-testid="job-apply-reason">
          {t(`jobs:apply.${availability.reason}`)}
        </Text>
      ) : null}
      {/* Req 9 AC13: the Draft profile is stated as the reason, wherever the control is. */}
      {gate.blocked ? (
        <Stack gap={2} align="flex-start" data-testid="job-apply-profile-reason">
          <Text id={profileReasonId} size="sm" c="dimmed">
            {t('profiles:apply.blockedReason')}
          </Text>
          {showReason && gate.missingFields.length > 0 ? (
            <List size="sm" c="dimmed" data-testid="job-apply-profile-missing">
              {gate.missingFields.map((field) => (
                <List.Item key={field} data-missing-field={field}>
                  {t(`profiles:completeness.field.${field}`)}
                </List.Item>
              ))}
            </List>
          ) : null}
        </Stack>
      ) : null}
      {notice === null ? null : (
        <Text size="sm" c="dimmed" role="status" data-testid="job-apply-notice">
          {notice}
        </Text>
      )}
      {/*
        Mounted only while it is open, so a list of twenty entries carries no cost for
        the nineteen nobody is applying through. Closing it returns focus to the
        control above (Req 20 AC11).
      */}
      {applying ? (
        <ApplyDialog
          jdId={target}
          title={title}
          opened
          onClose={() => {
            setApplying(false)
          }}
        />
      ) : null}
    </Stack>
  )
}
