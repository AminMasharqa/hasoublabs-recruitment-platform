/**
 * Admin multi-factor enrolment and verification (Requirement 5 AC4, AC5, AC6).
 *
 * | criterion | here |
 * | --- | --- |
 * | AC4 an enrolment screen calling `POST /auth/mfa/enroll`, rendering `qr_code_png_b64` and `provisioning_uri` as selectable text | {@link MfaEnrolmentPanel}, {@link ProvisioningUri} |
 * | AC5 the image carries a text alternative directing the user to the `provisioning_uri` value | the `alt` of the QR image |
 * | AC6 a verification control submitting a 6-digit code to `POST /auth/mfa/verify`, with a confirmation on a verified outcome | {@link MfaVerifyForm} |
 *
 * ## Why enrolment is a mutation behind an explicit control
 *
 * `POST /auth/mfa/enroll` mints a **new** TOTP secret and replaces the stored one.
 * As a `useQuery` it would be retried on failure and refetched on focus, and each
 * of those would silently invalidate an authenticator entry the Admin had already
 * scanned — the enrolment would then never verify, for no visible reason. So it is
 * a mutation, issued once per activation of the control, and the control says what
 * a second activation costs.
 *
 * ## The text alternative (AC5)
 *
 * A QR code is a rendering of the `provisioning_uri` and nothing else, so its text
 * alternative is not a description of a square pattern: it directs the reader to
 * the URI, which is on screen as selectable text beside it and is the same value
 * the image encodes. Anyone who cannot use the image has the authoritative value
 * without asking for an alternative route (Requirement 20 AC5, AC8).
 *
 * ## The secret is not this panel's to keep
 *
 * The `provisioning_uri` contains the TOTP secret. It is rendered because AC4
 * requires it, and it is never logged (Requirement 3 AC13), never written to the
 * query cache — the enrolment is a mutation with `gcTime: 0` — and discarded when
 * the panel unmounts, the same discipline the Registration_Link token is held
 * under (Requirement 16 AC6).
 *
 * Requirements: 5.4, 5.5, 5.6, 19.2, 20.5, 20.7, 20.8, 21.1.
 */

import {
  Alert,
  Button,
  Code,
  CopyButton,
  Group,
  Image,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorPresenter, LiveAnnouncement } from '../../errors/ErrorPresenter'
import { isApiError } from '../../errors/errorMessages'
import { BidiText } from '../../i18n/DirectionProvider'
import { useApiClient } from '../../shell/appServices'

import {
  MFA_CODE_LENGTH,
  MFA_CODE_REFUSED_ERROR_KEYS,
  isSubmittableMfaCode,
  sanitizeMfaCodeInput,
} from './mfaChallenge'
import {
  qrCodeImageSource,
  startMfaEnrolment,
  verifyMfaCode,
  type MfaEnrolment,
} from './mfaEnrolment'

/** Namespaces the panel resolves its strings against (Requirement 19 AC2). */
const NAMESPACES = ['auth', 'shell', 'errors'] as const

/** How long a copy control reports success before reverting to its label. */
const COPY_FEEDBACK_MS = 2000

/** DOM `id` of the verification code input. */
const VERIFY_INPUT_ID = 'mfa-verify-code'

interface ProvisioningUriProps {
  readonly value: string
}

/**
 * The `provisioning_uri`, as selectable text with a copy control (AC4).
 *
 * Text rather than an input: the value is not being edited, it stays readable to a
 * screen reader and copyable by hand when the clipboard is unavailable, and
 * `BidiText` keeps it byte-identical and bidi-isolated from the Arabic or Hebrew
 * label beside it (Requirement 19 AC10).
 */
function ProvisioningUri({ value }: ProvisioningUriProps) {
  const { t } = useTranslation(NAMESPACES)
  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>
        {t('auth:mfa.provisioningUri')}
      </Text>
      <Group gap="xs" align="center" wrap="wrap">
        <Code data-testid="mfa-provisioning-uri">
          <BidiText value={value} />
        </Code>
        <CopyButton value={value} timeout={COPY_FEEDBACK_MS}>
          {({ copied, copy }) => (
            <Button
              type="button"
              size="compact-xs"
              variant="default"
              onClick={copy}
              aria-label={t('auth:mfa.copyProvisioningUri')}
              data-testid="mfa-provisioning-uri-copy"
            >
              {copied ? t('shell:action.copied') : t('shell:action.copy')}
            </Button>
          )}
        </CopyButton>
      </Group>
    </Stack>
  )
}

interface MfaVerifyFormProps {
  /** The account whose enrolled secret the code is checked against (AC6). */
  readonly accountId: string
  /** Called with `true` once the Backend_Api reports a verified outcome. */
  readonly onVerified: () => void
}

/**
 * The verification control: a 6-digit code posted to `POST /auth/mfa/verify`
 * (AC6).
 *
 * An incorrect code arrives as an `invalid_mfa_code` envelope, so it is reported
 * through its own localized entry with the input cleared — the same treatment the
 * login code step gives it (AC3) — while a 200 that does not report a verified
 * outcome is reported as unverified rather than as a confirmation.
 */
function MfaVerifyForm({ accountId, onVerified }: MfaVerifyFormProps) {
  const { t } = useTranslation(NAMESPACES)
  const api = useApiClient()
  const [code, setCode] = useState('')

  const verify: UseMutationResult<boolean, unknown, string> = useMutation({
    mutationFn: (submitted: string) => verifyMfaCode(api, accountId, submitted),
    gcTime: 0,
    onSuccess: (verified) => {
      setCode('')
      if (verified) {
        onVerified()
      }
    },
    onError: () => {
      setCode('')
    },
  })

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (verify.isPending || !isSubmittableMfaCode(code)) {
      return
    }
    verify.mutate(code)
  }

  /** Whether the failure is the Backend_Api saying the code was wrong (AC6). */
  const refusedCode =
    verify.isError && isApiError(verify.error) && MFA_CODE_REFUSED_ERROR_KEYS.includes(verify.error.error)
  const verified = verify.isSuccess && verify.data
  const unverified = verify.isSuccess && !verify.data

  return (
    <form onSubmit={submit} noValidate data-testid="mfa-verify-form">
      <Stack gap="sm">
        <TextInput
          id={VERIFY_INPUT_ID}
          name="code"
          label={t('auth:mfa.verifyCode')}
          description={t('auth:mfa.codeHint', { length: MFA_CODE_LENGTH })}
          value={code}
          onChange={(event) => {
            setCode(sanitizeMfaCodeInput(event.currentTarget.value))
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={MFA_CODE_LENGTH}
          data-testid="mfa-verify-input"
        />

        <Group gap="sm">
          <Button
            type="submit"
            loading={verify.isPending}
            aria-busy={verify.isPending}
            disabled={!isSubmittableMfaCode(code)}
            data-testid="mfa-verify-submit"
          >
            {t('auth:mfa.verify')}
          </Button>
        </Group>

        {/* AC6: the confirmation of a verified outcome. */}
        {verified ? (
          <Alert
            role="status"
            variant="light"
            color="green"
            withCloseButton={false}
            data-testid="mfa-verified"
          >
            {t('auth:mfa.verified')}
          </Alert>
        ) : null}

        {unverified ? (
          <Alert
            role="alert"
            variant="light"
            color="red"
            withCloseButton={false}
            data-testid="mfa-unverified"
          >
            {t('auth:mfa.notVerified')}
          </Alert>
        ) : null}

        {refusedCode ? (
          <Alert
            role="alert"
            variant="light"
            color="red"
            withCloseButton={false}
            data-testid="mfa-verify-refused"
          >
            {t(`errors:${isApiError(verify.error) ? verify.error.error : 'fallback'}`)}
          </Alert>
        ) : verify.isError ? (
          <ErrorPresenter error={verify.error} />
        ) : null}

        {/* Req 20 AC7: announced without moving focus. */}
        <LiveAnnouncement
          message={
            verified
              ? t('auth:mfa.verified')
              : unverified
                ? t('auth:mfa.notVerified')
                : verify.isError
                  ? t('shell:state.errorTitle')
                  : null
          }
          assertive={verify.isError || unverified}
        />
      </Stack>
    </form>
  )
}

export interface MfaEnrolmentPanelProps {
  /** The signed-in Admin account, whose secret is enrolled and verified. */
  readonly accountId: string
  /** Called once a code has verified, so the account screen can re-read AC7. */
  readonly onVerified?: () => void
}

/**
 * The Admin enrolment panel (AC4, AC5, AC6).
 *
 * Rendered by the account screen only WHERE the session holds the Admin role — the
 * two endpoints are Admin-only, so offering the control to anyone else would
 * produce a denial rather than an enrolment.
 */
export function MfaEnrolmentPanel({ accountId, onVerified }: MfaEnrolmentPanelProps) {
  const { t } = useTranslation(NAMESPACES)
  const api = useApiClient()

  const enrol: UseMutationResult<MfaEnrolment, unknown, void> = useMutation({
    mutationFn: () => startMfaEnrolment(api),
    // The `provisioning_uri` carries the TOTP secret, so the result leaves the
    // MutationCache as soon as this panel stops observing it.
    gcTime: 0,
  })

  // Leaving the screen discards the artefacts rather than waiting for collection.
  const { reset } = enrol
  useEffect(() => reset, [reset])

  const enrolment = enrol.data ?? null
  const qrSource = qrCodeImageSource(enrolment?.qr_code_png_b64)
  const provisioningUri =
    typeof enrolment?.provisioning_uri === 'string' && enrolment.provisioning_uri !== ''
      ? enrolment.provisioning_uri
      : null

  return (
    <Paper withBorder p="md" data-testid="mfa-enrolment-panel">
      <Stack gap="sm">
        <Stack gap={2}>
          <Title order={2} size="h5">
            {t('auth:mfa.enrolTitle')}
          </Title>
          <Text size="sm" c="dimmed">
            {t('auth:mfa.enrolDescription')}
          </Text>
        </Stack>

        <Group gap="sm">
          <Button
            type="button"
            loading={enrol.isPending}
            aria-busy={enrol.isPending}
            onClick={() => {
              enrol.mutate()
            }}
            data-testid="mfa-enrol-start"
          >
            {enrolment === null ? t('auth:mfa.enrol') : t('auth:mfa.enrolAgain')}
          </Button>
        </Group>

        {/* A new secret replaces the previous one, so the cost is stated up front. */}
        <Text size="xs" c="dimmed" data-testid="mfa-enrol-replaces-notice">
          {t('auth:mfa.enrolReplacesNotice')}
        </Text>

        {enrol.isError ? <ErrorPresenter error={enrol.error} /> : null}

        {enrolment === null ? null : (
          <Stack gap="sm" data-testid="mfa-enrolment">
            {/*
             * AC4, AC5: the QR image, with a text alternative that directs the
             * reader to the `provisioning_uri` rendered below it. `fit="contain"`
             * and a bounded width keep it usable at 320px and at 200% text
             * (Req 20 AC9, AC10).
             */}
            {qrSource === null ? (
              <Text size="sm" data-testid="mfa-qr-missing">
                {t('auth:mfa.qrMissing')}
              </Text>
            ) : (
              <Image
                src={qrSource}
                alt={t('auth:mfa.qrAlt')}
                w={200}
                h={200}
                fit="contain"
                data-testid="mfa-qr-image"
              />
            )}

            {provisioningUri === null ? (
              <Text size="sm" data-testid="mfa-provisioning-uri-missing">
                {t('auth:mfa.provisioningUriMissing')}
              </Text>
            ) : (
              <ProvisioningUri value={provisioningUri} />
            )}

            <Text size="sm">{t('auth:mfa.verifyDescription', { length: MFA_CODE_LENGTH })}</Text>

            <MfaVerifyForm
              accountId={accountId}
              onVerified={() => {
                onVerified?.()
              }}
            />
          </Stack>
        )}

        {/* Req 20 AC7: announced without moving focus. */}
        <LiveAnnouncement
          message={enrol.isSuccess ? t('auth:mfa.enrolReady') : null}
        />
      </Stack>
    </Paper>
  )
}
