/**
 * The Verification_Code entry screen (Requirement 6 AC9, AC10, AC11, AC12).
 *
 * | criterion | here |
 * | --- | --- |
 * | AC9 collect exactly 6 digits, submit them with the retained account identifier | the code input, `validateVerificationValues`, `submitVerificationCode` |
 * | AC10 on 200 navigate to the Status_Notice | `navigate(STATUS_NOTICE_PATH)` in `verify.onSuccess` |
 * | AC11 `code_entry_locked` disables the input and presents only the resend control | the `locked` state below |
 * | AC12 the resend control calls `POST /verify/resend`; a 204 re-enables the input and clears the code | `resend.onSuccess` |
 *
 * ## Where the account identifier comes from
 *
 * Not from the address and not from storage: the registration screen hands it over
 * in router state and `registrationHandoffFrom` validates it back out — see
 * `verificationHandoff.ts` for why that is the only carrier. A reload or a direct
 * visit therefore arrives with nothing, and the screen says so instead of posting
 * a malformed body. That is not a degradation to work around: without an
 * identifier there is no account this screen could verify, and guessing one would
 * be asking a stranger's account to accept a code.
 *
 * ## Why the lock is its own state rather than a read of the last failure
 *
 * AC11 locks the input and AC12 unlocks it, and the two are driven by *different*
 * requests: a refused verification locks, a successful resend unlocks. Deriving
 * the lock from `verify.error` alone would leave it stuck — the resend does not
 * clear another mutation's error — so the lock is one boolean that the
 * verification sets and the resend clears. While it is set the submit control is
 * not rendered at all, which is what "present only the resend control" means: not
 * a disabled submit sitting next to the resend, but no submit.
 *
 * ## After a successful verification
 *
 * The Status_Notice is a guarded Onboarding_Screen and the registrant still has no
 * session, so the Route_Guard redirects them to the login screen retaining
 * `/status` as the requested location (Requirement 8 AC2). That is the honest
 * sequence: the account is now `PendingApproval` and signing in is what surfaces
 * it. This screen navigates to the destination AC10 names and decides nothing
 * about access.
 *
 * Requirements: 6.9, 6.10, 6.11, 6.12.
 */

import { Alert, Button, Container, Group, Stack, Text, TextInput, Title } from '@mantine/core'
import { useMutation } from '@tanstack/react-query'
import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

import { isApiFailure } from '../../api/client'
import { ErrorPresenter, LiveAnnouncement } from '../../errors/ErrorPresenter'
import { BOUNDS } from '../../forms/validators'
import {
  describeField,
  FORM_LEVEL_REGION_ID,
  inputElementId,
  useViolationFocus,
  violationMessageId,
  type RenderedInput,
} from '../../forms/violations'
import { STATUS_NOTICE_PATH } from '../../routing/paths'
import { useApiClient } from '../../shell/appServices'

import {
  localizeIssuePartition,
  NO_ISSUES,
  partitionRegistrationIssues,
  type RegistrationIssuePartition,
} from './registrationMessages'
import { registrationHandoffFrom } from './verificationHandoff'
import {
  isCodeEntryLocked,
  resendVerificationCode,
  submitVerificationCode,
  validateVerificationValues,
  CODE_ENTRY_LOCKED_ERROR_KEY,
  VERIFICATION_INPUTS,
} from './verifyCode'

/** Namespaces this screen resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['registration', 'shell', 'errors', 'validation'] as const

/** The single input the screen renders (AC9). */
const CODE_INPUT: RenderedInput = VERIFICATION_INPUTS[0] ?? { path: 'code' }

/**
 * The surface for an arrival that carried no account identifier.
 *
 * A reload, a bookmark or a direct visit. Nothing is echoed back and no code
 * input is rendered — not a disabled one — because there is no account to submit
 * one against.
 */
function NoAccountNotice() {
  const { t } = useTranslation(NAMESPACES)
  return (
    <Stack gap="xs" role="alert" data-testid="verification-no-account">
      <Title order={2} size="h4">
        {t('registration:verification.noAccount.title')}
      </Title>
      <Text>{t('registration:verification.noAccount.body')}</Text>
    </Stack>
  )
}

/** The `/verify` screen. */
export function VerificationScreen() {
  const { t, i18n } = useTranslation(NAMESPACES)
  const api = useApiClient()
  const navigate = useNavigate()
  const location = useLocation()

  // Validated rather than trusted: any code can navigate with any router state.
  const handoff = useMemo(() => registrationHandoffFrom(location.state), [location.state])
  const accountId = handoff?.accountId ?? null

  const [code, setCode] = useState('')
  /** AC11 sets this, AC12 clears it. */
  const [locked, setLocked] = useState(false)
  const [partition, setPartition] = useState<RegistrationIssuePartition>(NO_ISSUES)
  const [resent, setResent] = useState(false)

  // Req 20 AC6: focus moves to the first affected input of a new partition.
  useViolationFocus(partition)
  const messages = localizeIssuePartition(i18n, partition)

  const verify = useMutation({
    mutationFn: (submitted: string) => {
      if (accountId === null) {
        // Unreachable: the form is not rendered without an identifier. Rejecting
        // rather than posting keeps that true even if the guard above changes.
        return Promise.reject(new Error('no retained account identifier'))
      }
      return submitVerificationCode(api, accountId, submitted)
    },
    onSuccess: () => {
      // AC10. The entry is replaced so the browser's back button cannot return to
      // a form whose code has already been consumed.
      void navigate(STATUS_NOTICE_PATH, { replace: true })
    },
    onError: (error: unknown) => {
      // AC11: the one outcome that changes what the screen offers.
      if (isCodeEntryLocked(error)) {
        setLocked(true)
      }
      // Req 22 AC9–AC11: place the reported violations; the entered code is kept.
      setPartition(
        isApiFailure(error) ? partitionRegistrationIssues(error.fieldViolations, VERIFICATION_INPUTS) : NO_ISSUES,
      )
    },
  })

  const resend = useMutation({
    mutationFn: () => {
      if (accountId === null) {
        return Promise.reject(new Error('no retained account identifier'))
      }
      return resendVerificationCode(api, accountId)
    },
    onSuccess: () => {
      // AC12: the 204 re-enables the input and clears what was entered. The
      // previous code is dead on the Backend_Api, so leaving it on screen would
      // only invite resubmitting it.
      setLocked(false)
      setCode('')
      setPartition(NO_ISSUES)
      verify.reset()
      setResent(true)
    },
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (locked) {
      return
    }
    setResent(false)
    const issues = validateVerificationValues(code)
    if (issues.length > 0) {
      // A client-side rejection replaces any previous server outcome, so the two
      // never render at once and contradict each other.
      verify.reset()
      setPartition(partitionRegistrationIssues(issues, VERIFICATION_INPUTS))
      return
    }
    setPartition(NO_ISSUES)
    verify.mutate(code)
  }

  /**
   * Identity, messages and accessible description of the code input (Req 20 AC6).
   *
   * The messages go through Mantine's own error slot rather than a sibling element
   * spread with `aria-invalid`/`aria-describedby`: `Input` applies its own aria
   * attributes after the caller's, so those passed as rest props are dropped.
   * Supplying `error` sets `aria-invalid`, and `errorProps.id` points the
   * generated `aria-describedby` at the id `forms/violations.ts` derived — the
   * same id the focus helper resolves.
   */
  function codeFieldProps() {
    const placed = messages.for(CODE_INPUT.path)
    const { inputId } = describeField(CODE_INPUT)
    if (placed.length === 0) {
      return { id: inputId }
    }
    return {
      id: inputId,
      error: placed.join(' '),
      errorProps: {
        id: violationMessageId(CODE_INPUT),
        'data-testid': `violation-${inputElementId(CODE_INPUT)}`,
      },
    }
  }

  /** Everything that is not the lock: a wrong code, an expired one, a 5xx. */
  const otherFailure = verify.error !== null && !isCodeEntryLocked(verify.error)

  /** The announcement for the current outcome (Req 20 AC7). */
  const announcement = locked
    ? t(`errors:${CODE_ENTRY_LOCKED_ERROR_KEY}`)
    : resent
      ? t('registration:verification.resent')
      : messages.total > 0
        ? t('registration:verification.invalid.title')
        : otherFailure
          ? t('registration:verification.failed')
          : null

  return (
    <Container size="xs" py="md" data-testid="verification-screen">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('registration:verification.title')}
          </Title>
          <Text c="dimmed">{t('registration:verification.description')}</Text>
        </Stack>

        {accountId === null ? (
          <NoAccountNotice />
        ) : (
          <>
            <form onSubmit={handleSubmit} noValidate data-testid="verification-form">
              <Stack gap="sm">
                <TextInput
                  {...codeFieldProps()}
                  name="code"
                  label={t('registration:verification.field.code')}
                  description={t('registration:verification.field.codeHint', {
                    length: BOUNDS.code.length,
                  })}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  withAsterisk
                  maxLength={BOUNDS.code.length}
                  // AC11: the input is disabled while entry is locked.
                  disabled={locked}
                  value={code}
                  onChange={(event) => {
                    setResent(false)
                    setCode(event.currentTarget.value)
                  }}
                />

                {/* Req 22 AC10: violations addressing no rendered input. */}
                {messages.formLevel.length === 0 ? null : (
                  <Alert
                    role="alert"
                    variant="light"
                    color="red"
                    withCloseButton={false}
                    id={FORM_LEVEL_REGION_ID}
                    title={t('registration:verification.invalid.title')}
                    data-testid="verification-form-violations"
                  >
                    <Stack gap={2}>
                      {messages.formLevel.map((message, index) => (
                        <Text key={`${index}-${message}`} size="sm">
                          {message}
                        </Text>
                      ))}
                    </Stack>
                  </Alert>
                )}

                <Group gap="sm">
                  {/*
                   * AC11: while entry is locked the resend control is the only one
                   * presented — the submit control is absent, not disabled.
                   */}
                  {locked ? null : (
                    <Button
                      type="submit"
                      loading={verify.isPending}
                      aria-busy={verify.isPending}
                      data-testid="verification-submit"
                    >
                      {verify.isPending
                        ? t('registration:verification.submitting')
                        : t('registration:verification.submit')}
                    </Button>
                  )}

                  {/* AC12. `type="button"` so it never submits the code alongside. */}
                  <Button
                    type="button"
                    variant="default"
                    loading={resend.isPending}
                    aria-busy={resend.isPending}
                    onClick={() => {
                      resend.mutate()
                    }}
                    data-testid="verification-resend"
                  >
                    {resend.isPending
                      ? t('registration:verification.resending')
                      : t('registration:verification.resend')}
                  </Button>
                </Group>
              </Stack>
            </form>

            {/*
             * AC11: the localized catalogue entry for the `error` member, which is
             * also the instruction to use the resend control (Req 21 AC1).
             */}
            {locked ? (
              <ErrorPresenter
                error={verify.error}
                title={t('registration:verification.lockedTitle')}
              />
            ) : null}

            {/* A wrong code, an expired one, a 429, a 5xx (Req 21 AC1, AC2). */}
            {otherFailure ? (
              <ErrorPresenter error={verify.error} title={t('registration:verification.failed')} />
            ) : null}

            {resend.error !== null ? (
              <ErrorPresenter
                error={resend.error}
                title={t('registration:verification.resendFailed')}
              />
            ) : null}

            {/* AC12: the new code is on its way, announced without moving focus. */}
            {resent ? (
              <Alert
                role="status"
                variant="light"
                color="green"
                withCloseButton={false}
                data-testid="verification-resent"
              >
                {t('registration:verification.resent')}
              </Alert>
            ) : null}
          </>
        )}

        <LiveAnnouncement message={announcement} assertive={!resent} />
      </Stack>
    </Container>
  )
}
