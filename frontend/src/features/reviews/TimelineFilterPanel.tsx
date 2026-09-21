/**
 * The Admin Review_Timeline filter controls (Requirement 15 AC8).
 *
 * AC8 fixes the set: reviewer, Job_Description, a lower creation bound and an
 * upper creation bound. Each is a control here and each applied value becomes a
 * query parameter — the mapping itself is `timelineFilters.ts`, so this file only
 * collects values.
 *
 * The reviewer and Job_Description filters take identifiers rather than names,
 * because that is what the endpoint filters on: `reviewer_id` and `jd_id` are both
 * account/Job_Description UUIDs, and the contract exposes no lookup that would
 * turn a typed name into one for this screen.
 *
 * ## Why the filters are applied on submit rather than per keystroke
 *
 * The panel edits a *draft* and hands the whole set to
 * {@link TimelineFilterPanelProps.onApply} when the form is submitted. A keyset
 * walk restarts whenever the filter set changes, so applying per keystroke would
 * discard the reader's page position mid-identifier; each application is also one
 * request and one history entry. The draft is seeded from the applied set, so the
 * values stay on screen after a submit and through an empty result — the screen
 * remounts this panel when the applied set changes, which keeps the draft honest
 * without a second source of truth. Same arrangement as the Job_Description browse
 * filters, deliberately.
 *
 * Requirements: 15.8, 19.2, 20.5.
 */

import { Button, Fieldset, Group, Stack, TextInput } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { textForSubmission } from '../../i18n/formatting'

import { EMPTY_TIMELINE_FILTERS, type TimelineFilters } from './timelineFilters'

/** Namespaces the panel resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['reviews', 'shell'] as const

export interface TimelineFilterPanelProps {
  /** The filter set currently applied, i.e. the one in the address. */
  readonly applied: TimelineFilters
  /** Called with the edited set when the panel is submitted (AC8). */
  readonly onApply: (filters: TimelineFilters) => void
  /** Called when every filter is to be dropped. */
  readonly onClear: () => void
}

/** The Admin timeline filter panel (AC8). */
export function TimelineFilterPanel({ applied, onApply, onClear }: TimelineFilterPanelProps) {
  const { t } = useTranslation(NAMESPACES)
  const [draft, setDraft] = useState<TimelineFilters>(applied)

  return (
    <form
      data-testid="review-filters"
      onSubmit={(event) => {
        event.preventDefault()
        onApply(draft)
      }}
      onReset={(event) => {
        event.preventDefault()
        setDraft(EMPTY_TIMELINE_FILTERS)
        onClear()
      }}
    >
      <Fieldset legend={t('reviews:filters.legend')}>
        <Stack gap="sm">
          <TextInput
            label={t('reviews:filters.reviewer')}
            description={t('reviews:filters.reviewerHint')}
            value={draft.reviewerId}
            onChange={(event) => {
              // Read before the updater runs: React may invoke it after the event
              // has been detached, at which point `currentTarget` is null.
              const reviewerId = textForSubmission(event.currentTarget.value)
              setDraft((current) => ({ ...current, reviewerId }))
            }}
            data-testid="review-filter-reviewer"
          />

          <TextInput
            label={t('reviews:filters.jd')}
            description={t('reviews:filters.jdHint')}
            value={draft.jdId}
            onChange={(event) => {
              const jdId = textForSubmission(event.currentTarget.value)
              setDraft((current) => ({ ...current, jdId }))
            }}
            data-testid="review-filter-jd"
          />

          <TextInput
            type="date"
            label={t('reviews:filters.dateFrom')}
            value={draft.dateFrom}
            onChange={(event) => {
              const dateFrom = textForSubmission(event.currentTarget.value)
              setDraft((current) => ({ ...current, dateFrom }))
            }}
            data-testid="review-filter-date-from"
          />

          <TextInput
            type="date"
            label={t('reviews:filters.dateTo')}
            value={draft.dateTo}
            onChange={(event) => {
              const dateTo = textForSubmission(event.currentTarget.value)
              setDraft((current) => ({ ...current, dateTo }))
            }}
            data-testid="review-filter-date-to"
          />

          <Group gap="sm">
            <Button type="submit" data-testid="review-filters-apply">
              {t('reviews:filters.apply')}
            </Button>
            <Button type="reset" variant="default" data-testid="review-filters-clear">
              {t('reviews:filters.clear')}
            </Button>
          </Group>
        </Stack>
      </Fieldset>
    </form>
  )
}
