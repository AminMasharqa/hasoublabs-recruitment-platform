/**
 * The Audit_Log search filters as controls (Requirement 17 AC2).
 *
 * AC2 fixes the set: actor account, action, entity type, entity identifier, a
 * lower time bound and an upper time bound. Each one is a control here and each
 * applied value becomes a query parameter of `GET /admin/audit` — the mapping
 * itself is `auditFilters.ts`, so this file only collects values.
 *
 * ## Why the filters are applied on submit
 *
 * The panel edits a *draft* and hands the whole set to
 * {@link AuditFiltersPanelProps.onApply} when the form is submitted. A keyset walk
 * restarts whenever the filter set changes, so applying per keystroke would
 * discard the reader's page position mid-word; each application is also one
 * request and one history entry, and a partially typed entity identifier is not
 * what anyone is asking to search by. The draft is seeded from the applied set, so
 * the values stay on screen after a submit and through an empty result — the
 * screen remounts this panel when the applied set changes, which keeps the draft
 * honest without a second source of truth.
 *
 * ## Why the bounds are labelled UTC
 *
 * A `datetime-local` control carries no zone, and the Audit_Log is authoritative
 * in UTC (AC9). Rather than guess, the two bounds are read as UTC wall time and
 * say so in their labels, which also makes the value in the address bar the value
 * that was typed. `normalizeTimeBound` is the conversion, and it is pure and
 * tested.
 *
 * Named `AuditFiltersPanel` rather than `AuditFilters`, so this file's name differs
 * from the pure `auditFilters.ts` beside it by more than its casing — which a
 * case-insensitive file system would otherwise treat as the same module.
 *
 * Requirements: 17.2, 19.2, 19.11, 20.8.
 */

import { Button, Fieldset, Group, Stack, TextInput } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { textForSubmission } from '../../i18n/formatting'

import {
  EMPTY_AUDIT_FILTERS,
  normalizeTimeBound,
  timeBoundInputValue,
  type AuditFilters,
} from './auditFilters'

/** Namespaces the panel resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['audit', 'shell'] as const

export interface AuditFiltersPanelProps {
  /** The filter set currently applied to the list, i.e. the one in the address. */
  readonly applied: AuditFilters
  /** Called with the edited set when the panel is submitted (AC2). */
  readonly onApply: (filters: AuditFilters) => void
  /** Called when every filter is to be dropped (Req 21 AC7). */
  readonly onClear: () => void
}

/** The Audit_Log filter panel (AC2). */
export function AuditFiltersPanel({ applied, onApply, onClear }: AuditFiltersPanelProps) {
  const { t } = useTranslation(NAMESPACES)

  const [draft, setDraft] = useState<AuditFilters>(applied)
  /**
   * The two bounds as their controls hold them: `YYYY-MM-DDTHH:mm` UTC wall time.
   *
   * Kept beside the draft rather than derived from it on every render, because a
   * partially typed bound does not normalize to an instant and deriving would
   * erase it from under the cursor.
   */
  const [fromInput, setFromInput] = useState(() => timeBoundInputValue(applied.from))
  const [toInput, setToInput] = useState(() => timeBoundInputValue(applied.to))

  return (
    <form
      data-testid="audit-filters"
      onSubmit={(event) => {
        event.preventDefault()
        onApply({
          ...draft,
          from: normalizeTimeBound(fromInput),
          to: normalizeTimeBound(toInput),
        })
      }}
      onReset={(event) => {
        event.preventDefault()
        setDraft(EMPTY_AUDIT_FILTERS)
        setFromInput('')
        setToInput('')
        onClear()
      }}
    >
      <Fieldset legend={t('audit:filters.legend')}>
        <Stack gap="sm">
          <TextInput
            label={t('audit:filters.actorAccountId')}
            placeholder={t('audit:filters.actorAccountIdPlaceholder')}
            value={draft.actorAccountId}
            onChange={(event) => {
              // Read before the updater runs: React may invoke it after the event
              // has been detached, at which point `currentTarget` is null.
              // Req 19 AC11: the entered value is submitted as entered.
              const actorAccountId = textForSubmission(event.currentTarget.value)
              setDraft((current) => ({ ...current, actorAccountId }))
            }}
            data-testid="audit-filter-actor"
          />

          <TextInput
            label={t('audit:filters.action')}
            placeholder={t('audit:filters.actionPlaceholder')}
            value={draft.action}
            onChange={(event) => {
              const action = textForSubmission(event.currentTarget.value)
              setDraft((current) => ({ ...current, action }))
            }}
            data-testid="audit-filter-action"
          />

          <TextInput
            label={t('audit:filters.entityType')}
            placeholder={t('audit:filters.entityTypePlaceholder')}
            value={draft.entityType}
            onChange={(event) => {
              const entityType = textForSubmission(event.currentTarget.value)
              setDraft((current) => ({ ...current, entityType }))
            }}
            data-testid="audit-filter-entity-type"
          />

          <TextInput
            label={t('audit:filters.entityId')}
            placeholder={t('audit:filters.entityIdPlaceholder')}
            value={draft.entityId}
            onChange={(event) => {
              const entityId = textForSubmission(event.currentTarget.value)
              setDraft((current) => ({ ...current, entityId }))
            }}
            data-testid="audit-filter-entity-id"
          />

          <TextInput
            type="datetime-local"
            step="1"
            label={t('audit:filters.from')}
            description={t('audit:filters.boundHint')}
            value={fromInput}
            onChange={(event) => setFromInput(textForSubmission(event.currentTarget.value))}
            data-testid="audit-filter-from"
          />

          <TextInput
            type="datetime-local"
            step="1"
            label={t('audit:filters.to')}
            description={t('audit:filters.boundHint')}
            value={toInput}
            onChange={(event) => setToInput(textForSubmission(event.currentTarget.value))}
            data-testid="audit-filter-to"
          />

          <Group gap="sm">
            <Button type="submit" data-testid="audit-filters-apply">
              {t('audit:filters.apply')}
            </Button>
            <Button type="reset" variant="default" data-testid="audit-filters-clear">
              {t('audit:filters.clear')}
            </Button>
          </Group>
        </Stack>
      </Fieldset>
    </form>
  )
}
