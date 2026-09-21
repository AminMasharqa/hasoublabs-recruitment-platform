/**
 * The role-fixed registration form (Requirement 6 AC2, AC4, AC5, AC6, AC7, AC8,
 * AC13, AC14).
 *
 * ## The role is structural, not hidden
 *
 * AC2 forbids a role selection control. That is not implemented by omitting a
 * `<Select>` and hoping no one adds one back: the role arrives as the
 * {@link RegistrationFormProps.role} prop, typed {@link SelfRegistrationRole} and
 * produced only by `selfRegistrationRole` from the validated Registration_Link,
 * and the form's value type ({@link RegistrationFormValues}) has no `role` member
 * at all. There is nowhere for a control to write to, and the submitted `role`
 * and endpoint are both derived from the prop. The role is *shown*, as read-only
 * text, because the person filling the form should know what they are creating.
 *
 * ## The Residency_Proof (AC4, AC5)
 *
 * The type control switches which inputs are rendered: one value input for
 * `MobilePhone` and `NationalId`, four separate inputs for `Address`. The
 * composition into the single `residency_proof_value` the contract declares lives
 * in `residencyProof.ts`, so this file decides only what is on screen. Switching
 * the type does not discard what was already typed into the other shape.
 *
 * ## A failed submission (AC13, AC14)
 *
 * Every rendered input is registered with `forms/violations.ts`, so a 422 lands
 * each Field_Violation on the input its `path` addresses — including a violation
 * of the composed `residency_proof_value`, which the street input claims as an
 * alias — places anything unaddressable in the form-level region, moves focus to
 * the first affected input and *never touches an entered value* (AC14,
 * Requirement 20 AC6, Requirement 22 AC9–AC11). A `conflicting_state` refusal
 * renders one fixed, localized email-conflict sentence and no account detail
 * whatsoever (AC13) — see `registrationMessages.ts`. Anything else goes to the
 * Error_Presenter with its Support_Reference.
 *
 * ## A successful submission (AC8)
 *
 * The created account's identifier is carried to the Verification_Code screen in
 * router state and the entry is replaced, so the browser's back button cannot
 * return to a form whose submission already created an account.
 */

import {
  Alert,
  Button,
  Fieldset,
  NativeSelect,
  PasswordInput,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import { useMutation } from '@tanstack/react-query'
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { isApiFailure } from '../../api/client'
import { ErrorPresenter, LiveAnnouncement } from '../../errors/ErrorPresenter'
import {
  BOUNDS,
  LOCALE_VALUES,
  RESIDENCY_PROOF_TYPE_VALUES,
} from '../../forms/validators'
import {
  describeField,
  FORM_LEVEL_REGION_ID,
  inputElementId,
  useViolationFocus,
  violationMessageId,
  type RenderedInput,
} from '../../forms/violations'
import { useActiveLocale } from '../../i18n/localeDirection'
import { VERIFICATION_PATH } from '../../routing/paths'
import { useApiClient } from '../../shell/appServices'

import { submitRegistration } from './registerAccount'
import {
  addressPartPath,
  initialRegistrationValues,
  renderedRegistrationInputs,
  validateRegistrationValues,
  type RegistrationFormValues,
  type RegistrationTarget,
} from './registrationFormModel'
import type { SelfRegistrationRole } from './registrationLink'
import {
  isEmailConflict,
  localizeIssuePartition,
  NO_ISSUES,
  partitionRegistrationIssues,
  type RegistrationIssuePartition,
} from './registrationMessages'
import { ADDRESS_PROOF_PARTS, isAddressProof, type AddressProofPart } from './residencyProof'
import { verificationHandoffState } from './verificationHandoff'

/** Namespaces this form resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['registration', 'shell', 'errors', 'validation'] as const

/** Autofill hints for the separately collected address parts (Req 20 AC5). */
const ADDRESS_PART_AUTOCOMPLETE: Readonly<Record<AddressProofPart, string>> = Object.freeze({
  street: 'address-line1',
  number: 'address-line2',
  city: 'address-level2',
  country: 'country-name',
})

export interface RegistrationFormProps {
  /** The role the validated Registration_Link named; fixed for this form (AC2). */
  readonly role: SelfRegistrationRole
  /** The Registration_Link token from the address, submitted as `link_token`. */
  readonly token: string
}

/** How a failed submission is surfaced. */
type FailureKind = 'none' | 'emailConflict' | 'violations' | 'other'

function classifyFailure(error: unknown): FailureKind {
  if (error == null) {
    return 'none'
  }
  // AC13 first: the conflict must never fall through to a surface that would
  // render the envelope's own message or details.
  if (isEmailConflict(error)) {
    return 'emailConflict'
  }
  return isApiFailure(error) && error.fieldViolations.length > 0 ? 'violations' : 'other'
}

export function RegistrationForm({ role, token }: RegistrationFormProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const api = useApiClient()
  const navigate = useNavigate()

  const target: RegistrationTarget = useMemo(() => ({ role, token }), [role, token])
  const [values, setValues] = useState<RegistrationFormValues>(() =>
    initialRegistrationValues(locale),
  )
  const [partition, setPartition] = useState<RegistrationIssuePartition>(NO_ISSUES)

  const inputs = useMemo(
    () => renderedRegistrationInputs(values.residency_proof_type),
    [values.residency_proof_type],
  )
  // Req 20 AC6: focus moves to the first affected input of a new partition.
  useViolationFocus(partition)
  const messages = localizeIssuePartition(i18n, partition)

  const registration = useMutation({
    mutationFn: (submitted: RegistrationFormValues) => submitRegistration(api, submitted, target),
    onSuccess: (account) => {
      // AC8: retain the returned identifier and go to the Verification_Code screen.
      navigate(VERIFICATION_PATH, { state: verificationHandoffState(account), replace: true })
    },
    onError: (error: unknown) => {
      // AC14: place the reported violations; entered values are untouched.
      setPartition(
        isApiFailure(error)
          ? partitionRegistrationIssues(error.fieldViolations, inputs)
          : NO_ISSUES,
      )
    },
  })

  const failure = classifyFailure(registration.error)

  function update(patch: Partial<RegistrationFormValues>): void {
    setValues((current) => ({ ...current, ...patch }))
  }

  function updateAddressPart(part: AddressProofPart, value: string): void {
    setValues((current) => ({
      ...current,
      residency_address: { ...current.residency_address, [part]: value },
    }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const issues = validateRegistrationValues(values, target)
    if (issues.length > 0) {
      // A client-side rejection replaces any previous server outcome, so the two
      // never render at once and contradict each other.
      registration.reset()
      setPartition(partitionRegistrationIssues(issues, inputs))
      return
    }
    setPartition(NO_ISSUES)
    registration.mutate(values)
  }

  /**
   * The identity, violation-message and accessible-description props of one
   * registered input.
   *
   * The element id is the one `forms/violations.ts` derives from the path, which
   * is also what its focus lookup queries for — so registering an input and being
   * focusable as that input are the same fact.
   */
  function fieldProps(input: RenderedInput): {
    readonly id: string
    readonly error?: ReactNode
    readonly 'aria-invalid'?: true
    readonly 'aria-describedby'?: string
  } {
    const placed = messages.for(input.path)
    if (placed.length === 0) {
      return { id: inputElementId(input) }
    }
    const { inputProps } = describeField(input)
    return {
      ...inputProps,
      error: (
        <span id={violationMessageId(input)} data-testid={`violation-${inputElementId(input)}`}>
          {placed.join(' ')}
        </span>
      ),
    }
  }

  const proofTypeInput: RenderedInput = { path: 'residency_proof_type' }
  const proofValueInput: RenderedInput = { path: 'residency_proof_value' }
  const proofType = values.residency_proof_type

  return (
    <form onSubmit={handleSubmit} noValidate data-testid="registration-form">
      <Stack gap="md">
        {/*
         * AC2: the role is rendered, never offered. There is no control here and
         * no form value to hold one.
         */}
        <Stack gap={2} data-testid="registration-role">
          <Text size="sm" c="dimmed">
            {t('registration:field.role')}
          </Text>
          <Text fw={600}>{t(`shell:context.${role}`)}</Text>
          <Text size="sm" c="dimmed">
            {t(`registration:roleNotice.${role}`)}
          </Text>
        </Stack>

        <TextInput
          {...fieldProps({ path: 'full_name' })}
          label={t('registration:field.fullName')}
          autoComplete="name"
          withAsterisk
          maxLength={BOUNDS.registration.fullName.maxLength}
          value={values.full_name}
          onChange={(event) => {
            update({ full_name: event.currentTarget.value })
          }}
        />

        <TextInput
          {...fieldProps({ path: 'email' })}
          label={t('registration:field.email')}
          type="email"
          inputMode="email"
          autoComplete="email"
          withAsterisk
          value={values.email}
          onChange={(event) => {
            update({ email: event.currentTarget.value })
          }}
        />

        <PasswordInput
          {...fieldProps({ path: 'password' })}
          label={t('registration:field.password')}
          description={t('registration:field.passwordHint', {
            minLength: BOUNDS.password.minCodePoints,
          })}
          autoComplete="new-password"
          withAsterisk
          value={values.password}
          onChange={(event) => {
            update({ password: event.currentTarget.value })
          }}
        />

        {/*
         * Native selects, like the login screen's role control: keyboard-operable
         * by construction (Req 20 AC2) and labelled from the catalogue (Req 20
         * AC5). Neither offers an empty option — both members are required and
         * both start at a declared value, so there is no "unchosen" state to
         * report.
         */}
        <NativeSelect
          {...fieldProps({ path: 'language_preference' })}
          name="language_preference"
          label={t('registration:field.languagePreference')}
          withAsterisk
          data={LOCALE_VALUES.values.map((value) => ({
            value,
            label: t(`shell:locale.${value}`),
          }))}
          value={values.language_preference}
          onChange={(event) => {
            const value = event.currentTarget.value
            if (LOCALE_VALUES.includes(value)) {
              update({ language_preference: value })
            }
          }}
        />

        <NativeSelect
          {...fieldProps(proofTypeInput)}
          name="residency_proof_type"
          label={t('registration:field.residencyProofType')}
          withAsterisk
          data={RESIDENCY_PROOF_TYPE_VALUES.values.map((value) => ({
            value,
            label: t(`registration:proofType.${value}`),
          }))}
          value={proofType}
          onChange={(event) => {
            const value = event.currentTarget.value
            if (RESIDENCY_PROOF_TYPE_VALUES.includes(value)) {
              update({ residency_proof_type: value })
            }
          }}
        />

        {isAddressProof(proofType) ? (
          /* AC5: street, number, city and country as separate inputs. */
          <Fieldset legend={t('registration:addressLegend')} data-testid="registration-address">
            <Stack gap="sm">
              <Text size="sm" c="dimmed">
                {t('registration:proofHint.Address')}
              </Text>
              {ADDRESS_PROOF_PARTS.map((part) => (
                <TextInput
                  key={part}
                  {...fieldProps({ path: addressPartPath(part) })}
                  label={t(`registration:field.${part}`)}
                  withAsterisk={part !== 'number'}
                  {...(part === 'number'
                    ? { description: t('registration:field.numberHint') }
                    : {})}
                  autoComplete={ADDRESS_PART_AUTOCOMPLETE[part]}
                  value={values.residency_address[part]}
                  onChange={(event) => {
                    updateAddressPart(part, event.currentTarget.value)
                  }}
                />
              ))}
            </Stack>
          </Fieldset>
        ) : (
          <TextInput
            {...fieldProps(proofValueInput)}
            label={t(`registration:proofType.${proofType}`)}
            description={t(`registration:proofHint.${proofType}`)}
            withAsterisk
            maxLength={BOUNDS.registration.residencyProofValue.maxLength}
            value={values.residency_proof_value}
            onChange={(event) => {
              update({ residency_proof_value: event.currentTarget.value })
            }}
          />
        )}

        {/* Req 22 AC10: violations addressing no rendered input, plus the summary. */}
        {messages.total === 0 ? null : (
          <Alert
            role="alert"
            color="red"
            id={FORM_LEVEL_REGION_ID}
            title={t('registration:invalid.title')}
            data-testid="registration-form-violations"
          >
            <Stack gap={4}>
              <Text size="sm">{t('registration:invalid.body')}</Text>
              {messages.formLevel.map((message, index) => (
                <Text key={`${index}-${message}`} size="sm">
                  {message}
                </Text>
              ))}
            </Stack>
          </Alert>
        )}

        {/*
         * AC13: one fixed sentence naming the email-address conflict. The
         * envelope's own message and details are deliberately not rendered, so no
         * other account detail can reach the screen.
         */}
        {failure === 'emailConflict' ? (
          <Alert role="alert" color="red" data-testid="registration-email-conflict">
            {t('registration:emailConflict')}
          </Alert>
        ) : null}

        {failure === 'other' ? (
          <ErrorPresenter error={registration.error} title={t('registration:failed')} />
        ) : null}

        <Button type="submit" loading={registration.isPending} data-testid="registration-submit">
          {registration.isPending ? t('registration:submitting') : t('registration:submit')}
        </Button>

        {/* Req 20 AC7: the outcome is announced without moving focus. */}
        <LiveAnnouncement
          message={
            failure === 'emailConflict'
              ? t('registration:emailConflict')
              : messages.total > 0
                ? t('registration:invalid.title')
                : failure === 'other'
                  ? t('registration:failed')
                  : null
          }
          assertive
        />
      </Stack>
    </form>
  )
}
