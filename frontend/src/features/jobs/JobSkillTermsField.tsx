/**
 * The required-skill-terms editor of the authoring form (Requirement 13 AC1).
 *
 * `JdCreateRequest.required_skill_terms` is free text the Backend_Api resolves
 * against the Skill_Taxonomy, so each row is an autocomplete rather than a select:
 * the suggestions from `GET /api/v1/skills` are a hint, and whatever was typed is
 * what gets submitted. Resolving a term to a taxonomy row — or recording it as
 * pending review — is the Backend_Api's decision, not this control's to pre-empt.
 *
 * Every row is addressed by its canonical path `required_skill_terms.<index>`, which
 * is the spelling `forms/violations.ts` normalizes a server
 * `required_skill_terms[0]` into, so placing a 422 message on a row and focusing
 * that row are one lookup.
 *
 * Read-only mode exists for one honest reason (AC11): a `PATCH` replaces the whole
 * term list, and an edit form can only pre-fill the terms the Skill_Taxonomy could
 * name (requirements Assumption 4). While a required skill is unresolved, editing
 * the list would silently drop it from the role, so the editor is disabled and the
 * surface says why instead.
 *
 * Holds no state: the terms and the messages come from the form and every edit is
 * reported upwards, so a rejected submission cannot lose an entered term in a
 * component that kept its own copy (Requirement 22 AC11).
 *
 * Requirements: 13.1, 13.11, 19.2, 20.5, 20.8, 22.9, 22.11.
 */

import { Autocomplete, Button, Fieldset, Group, Stack, Text } from '@mantine/core'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BOUNDS } from '../../forms/validators'
import { textForSubmission } from '../../i18n/formatting'

import { MAX_SKILL_TERMS, skillTermPath } from './authoringRules'
import { useSkillSearchQuery } from './jobQueries'

/** Namespaces this editor resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['jobs', 'shell'] as const

interface SkillTermRowProps {
  readonly index: number
  readonly value: string
  readonly label: string
  readonly messages: readonly string[]
  readonly disabled: boolean
  readonly inputId: string
  readonly messageId: string
  readonly onChange: (value: string) => void
}

/** One term row, with taxonomy suggestions for whatever has been typed so far. */
function SkillTermRow({
  index,
  value,
  label,
  messages,
  disabled,
  inputId,
  messageId,
  onChange,
}: SkillTermRowProps) {
  const term = value.trim()
  // A one-character term matches most of the taxonomy, so the search waits for two.
  const suggestions = useSkillSearchQuery(term, { enabled: !disabled && term.length >= 2 })

  return (
    <Autocomplete
      id={inputId}
      label={label}
      value={value}
      disabled={disabled}
      maxLength={BOUNDS.skill.term.maxLength}
      autoComplete="off"
      comboboxProps={{ withinPortal: false }}
      data={(suggestions.data ?? []).map((skill) => skill.name)}
      {...(messages.length === 0
        ? {}
        : {
            error: messages.map((message) => (
              <span key={message} style={{ display: 'block' }}>
                {message}
              </span>
            )),
            errorProps: { id: messageId },
          })}
      // Req 19 AC11: the term is submitted exactly as entered.
      onChange={(next) => onChange(textForSubmission(next))}
      data-testid={`job-skill-term-${index}`}
    />
  )
}

export interface JobSkillTermsFieldProps {
  /** The entered terms, in rendering order. */
  readonly terms: readonly string[]
  /** Localized messages for one row, looked up by its canonical path. */
  readonly messagesFor: (path: string) => readonly string[]
  /** Identifier of the input element of one row, so focus and messages agree. */
  readonly inputIdFor: (path: string) => string
  /** Identifier of the message element of one row. */
  readonly messageIdFor: (path: string) => string
  readonly onChange: (terms: readonly string[]) => void
  /**
   * Read-only because a required skill could not be named (AC11). The identifiers
   * are stated so the user can see which skill is at stake.
   */
  readonly unresolvedSkillIds?: readonly string[]
  readonly disabled?: boolean
}

/** The 0–20 required-skill-term editor (AC1). */
export function JobSkillTermsField({
  terms,
  messagesFor,
  inputIdFor,
  messageIdFor,
  onChange,
  unresolvedSkillIds = [],
  disabled = false,
}: JobSkillTermsFieldProps) {
  const { t } = useTranslation(NAMESPACES)
  const scope = useId()
  const [draft, setDraft] = useState('')

  const locked = disabled || unresolvedSkillIds.length > 0
  const reasonId = `${scope}-reason`
  const canAdd = !locked && terms.length < MAX_SKILL_TERMS

  const setTerm = (index: number, term: string): void => {
    onChange(terms.map((current, position) => (position === index ? term : current)))
  }

  const addTerm = (): void => {
    const term = draft.trim()
    if (term === '' || !canAdd) {
      return
    }
    onChange([...terms, textForSubmission(draft)])
    setDraft('')
  }

  return (
    <Fieldset legend={t('jobs:form.skillsSection')} data-testid="job-skill-terms">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          {t('jobs:form.skillsHint', { max: MAX_SKILL_TERMS })}
        </Text>

        {/* AC11: an unresolved required skill makes the list unsafe to replace. */}
        {unresolvedSkillIds.length === 0 ? null : (
          <Text id={reasonId} size="sm" c="red" role="status" data-testid="job-skill-terms-locked">
            {t('jobs:form.skillsLocked', { ids: unresolvedSkillIds.join(', ') })}
          </Text>
        )}

        {terms.length === 0 ? (
          <Text size="sm" c="dimmed" data-testid="job-skill-terms-empty">
            {t('jobs:form.skillsEmpty')}
          </Text>
        ) : (
          <Stack gap="sm">
            {terms.map((term, index) => {
              const path = skillTermPath(index)
              const label = t('jobs:form.skillTerm', { number: index + 1 })
              return (
                <Group key={index} align="flex-end" gap="sm" data-testid={`job-skill-row-${index}`}>
                  <SkillTermRow
                    index={index}
                    value={term}
                    label={label}
                    messages={messagesFor(path)}
                    disabled={locked}
                    inputId={inputIdFor(path)}
                    messageId={messageIdFor(path)}
                    onChange={(next) => setTerm(index, next)}
                  />
                  <Button
                    type="button"
                    variant="subtle"
                    color="red"
                    disabled={locked}
                    onClick={() => onChange(terms.filter((_, position) => position !== index))}
                    data-testid={`job-skill-remove-${index}`}
                  >
                    {t('jobs:form.removeSkill', { entry: label })}
                  </Button>
                </Group>
              )
            })}
          </Stack>
        )}

        <Group align="flex-end" gap="sm">
          <Autocomplete
            label={t('jobs:form.addSkillLabel')}
            placeholder={t('jobs:form.addSkillPlaceholder')}
            value={draft}
            disabled={!canAdd}
            maxLength={BOUNDS.skill.term.maxLength}
            autoComplete="off"
            comboboxProps={{ withinPortal: false }}
            data={[]}
            onChange={(next) => setDraft(textForSubmission(next))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                // Adding a term must not submit the surrounding form.
                event.preventDefault()
                addTerm()
              }
            }}
            data-testid="job-skill-draft"
          />
          <Button
            type="button"
            variant="light"
            disabled={!canAdd || draft.trim() === ''}
            {...(locked && unresolvedSkillIds.length > 0 ? { 'aria-describedby': reasonId } : {})}
            onClick={addTerm}
            data-testid="job-skill-add"
          >
            {t('jobs:form.addSkill')}
          </Button>
          {canAdd || locked ? null : (
            <Text size="sm" c="dimmed" data-testid="job-skill-limit">
              {t('jobs:form.skillsLimit', { max: MAX_SKILL_TERMS })}
            </Text>
          )}
        </Group>
      </Stack>
    </Fieldset>
  )
}
