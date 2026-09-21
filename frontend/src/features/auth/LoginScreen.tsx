/**
 * The login screen (Requirement 4 AC1, AC2, AC7, AC12).
 *
 * | criterion | here |
 * | --- | --- |
 * | AC1 collect email, password and a role of `ADMIN`/`CANDIDATE`/`SENIOR`, submit to `POST /auth/login` | the three inputs below, `LOGIN_CONTRACT_PATH` |
 * | AC2 on 200 store both tokens and land on the Active_Context destination | `establishSession(tokenPairFrom(data))` then `postLoginPath` |
 * | AC7 a session that expired arrives here with a notice | `wasSessionExpired(location.state)`, `useSessionExpired()` |
 * | AC12 a 401 or a 403 discloses nothing about the account | {@link LoginRejectedNotice} |
 *
 * ## AC2 is delegated, not re-implemented
 *
 * "Store the returned tokens, decode the claims, redirect to the landing
 * destination for the decoded Active_Context" is three obligations this component
 * performs none of itself. `establishSession` hands the pair to the
 * Session_Manager, which stores both tokens in memory only (AC3), decodes `sub`,
 * `roles`, `act`, `exp` and schedules the proactive refresh (AC4); it returns the
 * decoded principal, and `postLoginPath` turns that principal's `act` into the
 * destination — or into the location the Route_Guard retained when it sent an
 * unauthenticated navigation here (Req 8 AC2, AC11). So there is no second copy of
 * the landing table, and no token is ever held by a component.
 *
 * The retained Account_Status of Requirement 7 AC1 is read by the Route_Guard on
 * the destination, not here: an account that is not yet `Approved` is redirected
 * from there to the Status_Notice, which is why this screen navigates to the
 * landing destination unconditionally.
 *
 * ## Why the rejection surface takes no props
 *
 * Requirement 4 AC12 forbids the rendered outcome of a refused login from
 * disclosing whether the submitted address belongs to an account. The Backend_Api
 * *does* distinguish the cases — `authentication_required` on a 401 for wrong
 * credentials or no such account, `account_not_approved` on a 403 for an account
 * awaiting approval — so `classifyLoginFailure` collapses both to one memberless
 * value and {@link LoginRejectedNotice} accepts no parameters. There is no channel
 * through which a status code, an `error` key, a `details` member or a
 * Support_Reference could reach the surface, so the compiler forbids the variation
 * rather than a reviewer having to spot it. This mirrors
 * `AuthorizationDeniedNotice` in the Error_Presenter, which is uniform for the
 * same reason.
 *
 * A 422, a 429, a 5xx and a timeout say nothing about the account, so those keep
 * the ordinary localized surfaces (Req 21 AC1, AC2) and their 422 violations are
 * placed back onto the inputs (Req 22 AC9–AC11).
 *
 * ## Messages go through Mantine's error slot, not a sibling element
 *
 * `Input` applies its own `aria-invalid`/`aria-describedby`/`id` *after* spreading
 * the caller's props, so those three attributes cannot be passed as rest props —
 * they are silently dropped, and the association Requirement 20 AC6 requires
 * disappears without any visible sign. Supplying `error` is what sets
 * `aria-invalid`, and `errorProps.id` is what makes the generated
 * `aria-describedby` point at the id `forms/violations.ts` derived, which is the
 * same id `useViolationFocus` resolves.
 *
 * ## The multi-factor step
 *
 * `mfa_required` arrives as a 401, and Requirement 5 AC1 requires a code-entry step
 * for it — the one outcome that stays distinguishable. This screen hands the
 * collected credentials to `MfaCodeStep` (`features/mfa`), which resubmits them
 * with the code; the credential form is not rendered while the step is, so the
 * screen presents one step at a time. Two things come back here: a 200, so
 * `completeLogin` establishes the session in exactly one place, and a 401 or 403
 * that is not about the code, which closes the step and leaves the uniform
 * non-disclosing rejection of AC12 on screen. An invalid code never reaches here —
 * Requirement 5 AC3 keeps it in the step.
 *
 * Requirements: 4.1, 4.2, 4.12, 5.1.
 */

import { Alert, Button, Container, NativeSelect, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core'
import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

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
import { postLoginPath } from '../../routing/paths'
import { clearSessionEnd, useSessionExpired } from '../../session/sessionEndNotice'
import { tokenPairFrom, type TokenResponseLike } from '../../session/SessionManager'
import { useSession } from '../../session/sessionState'
import { useApiClient } from '../../shell/appServices'
import { wasSessionExpired } from '../../shell/appRuntime'
// The code step of Requirement 5 AC1–AC3. Imported from its module rather than
// through `features/mfa/index.ts` so the two slices' entry points stay acyclic.
import { MfaCodeStep } from '../mfa/MfaCodeStep'

import {
  EMPTY_LOGIN_VALUES,
  issueMessage,
  LOGIN_INPUTS,
  LOGIN_ROLES,
  loginRole,
  validateLoginValues,
  type LoginFormValues,
  type Translate,
} from './loginForm'
import {
  classifyLoginFailure,
  LOGIN_CONTRACT_PATH,
  LOGIN_REJECTED,
  loginRequestBody,
  MFA_REQUIRED_ERROR_KEY,
  type LoginCredentials,
  type LoginOutcome,
} from './loginOutcome'

/** Namespaces the screen resolves its strings against (Requirement 19 AC2). */
const NAMESPACES = ['auth', 'shell', 'errors', 'validation'] as const

/** The violations of one submission, from either source. */
type LoginViolations = ViolationPartition<PlaceableIssue, RenderedInput>

/**
 * DOM id of the rejection surface.
 *
 * Fixed rather than generated: Mantine mints a random id per mount for the
 * `aria-describedby` of an `Alert` body, and a rendered difference — even one
 * confined to an opaque identifier — makes the two refusals of AC12
 * distinguishable in the markup and unassertable as identical.
 */
const LOGIN_REJECTED_ELEMENT_ID = 'login-rejected'

/**
 * The one surface a refused login renders (AC12).
 *
 * Takes no props, so it cannot be told which of the refusals occurred and cannot
 * be given a Support_Reference, a status code or a per-resource action. The text is
 * one constant catalogue entry, identical for a 401 and a 403 and independent of
 * whether the address belongs to an account.
 *
 * Deliberately built from `Alert` with an explicit `role="alert"` and no
 * `withCloseButton`, so the refusal is announced without moving focus (Req 20 AC7)
 * and the entered values stay exactly where they are (Req 22 AC11).
 */
function LoginRejectedNotice() {
  const { t } = useTranslation(NAMESPACES)

  return (
    <Alert
      id={LOGIN_REJECTED_ELEMENT_ID}
      role="alert"
      variant="light"
      color="red"
      withCloseButton={false}
      data-testid={LOGIN_REJECTED_ELEMENT_ID}
    >
      {t('auth:login.rejected')}
    </Alert>
  )
}

function fieldIssues(partition: LoginViolations, input: RenderedInput): readonly PlaceableIssue[] {
  return partition.fields.find((placement) => placement.input === input)?.violations ?? []
}

/**
 * The messages of one input, as the single text Mantine renders in its error slot.
 *
 * One string rather than a list of nodes because the slot is a `<p>`: block-level
 * children there are invalid markup. Every reported issue is included, so nothing
 * placed on this input is dropped (Req 22 AC9).
 */
function fieldMessage(issues: readonly PlaceableIssue[], translate: Translate): string {
  return issues.map((issue) => issueMessage(translate, issue)).join(' ')
}

/**
 * The `/login` screen.
 *
 * Registered by the shell through the route `elements` table for the `login` path
 * id; it holds no route knowledge of its own beyond reading the location state the
 * Route_Guard and the Session_Manager attach.
 */
export function LoginScreen() {
  const { t } = useTranslation(NAMESPACES)
  const api = useApiClient()
  const { establishSession } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const endedAsExpired = useSessionExpired()

  const [values, setValues] = useState<LoginFormValues>(EMPTY_LOGIN_VALUES)
  const [submitting, setSubmitting] = useState(false)
  const [outcome, setOutcome] = useState<LoginOutcome | null>(null)
  const [violations, setViolations] = useState<LoginViolations>(EMPTY_PARTITION)
  /**
   * The credentials the multi-factor step resubmits with a code (Req 5 AC1).
   *
   * Set when the Backend_Api answers `mfa_required`, and the only thing that puts
   * the screen into the code-entry step. The values stay in the form state too, so
   * returning from the step leaves the entered address and role where they were.
   */
  const [challenge, setChallenge] = useState<LoginCredentials | null>(null)

  // Req 20 AC6: a new failed submission produces a new partition, and focus moves
  // to the first affected input. A form-level-only failure leaves focus alone.
  useViolationFocus(violations)

  const translate = useMemo<Translate>(
    () => (key, params) => t(key, { ...params }) as unknown as string,
    [t],
  )

  /**
   * Req 4 AC7: a session that expired lands here with its reason.
   *
   * Two sources for one fact, because a session that ended on a *guarded* screen
   * produces a second redirect that replaces the router state with the retained
   * location — see `session/sessionEndNotice.ts`. Either source is sufficient; a
   * direct visit has neither and shows no notice.
   */
  const sessionExpired = wasSessionExpired(location.state) || endedAsExpired

  const update = (field: keyof LoginFormValues) => (value: string) => {
    setValues((previous) => ({ ...previous, [field]: value }))
  }

  /**
   * AC2, for both submissions that can produce a 200: the first one and the
   * multi-factor resubmission (Req 5 AC1).
   *
   * The Session_Manager stores both tokens, decodes the claims and schedules the
   * refresh; the principal it returns names the Active_Context to land on. A pair
   * whose Access_Token could not be decoded leaves no session, and
   * `postLoginPath(state, null)` is the login screen — the honest answer.
   */
  const completeLogin = async (response: TokenResponseLike): Promise<void> => {
    const principal = establishSession(tokenPairFrom(response))
    // The new session has not expired, so the notice must not survive into it.
    clearSessionEnd()
    await navigate(postLoginPath(location.state, principal?.act ?? null), { replace: true })
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting) {
      return
    }

    // Client-side rules first (Req 22 AC1). They are an aid only — anything they
    // accept is still submitted for authoritative server validation (AC12).
    const issues = validateLoginValues(values)
    const role = loginRole(values)
    if (issues.length > 0 || role === null) {
      setOutcome(null)
      setViolations(partitionViolations<PlaceableIssue, RenderedInput>(issues, LOGIN_INPUTS))
      return
    }

    const credentials: LoginCredentials = {
      email: values.email,
      password: values.password,
      role,
    }

    setSubmitting(true)
    setOutcome(null)
    setViolations(EMPTY_PARTITION)
    try {
      const { data } = await api.request('post', LOGIN_CONTRACT_PATH, {
        body: loginRequestBody(credentials),
      })

      await completeLogin(data)
      return
    } catch (thrown) {
      // AC12: a 401 and a 403 both become the same memberless rejection here, so
      // nothing downstream can tell them apart.
      const classified = classifyLoginFailure(thrown)
      setOutcome(classified)
      if (classified.kind === 'mfa-required') {
        // Req 5 AC1: the code step resubmits these credentials with the code.
        setChallenge(credentials)
        return
      }
      if (classified.kind === 'failed' && isApiFailure(thrown)) {
        // Req 22 AC9–AC11: every reported violation placed, entered values kept.
        setViolations(
          partitionViolations<PlaceableIssue, RenderedInput>(thrown.fieldViolations, LOGIN_INPUTS),
        )
      }
    } finally {
      setSubmitting(false)
    }
  }

  const [emailInput, passwordInput, roleInput] = LOGIN_INPUTS as readonly [
    RenderedInput,
    RenderedInput,
    RenderedInput,
  ]

  /**
   * Identity, messages and accessible description of one input (Req 20 AC6).
   *
   * The messages go through Mantine's own error slot rather than a sibling element
   * spread with `aria-invalid`/`aria-describedby`: `Input` applies its own aria
   * attributes *after* the caller's, so attributes passed as rest props are
   * silently dropped. Supplying `error` is what sets `aria-invalid`, and
   * `errorProps.id` is what makes the generated `aria-describedby` point at the id
   * `forms/violations.ts` derived — the same id the focus helper resolves, so
   * registering an input and being described by its messages stay one fact.
   */
  const fieldProps = (input: RenderedInput) => {
    const issues = fieldIssues(violations, input)
    const { inputId, messageId } = describeField(input)
    if (issues.length === 0) {
      return { id: inputId }
    }
    return {
      id: inputId,
      error: fieldMessage(issues, translate),
      errorProps: { id: messageId, 'data-testid': `${inputId}-violation` },
    }
  }

  /** The announcement for the current outcome (Req 20 AC7). */
  const announcement =
    outcome === null
      ? violations.placedCount > 0
        ? t('auth:login.formErrors')
        : null
      : outcome.kind === 'rejected'
        ? t('auth:login.rejected')
        : outcome.kind === 'mfa-required'
          ? t(`errors:${MFA_REQUIRED_ERROR_KEY}`)
          : t('shell:state.errorTitle')

  return (
    <Container size="xs" py="md" data-testid="login-screen">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('auth:login.title')}
          </Title>
          <Text c="dimmed">{t('auth:login.description')}</Text>
        </Stack>

        {/* Req 4 AC7: the session-expired notice, announced without moving focus. */}
        {sessionExpired ? (
          <Alert
            role="status"
            variant="light"
            color="yellow"
            withCloseButton={false}
            data-testid="login-session-expired"
          >
            {t('shell:session.expired')}
          </Alert>
        ) : null}

        {/*
         * Req 5 AC1: while a code is being collected the screen *is* the code step,
         * so the credential form is not rendered. The entered values stay in state,
         * which is what the step resubmits and what returning from it restores.
         */}
        {challenge !== null ? null : (
        <form onSubmit={(event) => void submit(event)} noValidate data-testid="login-form">
          <Stack gap="sm">
            <TextInput
              {...fieldProps(emailInput)}
              name="email"
              type="email"
              autoComplete="username"
              label={t('auth:login.email')}
              value={values.email}
              onChange={(event) => update('email')(event.currentTarget.value)}
            />

            <PasswordInput
              {...fieldProps(passwordInput)}
              name="password"
              autoComplete="current-password"
              label={t('auth:login.password')}
              value={values.password}
              onChange={(event) => update('password')(event.currentTarget.value)}
            />

            {/*
             * A native select: keyboard-operable by construction (Req 20 AC2),
             * labelled from the catalogue (Req 20 AC5), and the empty first option
             * is what makes "no role chosen" a reportable violation rather than a
             * silent default.
             */}
            <NativeSelect
              {...fieldProps(roleInput)}
              name="role"
              label={t('auth:login.role')}
              value={values.role}
              data={[
                { value: '', label: t('auth:login.rolePlaceholder') },
                ...LOGIN_ROLES.map((role) => ({
                  value: role,
                  label: t(`shell:context.${role}`),
                })),
              ]}
              onChange={(event) => update('role')(event.currentTarget.value)}
            />

            {/* Req 22 AC10: violations addressing no rendered input. */}
            {violations.formLevel.length === 0 ? null : (
              <Alert
                role="alert"
                variant="light"
                color="red"
                withCloseButton={false}
                title={t('auth:login.formErrors')}
                data-testid="login-form-violations"
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

            <Button type="submit" loading={submitting} aria-busy={submitting} data-testid="login-submit">
              {t('auth:login.submit')}
            </Button>
          </Stack>
        </form>
        )}

        {/* AC12: one surface for a 401 and for a 403, carrying nothing else. */}
        {outcome?.kind === 'rejected' ? <LoginRejectedNotice /> : null}

        {/*
         * Req 5 AC1–AC3: the 6-digit code step, resubmitting the credentials the
         * form collected. It owns the resubmission and the invalid-code handling; a
         * 200 comes back here so the session is established in exactly one place,
         * and a 401 or 403 that is not about the code closes the step and leaves the
         * uniform non-disclosing rejection on screen (AC12).
         */}
        {challenge === null ? null : (
          <>
            <MfaCodeStep
              credentials={challenge}
              onAuthenticated={(response) => completeLogin(response)}
              onRejected={() => {
                setChallenge(null)
                setOutcome(LOGIN_REJECTED)
              }}
            />
            <Button
              type="button"
              variant="subtle"
              onClick={() => {
                setChallenge(null)
                setOutcome(null)
              }}
              data-testid="login-mfa-back"
            >
              {t('auth:mfa.back')}
            </Button>
          </>
        )}

        {/*
         * Everything that is not a 401, a 403 or the multi-factor step: the
         * ordinary localized surface with its Support_Reference (Req 21 AC1, AC2,
         * Req 23 AC1). No retry control — retrying is the user's own resubmission.
         */}
        {outcome?.kind === 'failed' ? <ErrorPresenter error={outcome.failure} /> : null}

        <LiveAnnouncement message={announcement} assertive={outcome !== null} />
      </Stack>
    </Container>
  )
}
