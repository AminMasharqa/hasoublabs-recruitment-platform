/**
 * A skill-term input that suggests from the Skill_Taxonomy while still accepting
 * a free-text term (Requirement 9 AC7, Requirement 10 AC8).
 *
 * The control is an autocomplete rather than a select, which is the whole point of
 * AC7: the suggestions are a *hint* drawn from `GET /api/v1/skills`, and whatever
 * the Candidate typed is what gets submitted — the Backend_Api resolves a term to
 * a taxonomy row, or records it as pending, and that decision is not the client's
 * to pre-empt.
 *
 * The search is a TanStack Query keyed on the trimmed term, so it is cached across
 * every skill row in the editor: two rows being filled with the same prefix issue
 * one request, and re-opening a row that was already typed in issues none. It is
 * disabled until there is a term to search for, so focusing an empty row asks the
 * Backend_Api for nothing.
 *
 * A failed or still-running search is deliberately silent. Suggestions are an
 * affordance, not a read the screen is about; surfacing an error state here would
 * put an alert next to an input that is working perfectly well, and the
 * Support_Reference of the failure is still recorded by the Api_Client.
 */

import { Autocomplete } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'

import { useApiClient } from '../../../shell/appServices'

import { profileFieldAria } from './fieldAria'
import { FieldMessages } from './ProfileMessages'
import {
  isSearchableSkillTerm,
  searchSkills,
  skillsQueryKey,
  type SkillSuggestion,
} from './skills'

export interface SkillTermInputProps {
  /** Canonical path of this input, e.g. `skills.2.term`. */
  readonly path: string
  /** Localized label. */
  readonly label: string
  /** The entered term, retained verbatim. */
  readonly value: string
  readonly onChange: (value: string) => void
  /** Localized messages placed on this input. */
  readonly messages: readonly string[]
  readonly maxLength?: number
  readonly required?: boolean
}

/** The skill-term input with taxonomy suggestions. */
export function SkillTermInput({
  path,
  label,
  value,
  onChange,
  messages,
  maxLength,
  required,
}: SkillTermInputProps) {
  const api = useApiClient()
  const term = value.trim()
  const enabled = isSearchableSkillTerm(term)

  const suggestions = useQuery<readonly SkillSuggestion[]>({
    queryKey: skillsQueryKey(term),
    queryFn: ({ signal }) => searchSkills(api, term, signal),
    enabled,
    // The taxonomy changes rarely, and the editor re-reads the same prefixes
    // constantly as rows are filled in.
    staleTime: 60_000,
    retry: false,
  })

  const aria = profileFieldAria(path, messages.length > 0)

  return (
    <Autocomplete
      id={aria.id}
      {...(aria.invalid
        ? { error: <FieldMessages messages={messages} />, errorProps: aria.errorProps }
        : {})}
      label={label}
      value={value}
      onChange={onChange}
      data={(suggestions.data ?? []).map((suggestion) => suggestion.name)}
      maxLength={maxLength}
      withAsterisk={required}
      autoComplete="off"
      comboboxProps={{ withinPortal: false }}
      data-testid={`skill-term-${path}`}
    />
  )
}
