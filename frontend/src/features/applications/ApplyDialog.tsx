/**
 * The apply dialog: everything that happens after the apply control is activated
 * (Requirement 14 AC2–AC8).
 *
 * - **AC2** a CV_Variant selection defaulting to the primary variant, submitted to
 *   `POST /jobs/{jd_id}/apply` with the selected identifier.
 * - **AC3** a 201 renders the confirmation, carrying the returned status and
 *   submission timestamp.
 * - **AC4/AC5** a 200 with a `redirect_url` renders a control that opens the address
 *   in a new browsing context and states that no in-platform Application was
 *   recorded. The address is never navigated to on the client's own initiative:
 *   the control is an anchor the user activates, and no code here calls
 *   `window.open` or assigns `location`.
 * - **AC6** every entry of `details.unmet` is rendered as its own condition.
 * - **AC7** `conflicting_state` says an application for this role already exists.
 * - **AC8** `rate_limited` names `details.retry_after_seconds`.
 *
 * Which of the three refusals a failure is, and what machine context it carries, is
 * `applicationRules.ts`; every other failure — a denial, a timeout, a 422 — falls to
 * the Error_Presenter, which renders the shared catalogue entry and the
 * Support_Reference (Requirement 21 AC1, AC2, Requirement 23 AC1).
 *
 * ## Why the dialog and not a second screen
 *
 * AC1 asks for a *single* apply control on the loaded Job_Description whatever its
 * Application_Channel, and AC2 hangs the CV_Variant choice off activating it. A modal
 * keeps the role on screen behind the choice, and Mantine's `Modal` confines focus
 * while it is open and restores it to the control that opened it on close
 * (Requirement 20 AC11).
 *
 * The channel deliberately changes nothing about this component: the Backend_Api
 * decides whether the submission records an Application or answers with an external
 * address, and the two outcomes differ only in what the dialog renders afterwards.
 *
 * Requirements: 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 19.2, 19.10, 19.12, 20.7, 20.11, 21.1, 21.2, 21.6.
 */

import { Alert, Anchor, Button, Group, List, Modal, Select, Stack, Text } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { ErrorPresenter, LiveAnnouncement, LoadingState } from '../../errors/ErrorPresenter'
import { BidiText } from '../../i18n/DirectionProvider'
import { formatDateTime, formatNumber } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'
import { ROUTE_PATHS } from '../../routing/paths'
import { useCvVariantsQuery } from '../cvs/variantQueries'

import { applicationStatusLabel, unmetConditionTexts } from './applicationMessages'
import { useSubmitApplication } from './applicationQueries'
import {
  applyRefusal,
  retryAfterSeconds,
  unmetConditions,
  type Application,
} from './applicationRules'
import { resolveVariantSelection, variantChoices } from './variantChoice'

/** Namespaces this dialog resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['applications', 'cvs', 'shell', 'errors'] as const

export interface ApplyDialogProps {
  /** The Job_Description being applied to. */
  readonly jdId: string
  /** Its role title, rendered in the dialog heading. */
  readonly title: string
  /** Whether the dialog is open. */
  readonly opened: boolean
  /** Closes the dialog. Focus returns to the control that opened it. */
  readonly onClose: () => void
}

interface RecordedNoticeProps {
  readonly application: Application
}

/** The submission confirmation of AC3: the returned status and timestamp. */
function RecordedNotice({ application }: RecordedNoticeProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)

  return (
    <Alert
      role="status"
      variant="light"
      color="green"
      title={t('applications:apply.recorded.title')}
      withCloseButton={false}
      data-testid="apply-recorded"
    >
      <Stack gap={4} align="flex-start">
        <Text size="sm" data-testid="apply-recorded-status">
          {t('applications:apply.recorded.status')}
          {': '}
          {applicationStatusLabel(i18n, application.status)}
        </Text>
        <Text size="sm" data-testid="apply-recorded-submitted-at">
          {t('applications:apply.recorded.submittedAt')}
          {': '}
          {formatDateTime(application.submitted_at, locale)}
        </Text>
        <Anchor
          component={Link}
          to={ROUTE_PATHS.candidateApplications}
          size="sm"
          data-testid="apply-recorded-link"
        >
          {t('applications:apply.recorded.link')}
        </Anchor>
      </Stack>
    </Alert>
  )
}

interface ExternalNoticeProps {
  readonly redirectUrl: string
}

/**
 * The external-destination surface of AC4 and AC5.
 *
 * States that no Application was recorded *before* offering the control, and the
 * control is a plain anchor: activating it is the explicit user action AC5 requires,
 * and nothing opens the address without one. `rel="noreferrer noopener"` keeps the
 * opened context from reaching back into this one.
 */
function ExternalNotice({ redirectUrl }: ExternalNoticeProps) {
  const { t } = useTranslation(NAMESPACES)

  return (
    <Alert
      role="status"
      variant="light"
      color="blue"
      title={t('applications:apply.external.title')}
      withCloseButton={false}
      data-testid="apply-external"
    >
      <Stack gap="xs" align="flex-start">
        {/* AC4: no in-platform Application was recorded, said in words. */}
        <Text size="sm" data-testid="apply-external-not-recorded">
          {t('applications:apply.external.notRecorded')}
        </Text>
        <Anchor
          href={redirectUrl}
          target="_blank"
          rel="noreferrer noopener"
          data-testid="apply-external-open"
        >
          {t('applications:apply.external.open')}
        </Anchor>
        <Text size="xs" c="dimmed">
          {t('applications:apply.external.opensInNewTab')}
        </Text>
      </Stack>
    </Alert>
  )
}

interface RefusalNoticeProps {
  readonly error: unknown
}

/**
 * The three refusals Requirement 14 names (AC6, AC7, AC8), and the Error_Presenter
 * for everything else.
 *
 * Each named refusal renders its own localized sentence instead of the generic
 * `errors` entry, because each one tells the Candidate something different to do:
 * complete the listed conditions, stop resubmitting, or wait the stated number of
 * seconds.
 */
function RefusalNotice({ error }: RefusalNoticeProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const refusal = applyRefusal(error)

  if (refusal === 'precondition_unmet') {
    // AC6: every reported entry, each as its own condition.
    const conditions = unmetConditionTexts(i18n, unmetConditions(error))
    return (
      <Alert
        role="alert"
        variant="light"
        color="orange"
        title={t('applications:apply.unmet.title')}
        withCloseButton={false}
        data-testid="apply-precondition-unmet"
      >
        {conditions.length === 0 ? (
          <Text size="sm">{t('applications:apply.unmet.none')}</Text>
        ) : (
          <List size="sm" data-testid="apply-unmet-list">
            {conditions.map((condition, index) => (
              <List.Item key={`${index}-${condition}`} data-testid="apply-unmet-condition">
                {condition}
              </List.Item>
            ))}
          </List>
        )}
      </Alert>
    )
  }

  if (refusal === 'conflicting_state') {
    // AC7.
    return (
      <Alert
        role="alert"
        variant="light"
        color="orange"
        withCloseButton={false}
        data-testid="apply-conflicting-state"
      >
        <Text size="sm">{t('applications:apply.conflict')}</Text>
      </Alert>
    )
  }

  if (refusal === 'rate_limited') {
    // AC8: the message names `details.retry_after_seconds` when the envelope carried
    // one; an envelope that named none still gets a sentence rather than "undefined".
    const seconds = retryAfterSeconds(error)
    return (
      <Alert
        role="alert"
        variant="light"
        color="orange"
        withCloseButton={false}
        data-testid="apply-rate-limited"
      >
        <Text size="sm">
          {seconds === null
            ? t('applications:apply.rateLimitedUnknown')
            : t('applications:apply.rateLimited', { seconds: formatNumber(seconds, locale) })}
        </Text>
      </Alert>
    )
  }

  return <ErrorPresenter error={error} />
}

/** The apply dialog (AC2–AC8). */
export function ApplyDialog({ jdId, title, opened, onClose }: ApplyDialogProps) {
  const { t } = useTranslation(NAMESPACES)
  const variants = useCvVariantsQuery()
  const submit = useSubmitApplication()

  /** The chosen CV_Variant; `null` until the list settles, then the primary one (AC2). */
  const [selected, setSelected] = useState<string | null>(null)

  const choices = variantChoices(variants.data)
  // AC2: the effective selection is the primary variant until the Candidate changes
  // it. Derived rather than written into state by an effect, so the default cannot
  // briefly disagree with the loaded list.
  const effective = resolveVariantSelection(variants.data, selected)
  const outcome = submit.data ?? null

  const close = (): void => {
    submit.reset()
    setSelected(null)
    onClose()
  }

  return (
    <Modal
      opened={opened}
      onClose={close}
      title={t('applications:apply.title', { title })}
      closeButtonProps={{ 'aria-label': t('shell:action.close') }}
    >
      <Stack gap="sm" data-testid="apply-dialog" data-jd={jdId}>
        <Text size="sm" c="dimmed">
          <BidiText value={title} />
        </Text>

        {outcome === null ? (
          <>
            <Text size="sm">{t('applications:apply.description')}</Text>

            {variants.isPending ? (
              <LoadingState label={t('applications:apply.variantsLoading')} showLabel />
            ) : variants.isError ? (
              <ErrorPresenter
                error={variants.error}
                onRetry={() => {
                  void variants.refetch()
                }}
              />
            ) : choices.length === 0 ? (
              <Stack gap="xs" align="flex-start">
                <Text size="sm" role="status" data-testid="apply-no-variants">
                  {t('applications:apply.noVariants')}
                </Text>
                <Anchor
                  component={Link}
                  to={ROUTE_PATHS.candidateCvs}
                  size="sm"
                  data-testid="apply-cvs-link"
                >
                  {t('applications:apply.cvsLink')}
                </Anchor>
              </Stack>
            ) : (
              // AC2: the selection, defaulting to the primary variant.
              <Select
                label={t('applications:apply.variantLabel')}
                description={t('applications:apply.variantHint')}
                data={choices.map((choice) => ({
                  value: choice.id,
                  label: choice.isPrimary
                    ? t('applications:apply.primaryOption', { name: choice.name })
                    : choice.name,
                }))}
                value={effective}
                onChange={(value) => setSelected(value)}
                allowDeselect={false}
                disabled={submit.isPending}
                data-testid="apply-variant-select"
              />
            )}

            {submit.error == null ? null : <RefusalNotice error={submit.error} />}

            <Group gap="sm">
              <Button
                type="button"
                loading={submit.isPending}
                disabled={choices.length === 0 && !variants.isPending}
                onClick={() => {
                  submit.reset()
                  submit.mutate({ jdId, cvVariantId: effective })
                }}
                data-testid="apply-submit"
              >
                {t('applications:apply.submit')}
              </Button>
              <Button
                type="button"
                variant="default"
                disabled={submit.isPending}
                onClick={close}
                data-testid="apply-cancel"
              >
                {t('shell:action.cancel')}
              </Button>
            </Group>
          </>
        ) : (
          <>
            {outcome.kind === 'recorded' ? (
              <RecordedNotice application={outcome.application} />
            ) : outcome.kind === 'external' ? (
              <ExternalNotice redirectUrl={outcome.redirectUrl} />
            ) : (
              <Alert
                role="alert"
                variant="light"
                color="yellow"
                withCloseButton={false}
                data-testid="apply-unreadable"
              >
                <Text size="sm">{t('applications:apply.unreadable')}</Text>
              </Alert>
            )}

            <Group gap="sm">
              <Button type="button" onClick={close} data-testid="apply-done">
                {t('shell:action.close')}
              </Button>
            </Group>
          </>
        )}

        {/* Req 20 AC7: the outcome is announced without moving focus. */}
        <LiveAnnouncement
          message={
            outcome === null
              ? null
              : outcome.kind === 'recorded'
                ? t('applications:announce.applied')
                : outcome.kind === 'external'
                  ? t('applications:announce.external')
                  : t('applications:announce.unreadable')
          }
        />
      </Stack>
    </Modal>
  )
}
