/**
 * The Excel export control and its polling surface (Requirement 18 AC6–AC10).
 *
 * - **AC6** an entity control offering `candidates`, `job_descriptions` and
 *   `applications`, and an export control that posts to
 *   `POST /api/v1/admin/exports/{entity_type}` with the currently applied
 *   date-range and Job_Description filters. The filters arrive as a prop from the
 *   screen's address bar, so "currently applied" means the same thing here as it
 *   does for the report on screen.
 * - **AC7** the 202's `job_id` is retained in component state and polled at most
 *   every 5 seconds until the status is terminal, or until the user dismisses the
 *   export — dismissal drops the identifier, which is what stops the poll.
 * - **AC8** a ready job with a populated `download_url` renders a download
 *   control and the `expires_at` value.
 * - **AC9** a failed job renders the server's `error_message` together with the
 *   Support_Reference of the response that reported it.
 * - **AC10** a progress indicator while polling, inside a panel that blocks
 *   nothing: the reports around it stay readable, refetchable and filterable
 *   because the poll is a background cache entry rather than a wait.
 *
 * ## Why the failure surface is built here rather than handed to ErrorPresenter
 *
 * A failed export arrives as a **200** whose body reports `status: "failed"`. It
 * is not an Error_Envelope, so it has no `error` key to map to a catalogue entry —
 * the mapping the Error_Presenter exists to perform (Requirement 21 AC1) — and
 * AC9 asks specifically for the server's own `error_message`. This panel therefore
 * renders the Error_Presenter's *pieces*: the alert surface, the
 * {@link SupportReference} control, and the same retained-reference recording the
 * presenter performs, so support can trace the failure from the recovery boundary
 * and the diagnostics screen. A transport failure of the poll itself — a real
 * Error_Envelope — still goes to {@link ErrorState}, which is where it belongs.
 *
 * Requirements: 18.6, 18.7, 18.8, 18.9, 18.10, 19.2, 19.10, 19.12, 20.7, 20.8.
 */

import { Alert, Anchor, Button, Fieldset, Group, Select, Stack, Text } from '@mantine/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorPresenter, ErrorState, LiveAnnouncement, LoadingState } from '../../errors/ErrorPresenter'
import { SupportReference } from '../../errors/SupportReference'
import { recordFailedSupportReference } from '../../errors/supportReferenceStore'
import { BidiText } from '../../i18n/DirectionProvider'
import { formatDateTime } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'

import {
  EXPORT_ENTITY_TYPES,
  exportDownload,
  exportErrorMessage,
  exportJobId,
  isExportFailed,
  isExportPolling,
  type ExportEntityType,
} from './exportPolling'
import { useExportStatusQuery, useRequestExport } from './reportQueries'
import type { ReportFilters } from './reportFilters'

/** Namespaces the panel resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['reports', 'shell'] as const

/** The entity the control starts on. */
const DEFAULT_ENTITY_TYPE: ExportEntityType = 'candidates'

export interface ExportFailureNoticeProps {
  /** The server's `error_message`, or `null` when the job named none (AC9). */
  readonly message: string | null
  /** The Support_Reference of the response that reported the failure (AC9). */
  readonly supportReference: string | null
}

/**
 * The failure surface of a failed export job (AC9).
 *
 * Renders the server message verbatim through `BidiText` — it is Backend_Api text
 * and may be Arabic or Hebrew (Req 19 AC10) — and the Support_Reference beside it.
 * A job that reported failure without a message falls back to a localized
 * statement, so the surface is never a bare reference with no explanation.
 *
 * `role="alert"` announces the outcome without moving focus (Req 20 AC7).
 */
export function ExportFailureNotice({ message, supportReference }: ExportFailureNoticeProps) {
  const { t } = useTranslation(NAMESPACES)

  // Recorded from an effect, so rendering stays free of side effects. Keeps the
  // reference traceable from the recovery boundary (Req 23 AC3).
  useEffect(() => {
    recordFailedSupportReference(supportReference)
  }, [supportReference])

  return (
    <Alert
      role="alert"
      variant="light"
      color="red"
      withCloseButton={false}
      title={t('reports:export.failedTitle')}
      data-testid="export-failed"
    >
      <Stack gap="xs" align="flex-start">
        <Text data-testid="export-error-message">
          {message === null ? (
            t('reports:export.failedWithoutMessage')
          ) : (
            <BidiText value={message} />
          )}
        </Text>
        <SupportReference reference={supportReference} showHint />
      </Stack>
    </Alert>
  )
}

export interface ExportPanelProps {
  /** The date-range and Job_Description filters the export is bounded by (AC6). */
  readonly filters: ReportFilters
}

/** The export control and its polling surface (AC6–AC10). */
export function ExportPanel({ filters }: ExportPanelProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)

  const [entityType, setEntityType] = useState<ExportEntityType>(DEFAULT_ENTITY_TYPE)
  /**
   * The `job_id` of the export being followed (AC7).
   *
   * Component state rather than a URL parameter or a cache entry: a job is a
   * transient piece of work belonging to this visit, and the poll stops the moment
   * this is cleared — which is exactly what AC7's "or the user dismisses the
   * export" asks for.
   */
  const [jobId, setJobId] = useState<string | null>(null)

  const enqueue = useRequestExport()
  const poll = useExportStatusQuery(jobId)

  const job = poll.data?.job ?? null
  const supportReference = poll.data?.supportReference ?? null
  const download = exportDownload(job)
  const failed = isExportFailed(job)
  /**
   * A `ready` job whose `download_url` never arrived, or arrived unusable.
   *
   * AC8 makes the download control conditional on a populated URL, so this is
   * neither a download nor a failure: it is a ready job with nothing to open yet,
   * and the honest answer is to say so and offer a re-read.
   */
  const readyWithoutUrl = job?.status === 'ready' && !download.ready
  /**
   * AC10: the indicator covers both legs of the wait — the enqueue request and
   * every interval until a terminal status arrives. A failed poll stops it, because
   * the error state has taken over the surface.
   */
  const polling =
    enqueue.isPending || (jobId !== null && !poll.isError && (job === null || isExportPolling(job)))

  const requestExportNow = () => {
    enqueue.mutate(
      { entityType, filters },
      {
        onSuccess: (enqueued) => {
          setJobId(exportJobId(enqueued.job))
        },
      },
    )
  }

  /** Stops following the export (AC7). */
  const dismiss = () => {
    setJobId(null)
    enqueue.reset()
  }

  return (
    <Fieldset legend={t('reports:export.legend')} data-testid="export-panel">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          {t('reports:export.description')}
        </Text>

        <Select
          label={t('reports:export.entityType')}
          data={EXPORT_ENTITY_TYPES.values.map((value) => ({
            value,
            label: t(`reports:entityType.${value}`),
          }))}
          value={entityType}
          allowDeselect={false}
          comboboxProps={{ withinPortal: false }}
          onChange={(value) => {
            if (EXPORT_ENTITY_TYPES.includes(value)) {
              setEntityType(value)
            }
          }}
          data-testid="export-entity-type"
        />

        <Group gap="sm">
          <Button
            type="button"
            onClick={requestExportNow}
            loading={enqueue.isPending}
            data-testid="export-request"
          >
            {t('reports:export.request')}
          </Button>
          {jobId === null && !enqueue.isError ? null : (
            <Button type="button" variant="default" onClick={dismiss} data-testid="export-dismiss">
              {t('reports:export.dismiss')}
            </Button>
          )}
        </Group>

        {/* The enqueue request itself failed: a real Error_Envelope, so the
            Error_Presenter maps it and renders its Support_Reference. */}
        {enqueue.isError ? (
          <>
            <ErrorPresenter error={enqueue.error} title={t('reports:export.requestFailedTitle')} />
            <LiveAnnouncement message={t('reports:announce.exportRequestFailed')} assertive />
          </>
        ) : null}

        {/* A 202 without a usable `job_id`: nothing to poll, so say so rather than
            leaving a silent panel. */}
        {enqueue.isSuccess && jobId === null ? (
          <Text size="sm" c="red" role="alert" data-testid="export-no-job-id">
            {t('reports:export.noJobId')}
          </Text>
        ) : null}

        {/* The poll request failed. The job may still be running, so the retry
            control re-asks rather than re-enqueuing (which would create a second
            export). */}
        {poll.isError ? (
          <ErrorState
            error={poll.error}
            title={t('reports:export.pollFailedTitle')}
            onRetry={() => {
              void poll.refetch()
            }}
          />
        ) : null}

        {polling ? (
          <>
            <Stack gap={4} data-testid="export-polling">
              <LoadingState label={t('reports:export.polling')} showLabel />
              {job === null ? null : (
                <Text size="sm" c="dimmed" data-testid="export-status">
                  {t('reports:export.statusLine', {
                    status: t(`reports:status.${job.status}`, { defaultValue: job.status }),
                  })}
                </Text>
              )}
            </Stack>
            <LiveAnnouncement message={t('reports:announce.exportPolling')} />
          </>
        ) : null}

        {/* AC8: ready with a usable URL → the download control and `expires_at`. */}
        {download.ready ? (
          <>
            <Stack gap={4} data-testid="export-ready">
              <Anchor
                href={download.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('reports:export.downloadFor', {
                  entity: t(`reports:entityType.${entityType}`),
                })}
                data-testid="export-download"
              >
                {t('shell:action.download')}
              </Anchor>
              <Text size="sm" c="dimmed" data-testid="export-expires-at">
                {download.expiresAt === null
                  ? t('reports:export.noExpiry')
                  : t('reports:export.expiresAt', {
                      value: formatDateTime(download.expiresAt, locale),
                    })}
              </Text>
            </Stack>
            <LiveAnnouncement message={t('reports:announce.exportReady')} />
          </>
        ) : null}

        {readyWithoutUrl ? (
          <Stack gap={4} align="flex-start" data-testid="export-ready-without-url">
            <Text size="sm">{t('reports:export.readyWithoutUrl')}</Text>
            <Button
              type="button"
              variant="default"
              onClick={() => {
                void poll.refetch()
              }}
              data-testid="export-recheck"
            >
              {t('shell:action.retry')}
            </Button>
          </Stack>
        ) : null}

        {/* AC9: failed → the server's message and the Support_Reference. */}
        {failed ? (
          <>
            <ExportFailureNotice
              message={exportErrorMessage(job)}
              supportReference={supportReference}
            />
            <LiveAnnouncement message={t('reports:announce.exportFailed')} assertive />
          </>
        ) : null}
      </Stack>
    </Fieldset>
  )
}
