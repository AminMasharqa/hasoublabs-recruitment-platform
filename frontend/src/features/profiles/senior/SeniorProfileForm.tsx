/**
 * The Senior profile editor (Requirement 10 AC2–AC11).
 *
 * Three core inputs, the two contact-preference controls, the expertise editor and
 * one save control. The pure parts live elsewhere on purpose — `model.ts` holds the
 * values, the request mapping, the conditional rules and the rendered-input
 * registry; `violationMessages.ts` localizes and indexes whatever the save reported
 * — so this file decides only what is on screen and when a request is issued.
 *
 * ## What a save sends (AC9)
 *
 * The body `toSeniorUpdateRequest` builds: every edited field, with the
 * Contact_Scope_Preference member omitted while the channel is `None` (AC5) and an
 * empty expertise list omitted rather than sent as a list the Backend_Api refuses.
 * Both exceptions are explained in `model.ts`, which is also where the two
 * conditional requirements of AC6 and AC7 are enforced — and enforced *before* the
 * request is issued, which is what those criteria ask for.
 *
 * ## What a rejected save does
 *
 * Nothing to the entered values. The form values are the single source of what is
 * on screen and no code path here derives them from a response, so a failed save
 * only adds messages: each Field_Violation lands on the input its `path` addresses,
 * anything unaddressable goes to the form-level region rather than being dropped
 * (Req 22 AC9, AC10), and focus moves to the first affected input (Req 20 AC6).
 *
 * A violation reported against `contact_scope_pref` while the channel is `None` is
 * exactly that unaddressable case: the control is not rendered, so the message is
 * shown in the form-level region instead of on a control the Senior cannot see.
 *
 * ## Client-side validation is a courtesy, not the gate
 *
 * The Form_Validator rules run first and, when any fails, no request is issued —
 * the Backend_Api remains the authoritative validator (Req 22 AC12), and a
 * client-side rejection is rendered through the same partition and message path as
 * a 422, so the two cannot disagree about where a message belongs.
 */

import { Button, Divider, Group, Stack } from '@mantine/core'
import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { isApiFailure } from '../../../api/client'
import { ErrorPresenter, LiveAnnouncement } from '../../../errors/ErrorPresenter'
import { BOUNDS } from '../../../forms/validators'
import { FORM_LEVEL_REGION_ID, useViolationFocus } from '../../../forms/violations'
import { useActiveLocale } from '../../../i18n/localeDirection'
import { ProfileTextField } from '../shared/ProfileFields'
import { FormLevelMessages } from '../shared/ProfileMessages'
import {
  buildFieldMessageIndex,
  partitionProfileIssues,
  type ProfileIssuePartition,
} from '../shared/violationMessages'

import {
  addExpertiseSkill,
  removeExpertiseSkill,
  renderedSeniorInputs,
  replaceExpertiseSkill,
  requiresExpertiseSkill,
  toSeniorFormValues,
  toSeniorUpdateRequest,
  validateSeniorProfileForm,
  type SeniorProfile,
  type SeniorProfileFormValues,
} from './model'
import { useSaveMySeniorProfile } from './profileQueries'
import { SeniorContactPreferences } from './SeniorContactPreferences'
import { SeniorExpertiseEditor } from './SeniorExpertiseEditor'

/** Namespaces this form resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['profiles', 'shell', 'errors', 'validation'] as const

/**
 * A partition of nothing, shared so a clean form always renders the same identity
 * — `useViolationFocus` triggers on the partition identity, and a fresh empty
 * object every render would make it fire on every keystroke.
 */
const NO_ISSUES: ProfileIssuePartition = partitionProfileIssues([], [])

export interface SeniorProfileFormProps {
  /**
   * The persisted profile, as the Backend_Api last returned it (AC1).
   *
   * `null` for a Senior whose profile does not exist yet, which opens an empty form
   * rather than an error.
   */
  readonly profile: SeniorProfile | null
  /**
   * The account's registered email address, when the caller holds it (AC10).
   *
   * See `SeniorContactPreferences.tsx`: no endpoint in the current contract reports
   * the authenticated account's address, so this is optional and the surface names
   * the registered account address when it is absent.
   */
  readonly accountEmail?: string | null
}

/** The Senior profile editor. */
export function SeniorProfileForm({ profile, accountEmail = null }: SeniorProfileFormProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const save = useSaveMySeniorProfile()

  const [values, setValues] = useState<SeniorProfileFormValues>(() => toSeniorFormValues(profile))
  const [partition, setPartition] = useState<ProfileIssuePartition>(NO_ISSUES)

  const inputs = useMemo(() => renderedSeniorInputs(values), [values])
  // Req 20 AC6: focus moves to the first affected input of a new partition.
  useViolationFocus(partition)
  const messages = useMemo(() => buildFieldMessageIndex(i18n, partition), [i18n, partition])

  function update(patch: Partial<SeniorProfileFormValues>): void {
    setValues((current) => ({ ...current, ...patch }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const issues = validateSeniorProfileForm(values)
    if (issues.length > 0) {
      // A client-side rejection replaces any previous server outcome, so the two
      // never contradict each other on screen.
      save.reset()
      setPartition(partitionProfileIssues(issues, inputs))
      return
    }
    setPartition(NO_ISSUES)
    save.mutate(toSeniorUpdateRequest(values), {
      onSuccess: (saved) => {
        // The saved profile is now what the server holds, so the form adopts it — a
        // term the Backend_Api resolved to its canonical taxonomy spelling, for
        // instance, should be what the Senior sees next.
        setValues(toSeniorFormValues(saved))
      },
      onError: (error: unknown) => {
        // Place the reported violations. Entered values are untouched.
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
    <form onSubmit={handleSubmit} noValidate data-testid="senior-profile-form">
      <Stack gap="lg">
        {/* AC2: full name, company affiliation, job title. */}
        <Stack gap="sm" data-testid="senior-section-core">
          <ProfileTextField
            path="full_name"
            label={t('profiles:field.fullName')}
            messages={messages.messagesFor('full_name')}
            value={values.full_name}
            onChange={(full_name) => update({ full_name })}
            maxLength={BOUNDS.seniorProfile.fullName.maxLength}
            autoComplete="name"
            required
          />
          <ProfileTextField
            path="company_affiliation"
            label={t('profiles:senior.companyAffiliation')}
            messages={messages.messagesFor('company_affiliation')}
            value={values.company_affiliation}
            onChange={(company_affiliation) => update({ company_affiliation })}
            maxLength={BOUNDS.seniorProfile.companyAffiliation.maxLength}
            autoComplete="organization"
          />
          <ProfileTextField
            path="job_title"
            label={t('profiles:field.jobTitle')}
            messages={messages.messagesFor('job_title')}
            value={values.job_title}
            onChange={(job_title) => update({ job_title })}
            maxLength={BOUNDS.seniorProfile.jobTitle.maxLength}
            autoComplete="organization-title"
          />
        </Stack>

        <Divider />

        {/* AC3–AC7, AC10, AC11. */}
        <SeniorContactPreferences
          channel={values.contact_channel_pref}
          scope={values.contact_scope_pref}
          messages={messages}
          accountEmail={accountEmail}
          onChannelChange={(contact_channel_pref) => update({ contact_channel_pref })}
          onScopeChange={(contact_scope_pref) => update({ contact_scope_pref })}
        />

        {/* AC8, and AC7's "at least one" when the chosen scope asks for it. */}
        <SeniorExpertiseEditor
          terms={values.expertise_skills}
          messages={messages}
          locale={locale}
          required={requiresExpertiseSkill(values)}
          onChange={(index, term) =>
            setValues((current) => replaceExpertiseSkill(current, index, term))
          }
          onAdd={() => setValues((current) => addExpertiseSkill(current))}
          onRemove={(index) => setValues((current) => removeExpertiseSkill(current, index))}
        />

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
          <Button type="submit" loading={save.isPending} data-testid="senior-profile-save">
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
