/**
 * The per-variant upload control (Requirement 11 AC8, AC9, AC10, AC11).
 *
 * - **AC8** a file input accepting the two CV media types.
 * - **AC9** a selection over 10 MB is refused with the localized size message and
 *   the submit control stays disabled, so no upload request is issued. The refusal
 *   is the Form_Validator's rule and its message, resolved through the same issue
 *   mapping the variant forms use.
 * - **AC10** the confirmed upload is submitted as multipart form data and its
 *   transferred byte percentage is rendered while it is in flight.
 * - **AC11** the 202 renders the returned version — into the list beside this
 *   control, seeded by the mutation — and the localized scan-pending notice.
 *
 * Two deliberate omissions. The control does not clear the selection on success:
 * the Candidate can see what they just uploaded named beside the outcome, and
 * picking another file replaces it. And it does not disable itself while a version
 * is being scanned — a Candidate may upload again immediately; the scan of the
 * previous version is the Backend_Api's business, not a lock on this form.
 *
 * Requirements: 11.8, 11.9, 11.10, 11.11, 19.2, 19.12, 20.7, 20.8, 22.9.
 */

import { Alert, Button, FileInput, Group, Progress, Stack, Text } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorPresenter, LiveAnnouncement } from '../../errors/ErrorPresenter'
import { formatNumber, formatPercent } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'
import { BidiText } from '../../i18n/DirectionProvider'

import { issueMessages } from './variantMessages'
import { useUploadCvVersion } from './versionQueries'
import {
  canUploadSelection,
  CV_UPLOAD_ACCEPT,
  MAX_UPLOAD_BYTES,
  validateVersionSelection,
} from './versionRules'

/** Namespaces the control resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['cvs', 'shell', 'errors', 'validation'] as const

export interface CvVersionUploadProps {
  /** The variant the new version is uploaded to. */
  readonly variantId: string
}

/** Select a file, submit it, watch it transfer (AC8–AC11). */
export function CvVersionUpload({ variantId }: CvVersionUploadProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const [file, setFile] = useState<File | null>(null)
  const { mutation, progress, reset } = useUploadCvVersion(variantId)

  // AC9: the rules are evaluated on the selection, not on submission, so the
  // refusal is visible before the Candidate reaches for the submit control.
  const issues = file === null ? [] : validateVersionSelection(file)
  const messages = issueMessages(i18n, issues)
  const submittable = canUploadSelection(file) && !mutation.isPending
  const accepted = mutation.data ?? null

  return (
    <Stack gap="sm" data-testid="cv-version-upload">
      <FileInput
        label={t('cvs:upload.field')}
        description={t('cvs:upload.hint', {
          max: formatNumber(MAX_UPLOAD_BYTES, locale),
        })}
        placeholder={t('cvs:upload.placeholder')}
        accept={CV_UPLOAD_ACCEPT}
        value={file}
        clearable
        // Both refusals of AC8/AC9 render as the input's own error, so they are
        // announced with the field rather than as a detached notice.
        error={messages.length === 0 ? null : messages.join(' ')}
        onChange={(selected) => {
          setFile(selected)
          reset()
        }}
        data-testid="cv-version-file"
      />

      <Group gap="sm">
        <Button
          type="button"
          disabled={!submittable}
          loading={mutation.isPending}
          onClick={() => {
            if (file !== null && canUploadSelection(file)) {
              mutation.mutate(file)
            }
          }}
          data-testid="cv-version-upload-submit"
        >
          {t('cvs:upload.submit')}
        </Button>
        {file === null ? null : (
          <Text size="sm" c="dimmed" data-testid="cv-version-selected">
            <BidiText value={file.name} />
          </Text>
        )}
      </Group>

      {/* AC10: the transferred byte percentage, while the request is in flight. */}
      {progress === null || !mutation.isPending ? null : (
        <Stack gap={4} data-testid="cv-version-upload-progress">
          <Progress
            value={progress.percentage}
            role="progressbar"
            aria-valuenow={progress.percentage}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('cvs:upload.progressLabel')}
          />
          <Text size="xs" c="dimmed" data-testid="cv-version-upload-progress-text">
            {t('cvs:upload.progress', {
              percentage: formatPercent(progress.percentage / 100, locale),
              transferred: formatNumber(progress.transferredBytes, locale),
              total: formatNumber(progress.totalBytes, locale),
            })}
          </Text>
        </Stack>
      )}

      {/* AC11: the 202 and its scan-pending notice. The version itself is rendered
          by the list beside this control, which the mutation seeded. */}
      {accepted === null ? null : (
        <Alert
          role="status"
          variant="light"
          color="blue"
          withCloseButton={false}
          title={t('cvs:upload.acceptedTitle')}
          data-testid="cv-version-upload-accepted"
        >
          <Stack gap={4} align="flex-start">
            <Text>{t('cvs:upload.scanPending')}</Text>
            <Text size="sm" c="dimmed" data-testid="cv-version-upload-accepted-version">
              {t('cvs:versions.number', {
                value: formatNumber(accepted.version.version_number, locale),
              })}
              {' · '}
              {t(`cvs:versionState.${accepted.version.state}`, {
                defaultValue: accepted.version.state,
              })}
            </Text>
          </Stack>
        </Alert>
      )}

      {mutation.isError ? <ErrorPresenter error={mutation.error} title={t('cvs:upload.failedTitle')} /> : null}

      <LiveAnnouncement
        message={
          mutation.isError
            ? t('cvs:announce.uploadFailed')
            : accepted === null
              ? null
              : t('cvs:announce.uploadAccepted')
        }
        assertive={mutation.isError}
      />
    </Stack>
  )
}
