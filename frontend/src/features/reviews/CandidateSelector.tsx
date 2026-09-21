/**
 * The Candidate picker the two Candidate-less review destinations open with.
 *
 * `/senior/reviews` and `/admin/reviews` are menu destinations, not per-Candidate
 * addresses, and every review endpoint needs a `candidate_id`. This control
 * collects one and writes it to the address, where {@link readCandidateId} reads it
 * back — so no request is issued until a Candidate has actually been named, and the
 * resulting screen is linkable.
 *
 * An identifier rather than a name search: the contract exposes no Candidate
 * lookup a Senior may call, and the Admin directory that would supply one is task
 * 22.1. Accepting the identifier keeps this screen honest about what it knows
 * instead of implying a search that does not exist.
 *
 * Requirements: 15.7, 15.9, 19.2, 20.5.
 */

import { Button, Group, Stack, TextInput } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { textForSubmission } from '../../i18n/formatting'

/** Namespaces this control resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['reviews', 'shell'] as const

export interface CandidateSelectorProps {
  /** The Candidate the address currently names, or `''`. */
  readonly candidateId: string
  /** Called with the entered identifier when the control is submitted. */
  readonly onSelect: (candidateId: string) => void
}

/** Collects the Candidate a review screen is about. */
export function CandidateSelector({ candidateId, onSelect }: CandidateSelectorProps) {
  const { t } = useTranslation(NAMESPACES)
  const [draft, setDraft] = useState(candidateId)

  return (
    <form
      data-testid="review-candidate-selector"
      onSubmit={(event) => {
        event.preventDefault()
        onSelect(draft.trim())
      }}
    >
      <Stack gap="sm">
        <TextInput
          label={t('reviews:candidate.label')}
          description={t('reviews:candidate.hint')}
          value={draft}
          onChange={(event) => {
            const next = textForSubmission(event.currentTarget.value)
            setDraft(next)
          }}
          data-testid="review-candidate-input"
        />
        <Group gap="sm">
          <Button type="submit" data-testid="review-candidate-submit">
            {t('reviews:candidate.submit')}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}
