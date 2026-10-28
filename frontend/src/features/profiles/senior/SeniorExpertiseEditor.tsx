/**
 * The expertise-skill editor of the Senior profile (Requirement 10 AC7, AC8).
 *
 * One to ten terms, each suggested from the Skill_Taxonomy through the shared
 * {@link SkillTermInput} — the same control the Candidate skill rows use, so
 * `GET /api/v1/skills` is queried and cached once per term across both editors and
 * a free-text term is still accepted (AC8; Req 9 AC7).
 *
 * The add control is *disabled with its reason shown* at the bound rather than
 * hidden — a control that disappears explains nothing — and the reason is wired to
 * it through `aria-describedby`, so it is announced with the control rather than
 * floating beside it (Req 20 AC5).
 *
 * Every input is addressed by its canonical path, `expertise_skills.<index>`: the
 * spelling `renderedSeniorInputs` registers and the one `forms/violations.ts`
 * normalizes a server `expertise_skills[0]` into. So placing a message on a row and
 * focusing that row are the same lookup.
 *
 * Nothing here holds state. The terms and the messages come from the form and every
 * edit is reported upwards, so a rejected save cannot lose an entered term in a
 * component that kept its own copy.
 */

import { Button, Fieldset, Group, Stack, Text } from '@mantine/core'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { BOUNDS } from '../../../forms/validators'
import { formatNumber } from '../../../i18n/formatting'
import type { Locale } from '../../../lib/locale'
import { SkillTermInput } from '../shared/SkillTermInput'
import type { FieldMessageIndex } from '../shared/violationMessages'

import { EXPERTISE_LIMITS, expertiseFieldPath } from './model'

/** Namespaces this editor resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['profiles', 'shell'] as const

export interface SeniorExpertiseEditorProps {
  /** The entered terms, in rendering order. */
  readonly terms: readonly string[]
  /** Localized messages of this form, looked up by input path. */
  readonly messages: FieldMessageIndex
  /** Active Locale, so a row number is spelled in its digits (Req 19 AC12). */
  readonly locale: Locale
  /** Whether at least one term is currently required (AC7). */
  readonly required: boolean
  readonly onChange: (index: number, term: string) => void
  readonly onAdd: () => void
  readonly onRemove: (index: number) => void
}

/** The 1–10 expertise-skill editor. */
export function SeniorExpertiseEditor({
  terms,
  messages,
  locale,
  required,
  onChange,
  onAdd,
  onRemove,
}: SeniorExpertiseEditorProps) {
  const { t } = useTranslation(NAMESPACES)
  const scope = useId()
  const reasonId = `${scope}-limit`
  const canAdd = terms.length < EXPERTISE_LIMITS.maxItems

  return (
    <Fieldset
      legend={t('profiles:senior.expertiseSection')}
      data-testid="senior-expertise-section"
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {t('profiles:senior.expertiseDescription', {
            min: formatNumber(EXPERTISE_LIMITS.minItems, locale),
            max: formatNumber(EXPERTISE_LIMITS.maxItems, locale),
          })}
        </Text>

        {terms.length === 0 ? (
          <Text size="sm" c="dimmed" data-testid="senior-expertise-empty">
            {t('profiles:senior.expertiseEmpty')}
          </Text>
        ) : (
          <Stack gap="sm">
            {terms.map((term, index) => {
              const path = expertiseFieldPath(index)
              const label = t('profiles:senior.expertiseEntry', {
                number: formatNumber(index + 1, locale),
              })
              return (
                <Group
                  key={index}
                  align="flex-end"
                  gap="sm"
                  data-testid={`senior-expertise-row-${index}`}
                >
                  <SkillTermInput
                    path={path}
                    label={label}
                    messages={messages.messagesFor(path)}
                    value={term}
                    onChange={(next) => onChange(index, next)}
                    maxLength={BOUNDS.skill.term.maxLength}
                    required={required}
                  />
                  <Button
                    type="button"
                    variant="subtle"
                    color="red"
                    onClick={() => onRemove(index)}
                    data-testid={`senior-expertise-remove-${index}`}
                  >
                    {t('profiles:action.remove', { entry: label })}
                  </Button>
                </Group>
              )
            })}
          </Stack>
        )}

        <Group gap="sm" align="center">
          <Button
            type="button"
            variant="light"
            disabled={!canAdd}
            {...(canAdd ? {} : { 'aria-describedby': reasonId })}
            onClick={onAdd}
            data-testid="senior-expertise-add"
          >
            {t('profiles:senior.addExpertise')}
          </Button>
          {canAdd ? null : (
            <Text id={reasonId} size="sm" c="dimmed" data-testid="senior-expertise-limit">
              {t('profiles:limit.reached', { max: EXPERTISE_LIMITS.maxItems })}
            </Text>
          )}
        </Group>
      </Stack>
    </Fieldset>
  )
}
