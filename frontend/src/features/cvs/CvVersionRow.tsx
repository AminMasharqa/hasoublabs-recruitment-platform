/**
 * One CV_Version as the list renders it (Requirement 11 AC14, AC15, AC20).
 *
 * AC15 fixes what is shown: the version number, the state, the original filename,
 * the size in bytes and the creation timestamp. AC14 adds the quarantine
 * indicator, and is also satisfied by what this row does *not* do — a quarantined
 * version is rendered like any other, because removing it from the list would lose
 * the record of something the Candidate uploaded.
 *
 * AC20 is satisfied the same way: there is no delete control here, and none can be
 * added by configuration — the row takes no action props, and the endpoint set
 * carries no per-version delete for one to call.
 *
 * The filename is Backend_Api text and goes through `BidiText`, so an Arabic or
 * Hebrew filename renders byte-identically and stays bidi-isolated from the Latin
 * metadata beside it (Req 19 AC10). The size and the timestamp are formatted for
 * the active Locale, with the timestamp's authoritative value still UTC
 * (Req 19 AC12).
 *
 * Requirements: 11.13, 11.14, 11.15, 11.16, 11.20, 19.2, 19.10, 19.12.
 */

import { Badge, Group, Paper, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { BidiText } from '../../i18n/DirectionProvider'
import { formatDateTime, formatNumber } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'

import { CvVersionDownloadControl } from './CvVersionDownloadControl'
import { isPendingScan, isQuarantined, type CvVersion } from './versionRules'

/** Namespaces the row resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['cvs', 'shell'] as const

/** Badge colour per state. Colour is never the only cue — the label states it too. */
const STATE_COLOURS: Readonly<Record<string, string>> = {
  PendingScan: 'yellow',
  Available: 'green',
  Quarantined: 'red',
}

export interface CvVersionRowProps {
  /** The variant the version belongs to, which its download path addresses. */
  readonly variantId: string
  readonly version: CvVersion
}

/** One version row: its facts, its state and its download control. */
export function CvVersionRow({ variantId, version }: CvVersionRowProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)

  return (
    <Paper withBorder p="sm" data-testid={`cv-version-${version.version_number}`}>
      <Stack gap="xs">
        <Group gap="xs" justify="space-between" wrap="wrap">
          <Text fw={500} data-testid={`cv-version-number-${version.version_number}`}>
            {t('cvs:versions.number', {
              value: formatNumber(version.version_number, locale),
            })}
          </Text>
          <Group gap="xs">
            <Badge
              color={STATE_COLOURS[version.state] ?? 'gray'}
              variant="light"
              data-testid={`cv-version-state-${version.version_number}`}
            >
              {t(`cvs:versionState.${version.state}`, { defaultValue: version.state })}
            </Badge>
            {/* AC14: the quarantine is named in words, not only in a colour. */}
            {isQuarantined(version) ? (
              <Badge
                color="red"
                data-testid={`cv-version-quarantined-${version.version_number}`}
              >
                {t('cvs:versions.quarantined')}
              </Badge>
            ) : null}
          </Group>
        </Group>

        <Text size="sm" data-testid={`cv-version-filename-${version.version_number}`}>
          <BidiText value={version.original_filename} />
        </Text>

        <Group gap="md">
          <Text size="sm" c="dimmed" data-testid={`cv-version-size-${version.version_number}`}>
            {t('cvs:versions.sizeBytes', { value: formatNumber(version.size_bytes, locale) })}
          </Text>
          <Text size="sm" c="dimmed" data-testid={`cv-version-created-${version.version_number}`}>
            {t('cvs:created', { value: formatDateTime(version.created_at, locale) })}
          </Text>
        </Group>

        {/* AC12: while this version is pending, the list around it is being
            re-read; saying so is what makes the wait legible. */}
        {isPendingScan(version) ? (
          <Text size="xs" c="dimmed" data-testid={`cv-version-pending-${version.version_number}`}>
            {t('cvs:versions.scanPending')}
          </Text>
        ) : null}

        <CvVersionDownloadControl variantId={variantId} version={version} />
      </Stack>
    </Paper>
  )
}
