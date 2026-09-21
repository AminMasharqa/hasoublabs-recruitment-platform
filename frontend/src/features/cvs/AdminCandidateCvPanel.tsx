/**
 * The Admin view of any Candidate's CVs (Requirement 11 AC19).
 *
 * AC19 asks for two things: the Candidate's CV_Variants from
 * `GET /admin/candidates/{candidate_id}/cv-variants`, and a download control per
 * CV_Version calling the Admin download path. This panel is both, and nothing else
 * — no create, no edit, no archive, no primary designation and, as everywhere in
 * this slice, no per-version delete (AC20). An Admin reads a Candidate's CVs; they
 * do not curate them.
 *
 * ## Why the version numbers are derived rather than read
 *
 * The Admin endpoint set carries a variant listing and a per-version download but
 * **no** version listing, so the only thing this panel learns about a variant's
 * versions is the `version_count` the variant DTO reports. Version numbers are
 * assigned from 1 upward per variant, so the addressable set is `1..version_count`
 * ({@link adminVersionNumbers}), rendered newest-first to match AC15's ordering.
 *
 * Two consequences are stated in the interface rather than hidden: an Admin sees no
 * scan state, filename or size per version — the listing carries none — and the
 * download of a version the scan quarantined is refused by the Backend_Api rather
 * than by a disabled control here. That refusal surfaces through the
 * Error_Presenter like any other, so this panel needs no state rules of its own.
 *
 * The panel takes the Candidate's account identifier as a prop rather than reading
 * a path parameter, so the Admin screen that mounts it decides how it is addressed.
 *
 * Requirements: 11.19, 11.20, 19.2, 19.10, 21.6, 21.7, 21.8.
 */

import { Button, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { EmptyState, ErrorPresenter, ErrorState, LoadingState } from '../../errors/ErrorPresenter'
import { BidiText } from '../../i18n/DirectionProvider'
import { formatNumber } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'

import { orderVariantsForDisplay, type CvVariant } from './variantRules'
import { useAdminCvVariantsQuery, useAdminDownloadCvVersion } from './versionQueries'
import { adminVersionNumbers } from './versionRules'

/** Namespaces the panel resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['cvs', 'shell', 'errors'] as const

interface AdminVariantCardProps {
  readonly candidateId: string
  readonly variant: CvVariant
}

/** One variant, with a download control per addressable version (AC19). */
function AdminVariantCard({ candidateId, variant }: AdminVariantCardProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const download = useAdminDownloadCvVersion()
  const versionNumbers = adminVersionNumbers(variant.version_count)

  return (
    <Paper withBorder p="sm" data-testid={`admin-cv-variant-${variant.id}`}>
      <Stack gap="xs">
        <Group gap="xs" justify="space-between" wrap="wrap">
          <Text fw={500}>
            <BidiText value={variant.name} />
          </Text>
          <Text size="sm" c="dimmed">
            {t('cvs:versions.count', { value: formatNumber(variant.version_count, locale) })}
          </Text>
        </Group>

        {versionNumbers.length === 0 ? (
          <Text size="sm" c="dimmed" data-testid={`admin-cv-no-versions-${variant.id}`}>
            {t('cvs:admin.noVersions')}
          </Text>
        ) : (
          <Group gap="xs" wrap="wrap">
            {versionNumbers.map((versionNumber) => (
              <Button
                key={versionNumber}
                type="button"
                variant="default"
                size="xs"
                loading={download.isPending && download.variables?.versionNumber === versionNumber}
                aria-label={t('cvs:download.controlLabel', { value: versionNumber })}
                onClick={() => {
                  download.mutate({
                    candidateId,
                    variantId: variant.id,
                    versionNumber,
                    filename: `${variant.name}-v${versionNumber}`,
                  })
                }}
                data-testid={`admin-cv-download-${variant.id}-${versionNumber}`}
              >
                {t('cvs:versions.number', { value: formatNumber(versionNumber, locale) })}
              </Button>
            ))}
          </Group>
        )}

        {download.isError ? (
          <ErrorPresenter error={download.error} title={t('cvs:download.failedTitle')} />
        ) : null}
      </Stack>
    </Paper>
  )
}

export interface AdminCandidateCvPanelProps {
  /** The account identifier of the Candidate whose CVs are read (AC19). */
  readonly candidateId: string
}

/** Every CV_Variant of one Candidate, with a download control per version (AC19). */
export function AdminCandidateCvPanel({ candidateId }: AdminCandidateCvPanelProps) {
  const { t } = useTranslation(NAMESPACES)
  const variants = useAdminCvVariantsQuery(candidateId)
  const ordered = orderVariantsForDisplay(variants.data)

  return (
    <Stack gap="sm" data-testid="admin-candidate-cv-panel">
      <Title order={2} size="h4">
        {t('cvs:admin.title')}
      </Title>

      {variants.isPending ? (
        <LoadingState label={t('cvs:admin.title')} />
      ) : variants.isError ? (
        <ErrorState
          error={variants.error}
          onRetry={() => {
            void variants.refetch()
          }}
        />
      ) : ordered.length === 0 ? (
        <EmptyState destination={t('cvs:admin.title')} />
      ) : (
        <Stack gap="sm">
          {ordered.map((variant) => (
            <AdminVariantCard key={variant.id} candidateId={candidateId} variant={variant} />
          ))}
        </Stack>
      )}
    </Stack>
  )
}
