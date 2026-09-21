/**
 * The per-version download control and the two failures it can report
 * (Requirement 11 AC13, AC14, AC16, AC17, AC18).
 *
 * - **AC16** an `Available` version is requested from the download endpoint and
 *   delivered under its original filename.
 * - **AC13/AC14** a `PendingScan` or `Quarantined` version renders the control
 *   *disabled* with the reason beside it. Disabled rather than absent, because a
 *   control that vanishes tells the Candidate nothing about why — and the version
 *   itself stays in the list either way (AC14).
 * - **AC17** `integrity_violation` goes to the Error_Presenter, which resolves the
 *   catalogue entry stating that an administrator has been alerted. The message is
 *   the catalogue's, so it reads the same wherever an integrity failure surfaces.
 * - **AC18** a transfer that stopped short renders this slice's own
 *   incomplete-download message together with the Support_Reference, because that
 *   outcome has no Backend_Api envelope to map — the request succeeded and the
 *   transfer did not ({@link IncompleteDownloadNotice}).
 *
 * Requirements: 11.13, 11.14, 11.16, 11.17, 11.18, 19.2, 20.7, 20.8, 23.1.
 */

import { Alert, Button, Stack, Text } from '@mantine/core'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorPresenter, LiveAnnouncement } from '../../errors/ErrorPresenter'
import { supportReferenceOf } from '../../errors/errorMessages'
import { SupportReference } from '../../errors/SupportReference'
import { recordFailedSupportReference } from '../../errors/supportReferenceStore'

import { useDownloadCvVersion } from './versionQueries'
import { downloadBlockedReason, isIncompleteDownload, type CvVersion } from './versionRules'

/** Namespaces the control resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['cvs', 'shell', 'errors'] as const

export interface IncompleteDownloadNoticeProps {
  /** The Support_Reference of the response whose body stopped short (AC18). */
  readonly supportReference: string | null
}

/**
 * The incomplete-download surface (AC18).
 *
 * States that the partial file was discarded — which it was: the bytes are never
 * assembled into a file when the declared length is not reached — and carries the
 * Support_Reference (Req 23 AC1). The reference is also retained for the browsing
 * context, so support can trace it from the diagnostics surface (Req 23 AC3).
 *
 * `role="alert"` announces the outcome without moving focus (Req 20 AC7).
 */
export function IncompleteDownloadNotice({ supportReference }: IncompleteDownloadNoticeProps) {
  const { t } = useTranslation(NAMESPACES)

  // Recorded from an effect, so rendering stays free of side effects.
  useEffect(() => {
    recordFailedSupportReference(supportReference)
  }, [supportReference])

  return (
    <Alert
      role="alert"
      variant="light"
      color="red"
      withCloseButton={false}
      title={t('cvs:download.incompleteTitle')}
      data-testid="cv-version-download-incomplete"
    >
      <Stack gap="xs" align="flex-start">
        <Text>{t('cvs:download.incomplete')}</Text>
        <SupportReference reference={supportReference} showHint />
      </Stack>
    </Alert>
  )
}

export interface CvVersionDownloadControlProps {
  /** The variant the version belongs to, which the download path addresses. */
  readonly variantId: string
  readonly version: CvVersion
}

/** Download, or the stated reason it is unavailable (AC13, AC14, AC16). */
export function CvVersionDownloadControl({
  variantId,
  version,
}: CvVersionDownloadControlProps) {
  const { t } = useTranslation(NAMESPACES)
  const download = useDownloadCvVersion()

  const blockedReason = downloadBlockedReason(version)
  const reasonId = `cv-version-${version.id}-download-reason`
  const incomplete = download.isError && isIncompleteDownload(download.error)

  return (
    <Stack gap="xs" align="flex-start">
      <Button
        type="button"
        variant="default"
        size="xs"
        disabled={blockedReason !== null}
        loading={download.isPending}
        {...(blockedReason === null ? {} : { 'aria-describedby': reasonId })}
        aria-label={t('cvs:download.controlLabel', { value: version.version_number })}
        onClick={() => {
          download.mutate({ variantId, version })
        }}
        data-testid={`cv-version-download-${version.version_number}`}
      >
        {t('shell:action.download')}
      </Button>

      {/* AC13/AC14: the refusal is stated, not merely enacted. */}
      {blockedReason === null ? null : (
        <Text
          id={reasonId}
          size="xs"
          c="dimmed"
          data-testid={`cv-version-download-reason-${version.version_number}`}
        >
          {t(`cvs:download.blocked.${blockedReason}`)}
        </Text>
      )}

      {/* AC18 first: a truncated transfer carries no Backend_Api envelope, so the
          catalogue key it would be mapped under does not exist. */}
      {incomplete ? (
        <IncompleteDownloadNotice supportReference={supportReferenceOf(download.error)} />
      ) : download.isError ? (
        // AC17 among them: `integrity_violation` resolves to the catalogue entry
        // naming the alerted administrator.
        <ErrorPresenter error={download.error} title={t('cvs:download.failedTitle')} />
      ) : null}

      {download.isError ? (
        <LiveAnnouncement message={t('cvs:announce.downloadFailed')} assertive />
      ) : download.isSuccess ? (
        <LiveAnnouncement message={t('cvs:announce.downloaded')} />
      ) : null}
    </Stack>
  )
}
