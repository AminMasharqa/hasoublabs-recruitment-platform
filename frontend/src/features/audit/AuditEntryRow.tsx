/**
 * One Audit_Log entry as the list renders it (Requirement 17 AC1, AC5, AC8, AC9).
 *
 * AC1 fixes the fields: the occurrence timestamp, the action, the entity type, the
 * entity identifier, the outcome and the reason. Each one is a cell, and each one
 * is present on every row — a `null` reason renders a localized "none recorded"
 * rather than a blank cell, because an unlabelled gap on an accountability record
 * is indistinguishable from a rendering defect.
 *
 * The timestamp is {@link AuditTimestamp}, i.e. UTC with millisecond precision
 * beside the reader's local equivalent (AC9).
 *
 * ## The only control on the row is a disclosure (AC8)
 *
 * The row carries exactly one control — the compare toggle that discloses the
 * `before`/`after` comparison of AC5. There is no edit control, no delete control
 * and no menu that could grow one: AC8 forbids them, and the read-only
 * `auditApi.ts` gives a component nothing to call even if someone added a button.
 * The comparison is rendered by the caller in a row of its own beneath this one, so
 * the wide two-column table does not have to fit inside a cell.
 *
 * Requirements: 17.1, 17.5, 17.8, 17.9, 19.2, 19.10, 20.8.
 */

import { Badge, Button, Table, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { BidiText } from '../../i18n/DirectionProvider'

import type { AuditEntry } from './auditApi'
import { AuditTimestamp } from './AuditTimestamp'

/** Namespaces the row resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['audit', 'shell'] as const

/**
 * Outcomes the Backend_Api records, and the colour each is shown in.
 *
 * The contract declares `outcome` as a free-form string, so the value is rendered
 * as it arrived and this map only decides decoration; an outcome absent from it is
 * rendered in the neutral colour rather than dropped.
 */
const OUTCOME_COLORS: Readonly<Record<string, string>> = Object.freeze({
  SUCCESS: 'teal',
  success: 'teal',
  FAILURE: 'red',
  failure: 'red',
  DENIED: 'red',
  denied: 'red',
  ERROR: 'red',
  error: 'red',
})

export interface AuditEntryRowProps {
  readonly entry: AuditEntry
  /** Whether this entry is the selected one, i.e. whether its comparison is open (AC5). */
  readonly selected: boolean
  /** Selects or deselects this entry for comparison (AC5). */
  readonly onToggleSelect: () => void
}

/** One list row (AC1). */
export function AuditEntryRow({ entry, selected, onToggleSelect }: AuditEntryRowProps) {
  const { t } = useTranslation(NAMESPACES)
  const reason = entry.reason ?? ''

  return (
    <Table.Tr data-testid={`audit-entry-${entry.id}`}>
      <Table.Td>
        <AuditTimestamp value={entry.occurred_at} testId={`audit-entry-occurred-at-${entry.id}`} />
      </Table.Td>
      <Table.Th scope="row" fw={500}>
        <Text size="sm" ff="monospace" data-testid={`audit-entry-action-${entry.id}`}>
          <BidiText value={entry.action} />
        </Text>
      </Table.Th>
      <Table.Td>
        <Text size="sm" data-testid={`audit-entry-entity-type-${entry.id}`}>
          <BidiText value={entry.entity_type} />
        </Text>
      </Table.Td>
      <Table.Td>
        <Text size="sm" ff="monospace" data-testid={`audit-entry-entity-id-${entry.id}`}>
          <BidiText value={entry.entity_id} />
        </Text>
      </Table.Td>
      <Table.Td>
        <Badge
          variant="light"
          color={OUTCOME_COLORS[entry.outcome] ?? 'gray'}
          data-testid={`audit-entry-outcome-${entry.id}`}
        >
          <BidiText value={entry.outcome} />
        </Badge>
      </Table.Td>
      <Table.Td>
        {reason === '' ? (
          <Text size="sm" c="dimmed" data-testid={`audit-entry-reason-${entry.id}`}>
            {t('audit:entry.noReason')}
          </Text>
        ) : (
          <Text size="sm" data-testid={`audit-entry-reason-${entry.id}`}>
            <BidiText value={reason} />
          </Text>
        )}
      </Table.Td>
      <Table.Td>
        {/*
          AC5's selection, and the only control on the row (AC8). `aria-expanded`
          names the disclosure and the accessible name carries the entry
          identifier, so the control is distinguishable from the other 19 on the
          page (Req 20 AC8).
        */}
        <Button
          type="button"
          size="compact-sm"
          variant={selected ? 'filled' : 'default'}
          onClick={onToggleSelect}
          aria-expanded={selected}
          aria-controls={`audit-comparison-panel-${entry.id}`}
          aria-label={t('audit:entry.compareFor', { id: entry.id })}
          data-testid={`audit-entry-compare-${entry.id}`}
        >
          {selected ? t('audit:entry.hideComparison') : t('audit:entry.compare')}
        </Button>
      </Table.Td>
    </Table.Tr>
  )
}
