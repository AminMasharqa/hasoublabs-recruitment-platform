/**
 * One Audit_Log timestamp: the authoritative UTC value with millisecond
 * precision, and the reader's local-time equivalent beside it (Requirement 17
 * AC9).
 *
 * Both renderings come from one call to {@link auditTimestampParts}, so the two
 * lines cannot describe different instants. The UTC value is the one to quote, so
 * it is rendered first, in a monospace face and marked up as `<time>` with its
 * machine-readable `dateTime`; the local equivalent follows, dimmed, naming the
 * zone it was resolved in — without that name "14:32" is a number the reader
 * cannot check.
 *
 * Requirements: 17.9, 19.2, 19.12.
 */

import { Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { useActiveLocale } from '../../i18n/localeDirection'

import { auditTimestampParts, type TimestampInput } from './auditTimestamps'

/** Namespaces this component resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['audit', 'shell'] as const

export interface AuditTimestampProps {
  /** The Backend_Api timestamp, e.g. an entry's `occurred_at`. */
  readonly value: TimestampInput
  /** Test hook, so a row can address its own timestamp. */
  readonly testId?: string
}

/** A timestamp rendered in UTC with its local equivalent (AC9). */
export function AuditTimestamp({ value, testId }: AuditTimestampProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const parts = auditTimestampParts(value, locale)

  if (parts.utc === '') {
    return (
      <Text size="sm" c="dimmed" data-testid={testId}>
        {t('audit:entry.noTimestamp')}
      </Text>
    )
  }

  return (
    <Stack gap={0} data-testid={testId}>
      <Text component="time" size="sm" ff="monospace" dateTime={parts.utc} data-testid="audit-timestamp-utc">
        {t('audit:timestamp.utc', { value: parts.utc })}
      </Text>
      <Text size="xs" c="dimmed" data-testid="audit-timestamp-local">
        {t('audit:timestamp.local', { value: parts.local, zone: parts.timeZone })}
      </Text>
    </Stack>
  )
}
