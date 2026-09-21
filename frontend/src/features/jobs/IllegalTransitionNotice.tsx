/**
 * The `illegal_transition` surface of Requirement 13 AC18.
 *
 * AC18 asks for two things from one envelope: a localized message naming the
 * reported `details.from` and `details.to`, and a refresh of the displayed
 * Job_Description from the Backend_Api. Both are here, in one component, because
 * they are one reaction to one failure — a lifecycle refusal means the client's
 * picture of the status is stale, so stating the refusal and re-reading the resource
 * cannot sensibly happen in different places.
 *
 * Deliberately *not* an error surface: the failure itself is already rendered by
 * whichever component owns the request — the Error_Presenter's catalogue entry plus
 * its Support_Reference (Requirement 21 AC1, Requirement 23 AC1). This adds only the
 * machine context AC18 names, so mounting it next to an `ErrorPresenter` does not
 * duplicate the message.
 *
 * A member the envelope omitted renders as the localized "unknown" state rather than
 * a fabricated status name: misreporting which transition was refused would be worse
 * than admitting the envelope was incomplete.
 *
 * Requirements: 13.18, 19.2, 20.7.
 */

import { Text } from '@mantine/core'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { useRefreshJob } from './authoringQueries'
import { illegalTransitionOf } from './authoringRules'

/** Namespaces this notice resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['jobs', 'shell'] as const

export interface IllegalTransitionNoticeProps {
  /** The Job_Description whose mutation was refused, and which is refetched. */
  readonly jdId: string
  /** The failure of that mutation; anything but an `illegal_transition` renders nothing. */
  readonly error: unknown
}

/** Names the refused transition and refreshes the Job_Description (AC18). */
export function IllegalTransitionNotice({ jdId, error }: IllegalTransitionNoticeProps) {
  const { t } = useTranslation(NAMESPACES)
  const refreshJob = useRefreshJob()
  const transition = illegalTransitionOf(error)

  // The refresh runs from an effect rather than during render, so rendering stays
  // free of side effects; the dependency is the reported pair, so a re-render with
  // the same refusal does not re-read.
  const from = transition?.from ?? null
  const to = transition?.to ?? null
  const refused = transition !== null

  useEffect(() => {
    if (refused) {
      refreshJob(jdId)
    }
  }, [refused, from, to, jdId, refreshJob])

  if (!refused) {
    return null
  }

  const unknown = t('jobs:lifecycle.unknownState')

  return (
    <Text size="sm" c="red" role="alert" data-testid="job-illegal-transition">
      {t('jobs:lifecycle.illegalTransition', { from: from ?? unknown, to: to ?? unknown })}
    </Text>
  )
}
