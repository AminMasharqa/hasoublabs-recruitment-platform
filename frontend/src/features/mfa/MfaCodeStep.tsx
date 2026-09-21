/**
 * The multi-factor code step of the login screen (Requirement 5 AC1, AC2, AC3).
 *
 * | criterion | here |
 * | --- | --- |
 * | AC1 collect a 6-digit code and resubmit `POST /auth/login` with the credentials and the code | the input below, `mfaLoginRequestBody` |
 * | AC2 the input is constrained to exactly 6 digits before submission | `sanitizeMfaCodeInput`, `validateMfaCodeValues` |
 * | AC3 an invalid code retains the step, clears the input and renders the localized message | `code-refused` branch of `submit` |
 *
 * ## Who owns what
 *
 * The step owns the resubmission, because the code is the only value it adds and
 * everything about the request is then in one place. It does **not** own the
 * session: a 200 is handed to `onAuthenticated`, and the login screen does with it
 * exactly what it does with a 200 from the first submission — hand the pair to the
 * Session_Manager and navigate to the landing destination of the decoded
 * Active_Context (Requirement 4 AC2). So there is no second copy of that logic, and
 * no token is held by this component.
 *
 * The credentials arrive as a prop rather than being read back off the envelope:
 * the Backend_Api's `mfa_required` answer carries none, and the ones to resubmit are
 * the ones the login form still holds (Requirement 5 AC1).
 *
 * ## What keeps the step, and what leaves it
 *
 * | outcome | effect |
 * | --- | --- |
 * | 200 | `onAuthenticated`; the step is done |
 * | `invalid_mfa_code` / `mfa_required` | the step stays, the input is cleared, the localized message is rendered (AC3) |
 * | any other 401 or 403 | `onRejected`; the credentials themselves are no longer accepted, so the screen returns to them with the uniform non-disclosing rejection (Req 4 AC12) |
 * | anything else — 422, 429, 5xx, timeout | the step stays and renders the ordinary localized surface with its Support_Reference (Req 21 AC1, AC2); a reported violation is placed back onto the code input (Req 22 AC9–AC11) |
 *
 * A 5xx deliberately does not abandon the step: the code is still valid for its
 * time window, and throwing the user back to the credentials form would cost them
 * a code for a failure that had nothing to do with it.
 *
 * ## Messages go through Mantine's error slot
 *
 * As on the login screen: `Input` applies its own
 * `aria-invalid`/`aria-describedby`/`id` after spreading the caller's props, so
 * those three cannot be passed as rest props. Supplying `error` sets
 * `aria-invalid`, and `errorProps.id` is what makes the generated
 * `aria-describedby` point at the id `forms/violations.ts` derived — the same id
 * `useViolationFocus` resolves (Requirement 20 AC6).
 *
 * Requirements: 5.1, 5.2, 5.3, 20.6, 20.7, 21.1, 21.2, 22.9, 22.10, 22.11.
 */

import { Alert, Button, Paper, Stack, Text, TextInput, Title } from '@mantine/core'
import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { isApiFailure } from '../../api/client'
import { ErrorPresenter, LiveAnnouncement } from '../../errors/ErrorPresenter'
import {
  describeField,
  EMPTY_PARTITION,
  partitionViolations,
  useViolationFocus,
  type PlaceableIssue,
  type RenderedInput,
  type ViolationPartition,
} from '../../forms/violations'
import type { TokenResponseLike } from '../../session/SessionManager'
import { useApiClient } from '../../shell/appServices'
// From the modules, not the barrel: see the note in `mfaChallenge.ts`.
import { issueMessage, type Translate } from '../auth/loginForm'
import type { LoginCredentials } from '../auth/loginOutcome'

import {
  classifyMfaSubmission,
  EMPTY_MFA_CODE_VALUES,
  isSubmittableMfaCode,
  MFA_CODE_INPUTS,
  MFA_CODE_LENGTH,
  MFA_LOGIN_CONTRACT_PATH,
  mfaLoginRequestBody,
  sanitizeMfaCodeInput,
  validateMfaCodeValues,
  type MfaCodeValues,
  type MfaSubmissionOutcome,
} from './mfaChallenge'

/** Namespaces the step resolves its strings against (Requirement 19 AC2). */
const NAMESPACES = ['auth', 'shell', 'errors', 'validation'] as const

/** The violations of one submission, from either source. */
type CodeViolations = ViolationPartition<PlaceableIssue, RenderedInput>

export interface MfaCodeStepProps {
  /** The credentials to resubmit alongside the code (AC1). */
  readonly credentials: LoginCredentials
  /** A 200: the token pair, handed on for the session to be established. */
  readonly onAuthenticated: (response: TokenResponseLike) => void | Promise<void>
  /**
   * The credentials are no longer accepted (a 401 or 403 that is not about the
   * code), so the step closes and the screen renders its uniform rejection
   * (Requirement 4 AC12).
   */
  readonly onRejected: () => void
}

function fieldIssues(partition: CodeViolations, input: RenderedInput): readonly PlaceableIssue[] {
  return partition.fields.find((placement) => placement.input === input)?.violations ?? []
}

/** Every message of one input, as the single string Mantine's error slot renders. */
function fieldMessage(issues: readonly PlaceableIssue[], translate: Translate): string {
  return issues.map((issue) => issueMessage(translate, issue)).join(' ')
}

/** The 6-digit code step (AC1–AC3). */
export function MfaCodeStep({ credentials, onAuthenticated, onRejected }: MfaCodeStepProps) {
  const { t } = useTranslation(NAMESPACES)
  const api = useApiClient()

  const [values, setValues] = useState<MfaCodeValues>(EMPTY_MFA_CODE_VALUES)
  const [submitting, setSubmitting] = useState(false)
  const [outcome, setOutcome] = useState<MfaSubmissionOutcome | null>(null)
  const [violations, setViolations] = useState<CodeViolations>(EMPTY_PARTITION)

  // Req 20 AC6: a new failed submission moves focus to the affected input.
  useViolationFocus(violations)

  const translate = useMemo<Translate>(
    () => (key, params) => t(key, { ...params }) as unknown as string,
    [t],
  )

  const [codeInput] = MFA_CODE_INPUTS as readonly [RenderedInput]
  const { inputId, messageId } = describeField(codeInput)
  const issues = fieldIssues(violations, codeInput)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting) {
      return
    }

    // AC2: the shape rule is applied before the request is issued. The input can
    // only hold digits, so this catches the incomplete code rather than a stray
    // character.
    const entered = validateMfaCodeValues(values)
    if (entered.length > 0) {
      setOutcome(null)
      setViolations(partitionViolations<PlaceableIssue, RenderedInput>(entered, MFA_CODE_INPUTS))
      return
    }

    setSubmitting(true)
    setOutcome(null)
    setViolations(EMPTY_PARTITION)
    try {
      // AC1: the email address, the password, the role and the collected code.
      const { data } = await api.request('post', MFA_LOGIN_CONTRACT_PATH, {
        body: mfaLoginRequestBody(credentials, values.mfa_code),
      })
      await onAuthenticated(data)
      return
    } catch (thrown) {
      const classified = classifyMfaSubmission(thrown)
      if (classified.kind === 'rejected') {
        // The credentials, not the code: the screen returns to them.
        onRejected()
        return
      }
      setOutcome(classified)
      if (classified.kind === 'code-refused') {
        // AC3: the step is retained and the input is cleared.
        setValues(EMPTY_MFA_CODE_VALUES)
        return
      }
      if (isApiFailure(thrown)) {
        // Req 22 AC9–AC11: every reported violation placed, entered value kept.
        setViolations(
          partitionViolations<PlaceableIssue, RenderedInput>(thrown.fieldViolations, MFA_CODE_INPUTS),
        )
      }
    } finally {
      setSubmitting(false)
    }
  }

  /** The announcement of the current outcome (Req 20 AC7). */
  const announcement =
    outcome === null
      ? violations.placedCount > 0
        ? t('auth:mfa.codeIncomplete', { length: MFA_CODE_LENGTH })
        : null
      : outcome.kind === 'code-refused'
        ? t(`errors:${outcome.errorKey}`)
        : t('shell:state.errorTitle')

  return (
    <Paper withBorder p="md" data-testid="mfa-code-step">
      <form onSubmit={(event) => void submit(event)} noValidate data-testid="mfa-code-form">
        <Stack gap="sm">
          <Stack gap={2}>
            <Title order={2} size="h5">
              {t('auth:mfa.title')}
            </Title>
            <Text size="sm" c="dimmed">
              {t('auth:mfa.description', { length: MFA_CODE_LENGTH })}
            </Text>
          </Stack>

          {/*
           * AC2: the value is constrained on entry — six ASCII digits at most, with
           * everything else dropped — so an incomplete code is the only shape the
           * validator has left to report. `inputMode="numeric"` brings up a numeric
           * keypad without making the field a spinner, and `autoComplete="one-time-code"`
           * lets the platform offer a code it has already received.
           */}
          <TextInput
            id={inputId}
            {...(issues.length === 0
              ? {}
              : {
                  error: fieldMessage(issues, translate),
                  errorProps: { id: messageId, 'data-testid': `${inputId}-violation` },
                })}
            name="mfa_code"
            label={t('auth:mfa.code')}
            description={t('auth:mfa.codeHint', { length: MFA_CODE_LENGTH })}
            value={values.mfa_code}
            onChange={(event) => {
              setValues({ mfa_code: sanitizeMfaCodeInput(event.currentTarget.value) })
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={MFA_CODE_LENGTH}
            data-testid="mfa-code-input"
          />

          {/* Req 22 AC10: violations addressing no input the step renders. */}
          {violations.formLevel.length === 0 ? null : (
            <Alert
              role="alert"
              variant="light"
              color="red"
              withCloseButton={false}
              title={t('auth:mfa.formErrors')}
              data-testid="mfa-code-form-violations"
            >
              <Stack gap={2}>
                {violations.formLevel.map((issue, index) => (
                  <Text key={`${issue.path}-${index}`} size="sm">
                    {issueMessage(translate, issue)}
                  </Text>
                ))}
              </Stack>
            </Alert>
          )}

          <Button
            type="submit"
            loading={submitting}
            aria-busy={submitting}
            disabled={!isSubmittableMfaCode(values.mfa_code)}
            data-testid="mfa-code-submit"
          >
            {t('auth:mfa.submit')}
          </Button>

          {/* AC3: the localized message of the envelope the Backend_Api sent. */}
          {outcome?.kind === 'code-refused' ? (
            <Alert
              role="alert"
              variant="light"
              color="red"
              withCloseButton={false}
              data-testid="mfa-code-refused"
            >
              {t(`errors:${outcome.errorKey}`)}
            </Alert>
          ) : null}

          {/* Everything that is neither a 200, a refused code nor a refused login. */}
          {outcome?.kind === 'failed' ? <ErrorPresenter error={outcome.failure} /> : null}

          <LiveAnnouncement message={announcement} assertive={outcome !== null} />
        </Stack>
      </form>
    </Paper>
  )
}
