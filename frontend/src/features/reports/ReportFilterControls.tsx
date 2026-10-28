/**
 * The date-range and Job_Description controls of the reports destination
 * (Requirement 18 AC2, AC6).
 *
 * AC2 fixes the set: a date range and a Job_Description. Each applied value
 * becomes a query parameter of the activity report and a member of the export
 * request body — the mapping itself is `reportFilters.ts`, so this file only
 * collects values.
 *
 * The panel edits a *draft* and hands the whole set over when the form is
 * submitted, for the same reasons the job browse filters do: one application is
 * one request and one history entry, a half-typed identifier is not a filter, and
 * a change restarts the candidate-progress walk. The draft is seeded from the
 * applied set, so the values stay on screen after a submit and through an empty
 * result.
 *
 * ## Why a native date control
 *
 * `type="date"` gives the platform's own date picker — keyboard-operable, screen
 * reader-labelled and localized by the user agent — and yields exactly the
 * `YYYY-MM-DD` calendar date `reportFilters.ts` reads back. A bespoke picker would
 * have to re-earn all of that, and would put a second date vocabulary next to the
 * one the address bar already carries.
 *
 * Requirements: 18.2, 18.6, 19.2, 20.5, 20.8.
 */

import { Button, Fieldset, Group, Stack, Text, TextInput } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { textForSubmission } from '../../i18n/formatting'

import { EMPTY_REPORT_FILTERS, isReversedRange, type ReportFilters } from './reportFilters'

/** Namespaces the panel resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['reports', 'shell'] as const

export interface ReportFilterControlsProps {
  /** The filter set currently applied, i.e. the one carried by the address. */
  readonly applied: ReportFilters
  /** Called with the edited set when the panel is submitted (AC2). */
  readonly onApply: (filters: ReportFilters) => void
  /** Called when every filter is to be dropped. */
  readonly onClear: () => void
}

/** The report filter panel (AC2). */
export function ReportFilterControls({ applied, onApply, onClear }: ReportFilterControlsProps) {
  const { t } = useTranslation(NAMESPACES)
  const [draft, setDraft] = useState<ReportFilters>(applied)
  const reversed = isReversedRange(draft)

  return (
    <form
      data-testid="report-filters"
      onSubmit={(event) => {
        event.preventDefault()
        onApply(draft)
      }}
      onReset={(event) => {
        event.preventDefault()
        setDraft(EMPTY_REPORT_FILTERS)
        onClear()
      }}
    >
      <Fieldset legend={t('reports:filters.legend')}>
        <Stack gap="sm">
          <TextInput
            type="date"
            label={t('reports:filters.dateFrom')}
            description={t('reports:filters.dateHint')}
            value={draft.dateFrom}
            onChange={(event) => {
              // Read before the updater runs: React may invoke it after the event
              // has been detached, at which point `currentTarget` is null.
              const dateFrom = textForSubmission(event.currentTarget.value)
              setDraft((current) => ({ ...current, dateFrom }))
            }}
            data-testid="report-filter-date-from"
          />

          <TextInput
            type="date"
            label={t('reports:filters.dateTo')}
            description={t('reports:filters.dateHint')}
            value={draft.dateTo}
            onChange={(event) => {
              const dateTo = textForSubmission(event.currentTarget.value)
              setDraft((current) => ({ ...current, dateTo }))
            }}
            data-testid="report-filter-date-to"
          />

          <TextInput
            label={t('reports:filters.jdId')}
            placeholder={t('reports:filters.jdIdPlaceholder')}
            value={draft.jdId}
            onChange={(event) => {
              const jdId = textForSubmission(event.currentTarget.value)
              setDraft((current) => ({ ...current, jdId }))
            }}
            data-testid="report-filter-jd-id"
          />

          {reversed ? (
            <Text size="sm" c="orange" role="status" data-testid="report-filter-range-hint">
              {t('reports:filters.reversedRange')}
            </Text>
          ) : null}

          <Group gap="sm">
            <Button type="submit" data-testid="report-filters-apply">
              {t('reports:filters.apply')}
            </Button>
            <Button type="reset" variant="default" data-testid="report-filters-clear">
              {t('shell:action.clearFilters')}
            </Button>
          </Group>
        </Stack>
      </Fieldset>
    </form>
  )
}
