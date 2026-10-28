/**
 * Names the Job_Description an applicant list is about, on the two destinations whose
 * path does not (Requirement 14 AC12).
 *
 * `/senior/applicants` and `/admin/applications` are Navigation_Menu destinations
 * (Requirement 8 AC7, AC8), not per-role addresses, while every applicant read is
 * scoped to one Job_Description. This control supplies that identifier and writes it
 * into the address, so the selection is linkable and survives a reload — the same
 * approach the Review screens take for the Candidate they are about.
 *
 * A plain text field rather than a picker: the contract exposes no
 * "Job_Descriptions I may see applicants for" endpoint, and the per-role address
 * `/senior/jobs/:jdId/applicants` — reached from the Senior's own Job_Description
 * list — is the path a Senior normally arrives by. This field is the fallback for a
 * pasted or bookmarked identifier.
 *
 * Requirements: 14.12, 19.2, 19.11, 20.5.
 */

import { Button, Group, Stack, TextInput } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { textForSubmission } from '../../i18n/formatting'

/** Namespaces this control resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['applications', 'shell'] as const

export interface JobSelectorProps {
  /** The Job_Description the address currently names; `''` for none. */
  readonly jdId: string
  /** Applies a selection, which the screen writes into the address. */
  readonly onSelect: (jdId: string) => void
}

/** The Job_Description selector of an applicant destination (AC12). */
export function JobSelector({ jdId, onSelect }: JobSelectorProps) {
  const { t } = useTranslation(NAMESPACES)
  const [draft, setDraft] = useState(jdId)

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSelect(draft.trim())
      }}
    >
      <Stack gap="xs">
        <Group gap="sm" align="flex-end" wrap="wrap">
          <TextInput
            label={t('applications:applicants.jdLabel')}
            description={t('applications:applicants.jdHint')}
            value={draft}
            onChange={(event) => {
              // Req 19 AC11: carried through exactly as entered.
              setDraft(textForSubmission(event.currentTarget.value))
            }}
            data-testid="applicants-jd-input"
          />
          <Button type="submit" data-testid="applicants-jd-submit">
            {t('applications:applicants.jdSubmit')}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}
