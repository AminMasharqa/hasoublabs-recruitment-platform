/**
 * The Candidate profile editor (Requirement 9 AC2–AC8, AC11, AC12).
 *
 * Six core inputs, four repeatable collections and one save control. The pure
 * parts live elsewhere on purpose — `model.ts` holds the values, the request
 * mapping, the client-side rules and the rendered-input registry;
 * `violationMessages.ts` localizes and indexes whatever the save reported — so
 * this file decides only what is on screen and when a request is issued.
 *
 * ## What a save sends (AC8)
 *
 * Every core field and every sub-collection present in the form, built by
 * `toUpdateRequest`. Not "the changed ones": the Backend_Api replaces each
 * collection wholesale, so omitting one would mean "leave it alone" rather than
 * "it is now empty", and a removed education entry would quietly survive.
 *
 * ## What a rejected save does (AC11, AC12)
 *
 * Nothing to the entered values. The form values are the single source of what is
 * on screen and no code path here derives them from a response, so a 422 only adds
 * messages: each Field_Violation lands on the input its `path` addresses —
 * including `education[2].start_date` and the other indexed paths, which
 * `forms/violations.ts` normalizes to the same spelling `renderedInputs`
 * registers — anything unaddressable goes to the form-level region rather than
 * being dropped, and focus moves to the first affected input.
 *
 * AC12 follows from the same arrangement: the *persisted* profile is the
 * {@link CandidateProfileFormProps.profile} prop, which a failed save never
 * replaces (see `profileQueries.ts`), so the Draft/Complete state and the
 * completeness panel the screen renders beside this form continue to show the
 * current server state while the rejected entry stays in the inputs.
 *
 * ## Client-side validation is a courtesy, not the gate
 *
 * The Form_Validator rules run first and, when any fails, no request is issued —
 * the Backend_Api remains the authoritative validator (Req 22 AC12), and a
 * client-side rejection is rendered through the exact same partition and message
 * path as a 422, so the two cannot disagree about where a message belongs.
 */

import { Button, Divider, Group, Stack } from '@mantine/core'
import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { isApiFailure } from '../../../api/client'
import { ErrorPresenter, LiveAnnouncement } from '../../../errors/ErrorPresenter'
import { BOUNDS } from '../../../forms/validators'
import { FORM_LEVEL_REGION_ID, useViolationFocus } from '../../../forms/violations'
import { useActiveLocale } from '../../../i18n/localeDirection'
import { ProfileTextareaField, ProfileTextField } from '../shared/ProfileFields'
import { FormLevelMessages } from '../shared/ProfileMessages'
import {
  buildFieldMessageIndex,
  partitionProfileIssues,
  type ProfileIssuePartition,
} from '../shared/violationMessages'

import {
  CollectionSection,
  EducationRow,
  LanguageRow,
  SkillRow,
  WorkRow,
} from './CandidateProfileCollections'
import {
  addEntry,
  canAddEntry,
  removeEntry,
  renderedInputs,
  replaceAt,
  toFormValues,
  toUpdateRequest,
  validateCandidateProfileForm,
  type CandidateProfile,
  type CandidateProfileFormValues,
  type EducationFormEntry,
  type LanguageFormEntry,
  type SkillFormEntry,
  type WorkFormEntry,
} from './model'
import { useSaveMyProfile } from './profileQueries'

/** Namespaces this form resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['profiles', 'shell', 'errors', 'validation'] as const

/**
 * A partition of nothing, shared so a clean form always renders the same
 * identity — `useViolationFocus` triggers on the partition identity, and a fresh
 * empty object every render would make it fire on every keystroke.
 */
const NO_ISSUES: ProfileIssuePartition = partitionProfileIssues([], [])

export interface CandidateProfileFormProps {
  /**
   * The persisted profile, as the Backend_Api last returned it (AC1).
   *
   * `null` for a Candidate whose profile does not exist yet, which opens an empty
   * form rather than an error.
   */
  readonly profile: CandidateProfile | null
}

/** The Candidate profile editor. */
export function CandidateProfileForm({ profile }: CandidateProfileFormProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const save = useSaveMyProfile()

  const [values, setValues] = useState<CandidateProfileFormValues>(() => toFormValues(profile))
  const [partition, setPartition] = useState<ProfileIssuePartition>(NO_ISSUES)

  const inputs = useMemo(() => renderedInputs(values), [values])
  // Req 20 AC6: focus moves to the first affected input of a new partition.
  useViolationFocus(partition)
  const messages = useMemo(() => buildFieldMessageIndex(i18n, partition), [i18n, partition])

  function update(patch: Partial<CandidateProfileFormValues>): void {
    setValues((current) => ({ ...current, ...patch }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const issues = validateCandidateProfileForm(values)
    if (issues.length > 0) {
      // A client-side rejection replaces any previous server outcome, so the two
      // never contradict each other on screen.
      save.reset()
      setPartition(partitionProfileIssues(issues, inputs))
      return
    }
    setPartition(NO_ISSUES)
    save.mutate(toUpdateRequest(values), {
      onSuccess: (saved) => {
        // The saved profile is now what the server holds, so the form adopts it —
        // a term the Backend_Api resolved to its canonical taxonomy spelling, for
        // instance, should be what the Candidate sees next.
        setValues(toFormValues(saved))
      },
      onError: (error: unknown) => {
        // AC11: place the reported violations. Entered values are untouched.
        setPartition(
          isApiFailure(error) ? partitionProfileIssues(error.fieldViolations, inputs) : NO_ISSUES,
        )
      },
    })
  }

  /** Whether the failure is something other than placed field violations. */
  const unplacedFailure =
    save.isError && !(isApiFailure(save.error) && save.error.fieldViolations.length > 0)

  return (
    <form onSubmit={handleSubmit} noValidate data-testid="candidate-profile-form">
      <Stack gap="lg">
        {/* AC2: the six core fields. */}
        <Stack gap="sm" data-testid="profile-section-core">
          <ProfileTextField
            path="full_name"
            label={t('profiles:field.fullName')}
            messages={messages.messagesFor('full_name')}
            value={values.full_name}
            onChange={(full_name) => update({ full_name })}
            maxLength={BOUNDS.candidateProfile.fullName.maxLength}
            autoComplete="name"
            required
          />
          <ProfileTextField
            path="email"
            label={t('profiles:field.email')}
            messages={messages.messagesFor('email')}
            value={values.email}
            onChange={(email) => update({ email })}
            maxLength={BOUNDS.email.maxLength}
            type="email"
            autoComplete="email"
          />
          <ProfileTextField
            path="phone"
            label={t('profiles:field.phone')}
            messages={messages.messagesFor('phone')}
            value={values.phone}
            onChange={(phone) => update({ phone })}
            maxLength={BOUNDS.candidateProfile.phone.maxLength}
            type="tel"
            autoComplete="tel"
          />
          <ProfileTextField
            path="city"
            label={t('profiles:field.city')}
            messages={messages.messagesFor('city')}
            value={values.city}
            onChange={(city) => update({ city })}
            maxLength={BOUNDS.candidateProfile.city.maxLength}
            autoComplete="address-level2"
          />
          <ProfileTextareaField
            path="summary"
            label={t('profiles:field.summary')}
            messages={messages.messagesFor('summary')}
            value={values.summary}
            onChange={(summary) => update({ summary })}
            maxLength={BOUNDS.candidateProfile.summary.maxLength}
          />
          <ProfileTextField
            path="linkedin_url"
            label={t('profiles:field.linkedinUrl')}
            messages={messages.messagesFor('linkedin_url')}
            value={values.linkedin_url}
            onChange={(linkedin_url) => update({ linkedin_url })}
            maxLength={BOUNDS.linkedinUrl.maxLength}
            type="url"
          />
        </Stack>

        {/* AC3: 0–20 education entries. */}
        <CollectionSection
          collection="education"
          label={t('profiles:section.education')}
          addLabel={t('profiles:action.addEducation')}
          emptyLabel={t('profiles:empty.education')}
          count={values.education.length}
          canAdd={canAddEntry(values, 'education')}
          onAdd={() => setValues((current) => addEntry(current, 'education'))}
        >
          <Stack gap="md">
            {values.education.map((entry, index) => (
              <EducationRow
                key={index}
                index={index}
                entry={entry}
                messages={messages}
                locale={locale}
                onChange={(patch: Partial<EducationFormEntry>) =>
                  setValues((current) => ({
                    ...current,
                    education: replaceAt(current.education, index, {
                      ...(current.education[index] ?? entry),
                      ...patch,
                    }),
                  }))
                }
                onRemove={() => setValues((current) => removeEntry(current, 'education', index))}
              />
            ))}
          </Stack>
        </CollectionSection>

        {/* AC4: 0–20 work-experience entries. */}
        <CollectionSection
          collection="work_experience"
          label={t('profiles:section.work')}
          addLabel={t('profiles:action.addWork')}
          emptyLabel={t('profiles:empty.work')}
          count={values.work_experience.length}
          canAdd={canAddEntry(values, 'work_experience')}
          onAdd={() => setValues((current) => addEntry(current, 'work_experience'))}
        >
          <Stack gap="md">
            {values.work_experience.map((entry, index) => (
              <WorkRow
                key={index}
                index={index}
                entry={entry}
                messages={messages}
                locale={locale}
                onChange={(patch: Partial<WorkFormEntry>) =>
                  setValues((current) => ({
                    ...current,
                    work_experience: replaceAt(current.work_experience, index, {
                      ...(current.work_experience[index] ?? entry),
                      ...patch,
                    }),
                  }))
                }
                onRemove={() =>
                  setValues((current) => removeEntry(current, 'work_experience', index))
                }
              />
            ))}
          </Stack>
        </CollectionSection>

        {/* AC5, AC7: 0–20 skills, each term suggested from the Skill_Taxonomy. */}
        <CollectionSection
          collection="skills"
          label={t('profiles:section.skills')}
          addLabel={t('profiles:action.addSkill')}
          emptyLabel={t('profiles:empty.skills')}
          count={values.skills.length}
          canAdd={canAddEntry(values, 'skills')}
          onAdd={() => setValues((current) => addEntry(current, 'skills'))}
        >
          <Stack gap="md">
            {values.skills.map((entry, index) => (
              <SkillRow
                key={index}
                index={index}
                entry={entry}
                messages={messages}
                locale={locale}
                onChange={(patch: Partial<SkillFormEntry>) =>
                  setValues((current) => ({
                    ...current,
                    skills: replaceAt(current.skills, index, {
                      ...(current.skills[index] ?? entry),
                      ...patch,
                    }),
                  }))
                }
                onRemove={() => setValues((current) => removeEntry(current, 'skills', index))}
              />
            ))}
          </Stack>
        </CollectionSection>

        {/* AC6: 0–10 languages. */}
        <CollectionSection
          collection="languages"
          label={t('profiles:section.languages')}
          addLabel={t('profiles:action.addLanguage')}
          emptyLabel={t('profiles:empty.languages')}
          count={values.languages.length}
          canAdd={canAddEntry(values, 'languages')}
          onAdd={() => setValues((current) => addEntry(current, 'languages'))}
        >
          <Stack gap="md">
            {values.languages.map((entry, index) => (
              <LanguageRow
                key={index}
                index={index}
                entry={entry}
                messages={messages}
                locale={locale}
                onChange={(patch: Partial<LanguageFormEntry>) =>
                  setValues((current) => ({
                    ...current,
                    languages: replaceAt(current.languages, index, {
                      ...(current.languages[index] ?? entry),
                      ...patch,
                    }),
                  }))
                }
                onRemove={() => setValues((current) => removeEntry(current, 'languages', index))}
              />
            ))}
          </Stack>
        </CollectionSection>

        <Divider />

        {/* Req 22 AC10: violations addressing no rendered input are shown, not dropped. */}
        <FormLevelMessages
          id={FORM_LEVEL_REGION_ID}
          title={t('profiles:formLevel.title')}
          messages={messages.formLevel}
        />

        {unplacedFailure ? (
          <ErrorPresenter error={save.error} title={t('profiles:save.failedTitle')} />
        ) : null}

        <Group>
          <Button type="submit" loading={save.isPending} data-testid="profile-save">
            {save.isPending ? t('profiles:action.saving') : t('profiles:action.save')}
          </Button>
        </Group>

        {/* Req 20 AC7: the outcome is announced without moving focus. */}
        <LiveAnnouncement
          message={
            messages.total > 0
              ? t('profiles:formLevel.title')
              : save.isSuccess
                ? t('profiles:save.succeeded')
                : unplacedFailure
                  ? t('profiles:save.failedTitle')
                  : null
          }
        />
      </Stack>
    </form>
  )
}
