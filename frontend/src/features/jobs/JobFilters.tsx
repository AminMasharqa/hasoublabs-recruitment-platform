/**
 * The Job_Description browse filters as controls (Requirement 12 AC2, AC5).
 *
 * AC2 fixes the set: a free-text search term, Skill_Taxonomy skills, location,
 * work model, employment type and experience level. Each one is a control here and
 * each applied value becomes a query parameter of `GET /api/v1/jobs` â€” the
 * mapping itself is `browseFilters.ts`, so this file only collects values.
 *
 * ## Why the filters are applied on submit rather than on every keystroke
 *
 * The panel edits a *draft* and hands the whole set to {@link JobFiltersProps.onApply}
 * when the form is submitted. Three reasons: a keyset walk restarts whenever the
 * filter set changes, so applying per keystroke would discard the user's page
 * position mid-word; each application is one request and one history entry; and a
 * partially typed term is not what the user is asking to filter by. The draft is
 * seeded from the applied set, so the values stay on screen after a submit and
 * through an empty result (AC5) â€” the browse screen remounts this panel when the
 * applied set changes, which is what keeps the draft honest without a second
 * source of truth.
 *
 * ## The skill filter
 *
 * The endpoint filters on taxonomy *identifiers*, so a skill has to be picked
 * rather than typed: the term searches `GET /api/v1/skills` and the results are
 * offered as checkboxes. An already-selected identifier stays offered even when
 * the current search does not contain it â€” otherwise clearing the search term
 * would hide the selection the user cannot then remove â€” and is labelled with the
 * name if any search so far has carried one, else with the identifier itself.
 *
 * Requirements: 12.2, 12.5, 19.2, 19.10, 20.7, 20.8.
 */

import { Button, Checkbox, Fieldset, Group, Select, Stack, Text, TextInput } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { EmploymentType, ExperienceLevel, WorkModel } from '../../api/enums'
import {
  EMPLOYMENT_TYPE_VALUES,
  EXPERIENCE_LEVEL_VALUES,
  WORK_MODEL_VALUES,
  type EnumValues,
} from '../../forms/validators'
import { BidiText } from '../../i18n/DirectionProvider'
import { textForSubmission } from '../../i18n/formatting'

import { EMPTY_BROWSE_FILTERS, type JobBrowseFilters } from './browseFilters'
import { useSkillSearchQuery } from './jobQueries'
import { skillNameIndex } from './skills'

/** Namespaces the panel resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['jobs', 'shell'] as const

export interface JobFiltersProps {
  /** The filter set currently applied to the list, i.e. the one in the address. */
  readonly applied: JobBrowseFilters
  /** Called with the edited set when the panel is submitted (AC2). */
  readonly onApply: (filters: JobBrowseFilters) => void
  /** Called when every filter is to be dropped (AC5). */
  readonly onClear: () => void
}

/** Options of one enum-valued filter, labelled from the `jobs` catalogue. */
function enumOptions<T extends string>(
  members: EnumValues<T>,
  label: (value: T) => string,
): { readonly value: T; readonly label: string }[] {
  return members.values.map((value) => ({ value, label: label(value) }))
}

/** The filter panel (AC2). */
export function JobFilters({ applied, onApply, onClear }: JobFiltersProps) {
  const { t } = useTranslation(NAMESPACES)

  const [draft, setDraft] = useState<JobBrowseFilters>(applied)
  const [skillTerm, setSkillTerm] = useState('')
  /**
   * Names of the skills the user has selected, recorded as they are selected.
   *
   * The search results only name what the *current* term matches, so a selection
   * made under an earlier term would lose its label the moment the term changes.
   * Recording the name in the toggle handler — the event that caused the change —
   * keeps the label without a second read and without an effect.
   */
  const [pickedSkillNames, setPickedSkillNames] = useState<ReadonlyMap<string, string>>(new Map())

  const searchedTerm = skillTerm.trim()
  const skills = useSkillSearchQuery(searchedTerm, { enabled: searchedTerm !== '' })
  const foundSkillNames = skillNameIndex(skills.data)

  const offeredSkillIds = [
    ...new Set<string>([...draft.skillIds, ...(skills.data ?? []).map((skill) => skill.id)]),
  ]

  /** Selects a set of taxonomy identifiers, remembering the names now known. */
  const selectSkills = (selected: readonly string[]) => {
    setDraft((current) => ({ ...current, skillIds: selected }))
    setPickedSkillNames((current) => {
      const next = new Map(current)
      for (const id of selected) {
        const name = foundSkillNames.get(id)
        if (name !== undefined) {
          next.set(id, name)
        }
      }
      return next
    })
  }

  return (
    <form
      data-testid="job-filters"
      onSubmit={(event) => {
        event.preventDefault()
        onApply(draft)
      }}
      onReset={(event) => {
        event.preventDefault()
        setDraft(EMPTY_BROWSE_FILTERS)
        setSkillTerm('')
        onClear()
      }}
    >
      <Fieldset legend={t('jobs:filters.legend')}>
        <Stack gap="sm">
          <TextInput
            label={t('jobs:filters.search')}
            placeholder={t('jobs:filters.searchPlaceholder')}
            value={draft.search}
            onChange={(event) => {
              // Read before the updater runs: React may invoke it after the event
              // has been detached, at which point `currentTarget` is null.
              // Req 19 AC11: the entered term is submitted as entered.
              const search = textForSubmission(event.currentTarget.value)
              setDraft((current) => ({ ...current, search }))
            }}
            data-testid="job-filter-search"
          />

          <TextInput
            label={t('jobs:filters.location')}
            placeholder={t('jobs:filters.locationPlaceholder')}
            value={draft.location}
            onChange={(event) => {
              const location = textForSubmission(event.currentTarget.value)
              setDraft((current) => ({ ...current, location }))
            }}
            data-testid="job-filter-location"
          />

          <Select
            label={t('jobs:filters.workModel')}
            placeholder={t('jobs:filters.any')}
            data={enumOptions(WORK_MODEL_VALUES, (value) => t(`jobs:workModel.${value}`))}
            value={draft.workModel}
            clearable
            comboboxProps={{ withinPortal: false }}
            onChange={(value) =>
              setDraft((current) => ({ ...current, workModel: (value as WorkModel | null) ?? null }))
            }
            data-testid="job-filter-work-model"
          />

          <Select
            label={t('jobs:filters.employmentType')}
            placeholder={t('jobs:filters.any')}
            data={enumOptions(EMPLOYMENT_TYPE_VALUES, (value) => t(`jobs:employmentType.${value}`))}
            value={draft.employmentType}
            clearable
            comboboxProps={{ withinPortal: false }}
            onChange={(value) =>
              setDraft((current) => ({
                ...current,
                employmentType: (value as EmploymentType | null) ?? null,
              }))
            }
            data-testid="job-filter-employment-type"
          />

          <Select
            label={t('jobs:filters.experienceLevel')}
            placeholder={t('jobs:filters.any')}
            data={enumOptions(EXPERIENCE_LEVEL_VALUES, (value) => t(`jobs:experienceLevel.${value}`))}
            value={draft.experienceLevel}
            clearable
            comboboxProps={{ withinPortal: false }}
            onChange={(value) =>
              setDraft((current) => ({
                ...current,
                experienceLevel: (value as ExperienceLevel | null) ?? null,
              }))
            }
            data-testid="job-filter-experience-level"
          />

          <Stack gap="xs">
            <TextInput
              label={t('jobs:filters.skillSearch')}
              placeholder={t('jobs:filters.skillSearchPlaceholder')}
              value={skillTerm}
              onChange={(event) => setSkillTerm(textForSubmission(event.currentTarget.value))}
              data-testid="job-filter-skill-search"
            />

            {skills.isFetching ? (
              <Text size="sm" c="dimmed" data-testid="job-filter-skills-loading">
                {t('jobs:filters.skillsLoading')}
              </Text>
            ) : null}

            {offeredSkillIds.length === 0 ? (
              searchedTerm === '' || skills.isFetching ? null : (
                <Text size="sm" c="dimmed" data-testid="job-filter-skills-empty">
                  {t('jobs:filters.skillsEmpty')}
                </Text>
              )
            ) : (
              <Checkbox.Group
                label={t('jobs:filters.skills')}
                value={[...draft.skillIds]}
                onChange={selectSkills}
                data-testid="job-filter-skills"
              >
                <Stack gap={4} pt={4}>
                  {offeredSkillIds.map((id) => {
                    const name = foundSkillNames.get(id) ?? pickedSkillNames.get(id)
                    return (
                      <Checkbox
                        key={id}
                        value={id}
                        label={
                          name === undefined ? (
                            t('jobs:detail.unresolvedSkill', { id })
                          ) : (
                            <BidiText value={name} />
                          )
                        }
                        data-testid={`job-filter-skill-${id}`}
                      />
                    )
                  })}
                </Stack>
              </Checkbox.Group>
            )}
          </Stack>

          <Group gap="sm">
            <Button type="submit" data-testid="job-filters-apply">
              {t('jobs:filters.apply')}
            </Button>
            <Button type="reset" variant="default" data-testid="job-filters-clear">
              {t('jobs:filters.clear')}
            </Button>
          </Group>
        </Stack>
      </Fieldset>
    </form>
  )
}
