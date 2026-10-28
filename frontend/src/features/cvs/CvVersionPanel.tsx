/**
 * The version panel of one CV_Variant: the upload control, the version list and
 * the scan poll (Requirement 11 AC8–AC18, AC20).
 *
 * Mounted by `CvVariantScreen` below the variant it belongs to, which is where the
 * `variantId` comes from. The panel itself decides nothing about access: the screen
 * it sits on is in the Candidate guard group.
 *
 * What it owns is the *arrangement*: the upload control first, because uploading is
 * why a Candidate opens a variant, then every version newest-first (AC15). The
 * poll of AC12 is a property of the query rather than of this component — it runs
 * while any listed version is `PendingScan` and stops on the answer that resolves
 * the last one — so all this panel adds is saying that a scan is outstanding, which
 * is what makes the wait legible rather than mysterious.
 *
 * A failed read renders the error state with a retry control (Req 21 AC8) and a
 * zero-version variant renders the empty state naming the destination (AC7),
 * neither of which stops a Candidate from uploading: the upload control stays
 * mounted above both, because an empty list is the most likely moment to need it.
 *
 * Requirements: 11.8, 11.9, 11.10, 11.11, 11.12, 11.13, 11.14, 11.15, 11.16,
 * 11.20, 19.2, 21.6, 21.7, 21.8.
 */

import { Divider, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { EmptyState, ErrorState, LoadingState } from '../../errors/ErrorPresenter'

import { CvVersionRow } from './CvVersionRow'
import { CvVersionUpload } from './CvVersionUpload'
import { useCvVersionsQuery } from './versionQueries'
import { hasPendingScan, orderVersionsForDisplay } from './versionRules'

/** Namespaces the panel resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['cvs', 'shell', 'errors'] as const

export interface CvVersionPanelProps {
  /** The variant whose versions are listed and uploaded to. */
  readonly variantId: string
}

/** Upload, list and poll the versions of one variant. */
export function CvVersionPanel({ variantId }: CvVersionPanelProps) {
  const { t } = useTranslation(NAMESPACES)
  const versions = useCvVersionsQuery(variantId)
  const ordered = orderVersionsForDisplay(versions.data)
  const scanning = hasPendingScan(versions.data)

  return (
    <Stack gap="md" data-testid="cv-version-panel">
      <Divider />

      <Title order={2} size="h4">
        {t('cvs:versions.title')}
      </Title>

      <CvVersionUpload variantId={variantId} />

      <Divider variant="dashed" />

      {/* AC12: the poll is running, and the Candidate can see that it is. */}
      {scanning ? (
        <Stack gap={4} data-testid="cv-version-scan-polling">
          <LoadingState label={t('cvs:versions.scanPolling')} showLabel />
          <Text size="xs" c="dimmed">
            {t('cvs:versions.scanPollingHint')}
          </Text>
        </Stack>
      ) : null}

      {versions.isPending ? (
        <LoadingState label={t('cvs:versions.title')} />
      ) : versions.isError ? (
        <ErrorState
          error={versions.error}
          onRetry={() => {
            void versions.refetch()
          }}
        />
      ) : ordered.length === 0 ? (
        <EmptyState destination={t('cvs:versions.title')} description={t('cvs:versions.emptyHint')} />
      ) : (
        <Stack gap="sm" data-testid="cv-version-list">
          {ordered.map((version) => (
            <CvVersionRow key={version.id} variantId={variantId} version={version} />
          ))}
        </Stack>
      )}
    </Stack>
  )
}
