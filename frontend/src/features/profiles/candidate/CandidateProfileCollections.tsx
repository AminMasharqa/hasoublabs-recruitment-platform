/**
 * The four repeatable editors of the Candidate profile (Requirement 9 AC3–AC7).
 *
 * | collection | bound | members |
 * | --- | --- | --- |
 * | education | 0–20 | institution, degree, field of study, enrolment status, start year, optional end year |
 * | work experience | 0–20 | company, title, start date, optional end date, optional description |
 * | skills | 0–20 | term (taxonomy-suggested, free text accepted), optional years 0–50 |
 * | languages | 0–10 | language code, proficiency |
 *
 * ## One section component, four row components
 *
 * {@link CollectionSection} owns everything the four have in common: the labelled
 * group, the add control, the bound stated as the reason when the add control is
 * disabled, and the empty note. The rows differ only in which inputs they render,
 * so each is a short component and no bound or add control is spelled twice.
 *
 * The add control is *disabled with its reason shown* rather than hidden at the
 * bound — a control that disappears explains nothing — and the reason is wired to
 * it through `aria-describedby`, so it is announced with the control rather than
 * floating beside it (Req 20 AC5).
 *
 * ## Every input is addressed by its canonical path
 *
 * Each input's `path` is `<collection>.<index>.<member>`, the same spelling
 * `renderedInputs` registers and `forms/violations.ts` normalizes a server
 * `education[2].start_date` into. That is what makes Requirement 9 AC11 hold for
 * the indexed collections: the DOM id an input carries is derived from the path a
 * Field_Violation addresses, so placing the message and focusing the input are the
 * same lookup.
 *
 * Nothing here holds state. The values and the messages come from the form, and
 * every edit is reported upwards as a patch, so a rejected save cannot lose an
 * entered value in a component that kept its own copy.
 */

import { Button, Fieldset, Group, Stack, Text } from '@mantine/core'
import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { BOUNDS, ENROLMENT_STATUS_VALUES, PROFICIENCY_VALUES } from '../../../forms/validators'
import { formatNumber } from '../../../i18n/formatting'
import type { Locale } from '../../../lib/locale'
import {
  ProfileSelectField,
  ProfileTextareaField,
  ProfileTextField,
} from '../shared/ProfileFields'
import { SkillTermInput } from '../shared/SkillTermInput'
import type { FieldMessageIndex } from '../shared/violationMessages'

import {
  COLLECTION_LIMITS,
  entryFieldPath,
  type CollectionName,
  type EducationFormEntry,
  type LanguageFormEntry,
  type Proficiency,
  type SkillFormEntry,
  type WorkFormEntry,
} from './model'

/** Namespaces these editors resolve their strings against (Req 19 AC2). */
const NAMESPACES = ['profiles', 'shell'] as const

// ── The shared section ────────────────────────────────────────────────────────

export interface CollectionSectionProps {
  /** The collection this section edits, used for its test id. */
  readonly collection: CollectionName
  /** Localized section heading. */
  readonly label: string
  /** Localized label of the add control. */
  readonly addLabel: string
  /** Localized note rendered while the collection is empty. */
  readonly emptyLabel: string
  /** How many entries the collection currently holds. */
  readonly count: number
  /** Whether another entry may be added (AC3–AC6). */
  readonly canAdd: boolean
  readonly onAdd: () => void
  /** The rendered entry rows. */
  readonly children: ReactNode
}

/** One repeatable collection: its rows, its add control and its bound. */
export function CollectionSection({
  collection,
  label,
  addLabel,
  emptyLabel,
  count,
  canAdd,
  onAdd,
  children,
}: CollectionSectionProps) {
  const { t } = useTranslation(NAMESPACES)
  const scope = useId()
  const reasonId = `${scope}-limit`

  return (
    <Fieldset legend={label} data-testid={`profile-section-${collection}`}>
      <Stack gap="md">
        {count === 0 ? (
          <Text size="sm" c="dimmed" data-testid={`profile-empty-${collection}`}>
            {emptyLabel}
          </Text>
        ) : (
          children
        )}

        <Group gap="sm" align="center">
          <Button
            type="button"
            variant="light"
            disabled={!canAdd}
            {...(canAdd ? {} : { 'aria-describedby': reasonId })}
            onClick={onAdd}
            data-testid={`profile-add-${collection}`}
          >
            {addLabel}
          </Button>
          {canAdd ? null : (
            <Text
              id={reasonId}
              size="sm"
              c="dimmed"
              data-testid={`profile-limit-${collection}`}
            >
              {t('profiles:limit.reached', { max: COLLECTION_LIMITS[collection] })}
            </Text>
          )}
        </Group>
      </Stack>
    </Fieldset>
  )
}

interface EntryFrameProps {
  readonly collection: CollectionName
  readonly index: number
  /** Localized name of this entry, e.g. "Education entry 2". */
  readonly label: string
  readonly onRemove: () => void
  readonly children: ReactNode
}

/** One entry row: its inputs and the control that drops it. */
function EntryFrame({ collection, index, label, onRemove, children }: EntryFrameProps) {
  const { t } = useTranslation(NAMESPACES)
  return (
    <Fieldset
      legend={label}
      variant="filled"
      data-testid={`profile-entry-${collection}-${index}`}
    >
      <Stack gap="sm">
        {children}
        <Group justify="flex-end">
          <Button
            type="button"
            variant="subtle"
            color="red"
            onClick={onRemove}
            data-testid={`profile-remove-${collection}-${index}`}
          >
            {t('profiles:action.remove', { entry: label })}
          </Button>
        </Group>
      </Stack>
    </Fieldset>
  )
}

// ── Row props shared by the four editors ──────────────────────────────────────

interface RowProps<TEntry> {
  readonly index: number
  readonly entry: TEntry
  /** Localized messages of this form, looked up by input path. */
  readonly messages: FieldMessageIndex
  /** Active Locale, so an entry number is spelled in its digits (Req 19 AC12). */
  readonly locale: Locale
  readonly onChange: (patch: Partial<TEntry>) => void
  readonly onRemove: () => void
}

/** The rendered number of an entry, 1-based and locale-formatted. */
function entryNumber(index: number, locale: Locale): string {
  return formatNumber(index + 1, locale)
}

// ── Education (AC3) ───────────────────────────────────────────────────────────

/** One education entry. */
export function EducationRow({
  index,
  entry,
  messages,
  locale,
  onChange,
  onRemove,
}: RowProps<EducationFormEntry>) {
  const { t } = useTranslation(NAMESPACES)
  const path = (member: string): string => entryFieldPath('education', index, member)
  const label = t('profiles:entry.education', { number: entryNumber(index, locale) })

  return (
    <EntryFrame collection="education" index={index} label={label} onRemove={onRemove}>
      <ProfileTextField
        path={path('institution')}
        label={t('profiles:field.institution')}
        messages={messages.messagesFor(path('institution'))}
        value={entry.institution}
        onChange={(institution) => onChange({ institution })}
        maxLength={BOUNDS.education.institution.maxLength}
        required
      />
      <ProfileTextField
        path={path('degree')}
        label={t('profiles:field.degree')}
        messages={messages.messagesFor(path('degree'))}
        value={entry.degree}
        onChange={(degree) => onChange({ degree })}
        maxLength={BOUNDS.education.degree.maxLength}
        required
      />
      <ProfileTextField
        path={path('field_of_study')}
        label={t('profiles:field.fieldOfStudy')}
        messages={messages.messagesFor(path('field_of_study'))}
        value={entry.field_of_study}
        onChange={(field_of_study) => onChange({ field_of_study })}
        maxLength={BOUNDS.education.fieldOfStudy.maxLength}
      />
      <ProfileSelectField
        path={path('enrolment_status')}
        label={t('profiles:field.enrolmentStatus')}
        messages={messages.messagesFor(path('enrolment_status'))}
        value={entry.enrolment_status}
        onChange={(value) => {
          if (ENROLMENT_STATUS_VALUES.includes(value)) {
            onChange({ enrolment_status: value })
          }
        }}
        data={ENROLMENT_STATUS_VALUES.values.map((value) => ({
          value,
          label: t(`profiles:enrolment.${value}`),
        }))}
        required
      />
      <ProfileTextField
        path={path('start_year')}
        label={t('profiles:field.startYear')}
        messages={messages.messagesFor(path('start_year'))}
        value={entry.start_year}
        onChange={(start_year) => onChange({ start_year })}
        type="number"
        min={BOUNDS.education.year.min}
        max={BOUNDS.education.year.max}
        required
      />
      <ProfileTextField
        path={path('end_year')}
        label={t('profiles:field.endYear')}
        messages={messages.messagesFor(path('end_year'))}
        value={entry.end_year}
        onChange={(end_year) => onChange({ end_year })}
        type="number"
        min={BOUNDS.education.year.min}
        max={BOUNDS.education.year.max}
      />
    </EntryFrame>
  )
}

// ── Work experience (AC4) ─────────────────────────────────────────────────────

/** One work-experience entry. */
export function WorkRow({
  index,
  entry,
  messages,
  locale,
  onChange,
  onRemove,
}: RowProps<WorkFormEntry>) {
  const { t } = useTranslation(NAMESPACES)
  const path = (member: string): string => entryFieldPath('work_experience', index, member)
  const label = t('profiles:entry.work', { number: entryNumber(index, locale) })

  return (
    <EntryFrame collection="work_experience" index={index} label={label} onRemove={onRemove}>
      <ProfileTextField
        path={path('company')}
        label={t('profiles:field.company')}
        messages={messages.messagesFor(path('company'))}
        value={entry.company}
        onChange={(company) => onChange({ company })}
        maxLength={BOUNDS.workExperience.company.maxLength}
        required
      />
      <ProfileTextField
        path={path('title')}
        label={t('profiles:field.jobTitle')}
        messages={messages.messagesFor(path('title'))}
        value={entry.title}
        onChange={(title) => onChange({ title })}
        maxLength={BOUNDS.workExperience.title.maxLength}
        required
      />
      <ProfileTextField
        path={path('start_date')}
        label={t('profiles:field.startDate')}
        messages={messages.messagesFor(path('start_date'))}
        value={entry.start_date}
        onChange={(start_date) => onChange({ start_date })}
        type="date"
        required
      />
      <ProfileTextField
        path={path('end_date')}
        label={t('profiles:field.endDate')}
        messages={messages.messagesFor(path('end_date'))}
        value={entry.end_date}
        onChange={(end_date) => onChange({ end_date })}
        type="date"
      />
      <ProfileTextareaField
        path={path('description')}
        label={t('profiles:field.description')}
        messages={messages.messagesFor(path('description'))}
        value={entry.description}
        onChange={(description) => onChange({ description })}
        maxLength={BOUNDS.workExperience.description.maxLength}
      />
    </EntryFrame>
  )
}

// ── Skills (AC5, AC7) ─────────────────────────────────────────────────────────

/** One skill entry, its term suggested from the Skill_Taxonomy (AC7). */
export function SkillRow({
  index,
  entry,
  messages,
  locale,
  onChange,
  onRemove,
}: RowProps<SkillFormEntry>) {
  const { t } = useTranslation(NAMESPACES)
  const path = (member: string): string => entryFieldPath('skills', index, member)
  const label = t('profiles:entry.skill', { number: entryNumber(index, locale) })

  return (
    <EntryFrame collection="skills" index={index} label={label} onRemove={onRemove}>
      <SkillTermInput
        path={path('term')}
        label={t('profiles:field.skillTerm')}
        messages={messages.messagesFor(path('term'))}
        value={entry.term}
        onChange={(term) => onChange({ term })}
        maxLength={BOUNDS.skill.term.maxLength}
        required
      />
      <ProfileTextField
        path={path('years_experience')}
        label={t('profiles:field.yearsExperience')}
        messages={messages.messagesFor(path('years_experience'))}
        value={entry.years_experience}
        onChange={(years_experience) => onChange({ years_experience })}
        type="number"
        min={BOUNDS.skill.yearsExperience.min}
        max={BOUNDS.skill.yearsExperience.max}
      />
    </EntryFrame>
  )
}

// ── Languages (AC6) ───────────────────────────────────────────────────────────

/** One language entry. */
export function LanguageRow({
  index,
  entry,
  messages,
  locale,
  onChange,
  onRemove,
}: RowProps<LanguageFormEntry>) {
  const { t } = useTranslation(NAMESPACES)
  const path = (member: string): string => entryFieldPath('languages', index, member)
  const label = t('profiles:entry.language', { number: entryNumber(index, locale) })

  return (
    <EntryFrame collection="languages" index={index} label={label} onRemove={onRemove}>
      <ProfileTextField
        path={path('language_code')}
        label={t('profiles:field.languageCode')}
        messages={messages.messagesFor(path('language_code'))}
        value={entry.language_code}
        onChange={(language_code) => onChange({ language_code })}
        maxLength={BOUNDS.language.languageCode.maxLength}
        required
      />
      <ProfileSelectField
        path={path('proficiency')}
        label={t('profiles:field.proficiency')}
        messages={messages.messagesFor(path('proficiency'))}
        value={entry.proficiency}
        onChange={(value) => {
          if (PROFICIENCY_VALUES.includes(value)) {
            onChange({ proficiency: value as Proficiency })
          }
        }}
        data={PROFICIENCY_VALUES.values.map((value) => ({
          value,
          label: t(`profiles:proficiency.${value}`),
        }))}
        required
      />
    </EntryFrame>
  )
}
