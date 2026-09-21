/**
 * The `before`/`after` field-level comparison of one selected Audit_Log entry
 * (Requirement 17 AC5).
 *
 * A three-column table — field, before, after — because that is what "field-level
 * comparison" means to a reader: one row per member, the two values side by side,
 * and the change named. The rows themselves come from `compareAuditFields`, which
 * is pure and tested; this file renders them.
 *
 * ## Why every value goes through `BidiText`
 *
 * A snapshot member may hold Arabic or Hebrew text — a job title, a rejection
 * reason, a company name — regardless of the active Locale. Each value is
 * therefore rendered byte-identically and bidi-isolated, so a Hebrew value in the
 * `after` column is not visually reordered by the Latin field name beside it
 * (Req 19 AC10).
 *
 * An absent member renders as a localized "not present" rather than as an empty
 * cell, because a blank cell and "this field was set to an empty string" look
 * identical and mean opposite things on an accountability record.
 *
 * No control here writes anything: the table is text (AC8).
 *
 * Named for the table rather than for the entry, so this file's name differs from
 * the pure `auditComparison.ts` beside it by more than its casing — which a
 * case-insensitive file system would otherwise treat as the same module.
 *
 * Requirements: 17.5, 17.8, 19.2, 19.10.
 */

import { Badge, Stack, Table, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { BidiText } from '../../i18n/DirectionProvider'

import { compareAuditFields, type AuditSnapshot, type FieldChangeKind } from './auditComparison'

/** Namespaces this component resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['audit', 'shell'] as const

/** Badge colour per change kind. Colour is decoration; the badge text carries the meaning. */
const CHANGE_COLORS: Readonly<Record<FieldChangeKind, string>> = Object.freeze({
  added: 'teal',
  removed: 'red',
  changed: 'yellow',
  unchanged: 'gray',
})

interface SnapshotCellProps {
  /** The rendered value, or `null` when the member is absent from this snapshot. */
  readonly value: string | null
  readonly testId: string
}

/** One snapshot value, byte-identical and bidi-isolated (Req 19 AC10). */
function SnapshotCell({ value, testId }: SnapshotCellProps) {
  const { t } = useTranslation(NAMESPACES)
  if (value === null) {
    return (
      <Text size="sm" c="dimmed" fs="italic" data-testid={testId}>
        {t('audit:comparison.absent')}
      </Text>
    )
  }
  return (
    <Text size="sm" ff="monospace" data-testid={testId}>
      <BidiText value={value} />
    </Text>
  )
}

export interface FieldComparisonTableProps {
  /** The selected entry's `before` member. */
  readonly before: AuditSnapshot
  /** The selected entry's `after` member. */
  readonly after: AuditSnapshot
  /** The entry's identifier, used for the test hooks of each row. */
  readonly entryId: number
}

/** The field-level comparison of the selected entry (AC5). */
export function FieldComparisonTable({ before, after, entryId }: FieldComparisonTableProps) {
  const { t } = useTranslation(NAMESPACES)
  const comparison = compareAuditFields(before, after)

  if (!comparison.hasSnapshots) {
    return (
      <Text size="sm" c="dimmed" data-testid="audit-comparison-empty">
        {t('audit:comparison.noSnapshots')}
      </Text>
    )
  }

  return (
    <Stack gap="xs" data-testid={`audit-comparison-${entryId}`}>
      <Text size="sm" fw={600}>
        {t('audit:comparison.title')}
      </Text>
      {comparison.hasChanges ? null : (
        <Text size="sm" c="dimmed" data-testid="audit-comparison-unchanged">
          {t('audit:comparison.noChanges')}
        </Text>
      )}
      <Table
        withTableBorder
        withColumnBorders
        striped
        captionSide="top"
        data-testid="audit-comparison-table"
      >
        <Table.Caption>{t('audit:comparison.caption')}</Table.Caption>
        <Table.Thead>
          <Table.Tr>
            <Table.Th scope="col">{t('audit:comparison.field')}</Table.Th>
            <Table.Th scope="col">{t('audit:comparison.before')}</Table.Th>
            <Table.Th scope="col">{t('audit:comparison.after')}</Table.Th>
            <Table.Th scope="col">{t('audit:comparison.change')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {comparison.rows.map((row) => (
            <Table.Tr key={row.field} data-testid={`audit-comparison-row-${row.field}`}>
              <Table.Th scope="row" fw={500}>
                <Text size="sm" ff="monospace">
                  <BidiText value={row.field} />
                </Text>
              </Table.Th>
              <Table.Td>
                <SnapshotCell value={row.before} testId={`audit-comparison-before-${row.field}`} />
              </Table.Td>
              <Table.Td>
                <SnapshotCell value={row.after} testId={`audit-comparison-after-${row.field}`} />
              </Table.Td>
              <Table.Td>
                <Badge
                  variant="light"
                  color={CHANGE_COLORS[row.kind]}
                  data-testid={`audit-comparison-kind-${row.field}`}
                >
                  {t(`audit:comparison.kind.${row.kind}`)}
                </Badge>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  )
}
