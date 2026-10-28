/**
 * The skill-candidate confirmation of an extraction draft
 * (Requirement 13 AC7, AC10).
 *
 * AC7 asks for every candidate skill the extractor proposed to be presented for
 * *explicit* confirmation or replacement, and for submission to be blocked until
 * each one has been. So each candidate is a row with three decisions — keep it,
 * replace it with a term of the user's own, or drop it — and none of them is
 * pre-selected: a default would be the implicit acceptance AC7 exists to prevent.
 *
 * "Drop it" is the third legitimate decision rather than a loophole: an extractor
 * that proposed a skill the role does not require has to be refusable, and refusing
 * is as deliberate an act as confirming. What AC7 forbids is *leaving a candidate
 * undecided* and persisting anyway, which {@link allSkillCandidatesResolved} — read
 * by the submit control through `canConfirmExtraction` — makes impossible.
 *
 * The decisions live in the screen's state, not here: the submit gate of AC10 reads
 * them, and a panel that owned them would have to publish them upwards anyway.
 *
 * Requirements: 13.7, 13.10, 19.2, 19.10, 20.5, 20.7.
 */

import { Badge, Fieldset, Group, Radio, Stack, Text, TextInput } from '@mantine/core'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { BOUNDS } from '../../forms/validators'
import { BidiText } from '../../i18n/DirectionProvider'
import { textForSubmission } from '../../i18n/formatting'

import { isSkillCandidateResolved, type SkillDecision, type SkillResolution } from './extraction'

/** Namespaces this panel resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['jobs', 'shell'] as const

/** The three decisions AC7 admits, in the order they are offered. */
const DECISIONS: readonly Exclude<SkillDecision, 'pending'>[] = ['confirmed', 'replaced', 'discarded']

export interface SkillCandidatePanelProps {
  /** One entry per proposed candidate, with the decision taken so far. */
  readonly resolutions: readonly SkillResolution[]
  /** Records a decision about one candidate (AC7). */
  readonly onDecide: (index: number, decision: SkillDecision, replacement?: string) => void
  readonly disabled?: boolean
}

/** The candidate-confirmation panel (AC7). */
export function SkillCandidatePanel({
  resolutions,
  onDecide,
  disabled = false,
}: SkillCandidatePanelProps) {
  const { t } = useTranslation(NAMESPACES)
  const scope = useId()

  if (resolutions.length === 0) {
    return null
  }

  const undecided = resolutions.filter((resolution) => !isSkillCandidateResolved(resolution)).length

  return (
    <Fieldset legend={t('jobs:candidates.legend')} data-testid="job-skill-candidates">
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {t('jobs:candidates.description')}
        </Text>

        {/* AC7: the count is stated, so the blocked submit control is explained. */}
        <Text
          size="sm"
          c={undecided === 0 ? 'green' : 'red'}
          role="status"
          data-testid="job-skill-candidates-undecided"
          data-undecided={undecided}
        >
          {undecided === 0
            ? t('jobs:candidates.allDecided')
            : t('jobs:candidates.undecided', { count: undecided })}
        </Text>

        {resolutions.map((resolution, index) => {
          const groupId = `${scope}-candidate-${index}`
          return (
            <Stack key={index} gap="xs" data-testid={`job-skill-candidate-${index}`}>
              <Group gap="xs">
                <Text size="sm" fw={500}>
                  {/* The proposed term is Backend_Api text (Req 19 AC10). */}
                  <BidiText value={resolution.proposed} />
                </Text>
                <Badge
                  variant="light"
                  color={isSkillCandidateResolved(resolution) ? 'green' : 'red'}
                  data-testid={`job-skill-candidate-state-${index}`}
                  data-decision={resolution.decision}
                >
                  {t(`jobs:candidates.state.${resolution.decision}`)}
                </Badge>
              </Group>

              <Radio.Group
                id={groupId}
                label={t('jobs:candidates.decisionLabel')}
                value={resolution.decision === 'pending' ? '' : resolution.decision}
                onChange={(value) => onDecide(index, value as SkillDecision, resolution.term)}
              >
                <Group gap="md" pt={4}>
                  {DECISIONS.map((decision) => (
                    <Radio
                      key={decision}
                      value={decision}
                      disabled={disabled}
                      label={t(`jobs:candidates.decision.${decision}`)}
                      data-testid={`job-skill-candidate-${index}-${decision}`}
                    />
                  ))}
                </Group>
              </Radio.Group>

              {resolution.decision === 'replaced' ? (
                <TextInput
                  label={t('jobs:candidates.replacementLabel')}
                  description={t('jobs:candidates.replacementHint')}
                  value={resolution.term}
                  disabled={disabled}
                  maxLength={BOUNDS.skill.term.maxLength}
                  onChange={(event) =>
                    onDecide(index, 'replaced', textForSubmission(event.currentTarget.value))
                  }
                  data-testid={`job-skill-candidate-${index}-replacement`}
                />
              ) : null}
            </Stack>
          )
        })}
      </Stack>
    </Fieldset>
  )
}
