/**
 * The create-link control and the one rendering of the token it returns
 * (Requirement 16 AC4, AC5, AC6).
 *
 * AC4 fixes the control: a role of `CANDIDATE` or `SENIOR` posted to
 * `POST /api/v1/admin/registration-links`. AC5 fixes what a 201 renders: the
 * `token` member once, as copyable text, beside the `expires_at` value, and a
 * statement that the value cannot be retrieved afterwards — because it cannot. The
 * Backend_Api populates `token` at creation only; every later read of the link
 * omits it.
 *
 * ## How AC6 is enforced
 *
 * Three things, together:
 *
 * 1. There is no `useQuery` for a Registration_Link. A link is created, not read,
 *    so the token is never written to the query cache at all.
 * 2. The mutation carries `gcTime: 0` (`accountQueries.ts`), so it leaves the
 *    MutationCache as soon as this panel stops observing it.
 * 3. This panel resets the mutation when it unmounts, which removes the mutation —
 *    and the token in its result — immediately rather than at the next garbage
 *    collection.
 *
 * Leaving the screen therefore discards the value, which is also why the panel says
 * so before the Admin navigates away.
 *
 * ## Why the registration address is rendered too
 *
 * The token on its own is not something an Admin can send anyone: the registrant
 * needs the address the token is validated at (Requirement 6 AC1). The address is
 * derived from the token already on screen — the same single value, spelled as the
 * link it will be used as — and is discarded with it.
 *
 * Requirements: 16.4, 16.5, 16.6, 19.2, 19.12, 20.7, 20.8.
 */

import { Alert, Button, Code, CopyButton, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorPresenter, LiveAnnouncement } from '../../errors/ErrorPresenter'
import { SELF_REGISTRATION_ROLE_VALUES } from '../../forms/validators'
import { BidiText } from '../../i18n/DirectionProvider'
import { formatDateTime, utcTimestamp } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'

import { useCreateRegistrationLink } from './accountQueries'
import type { RegistrationLinkRole } from './accountsApi'
import { registrationLinkUrl } from './registrationLinks'

/** Namespaces the panel resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['adminAccounts', 'shell', 'errors'] as const

/** How long a copy control reports success before reverting to its label. */
const COPY_FEEDBACK_MS = 2000

interface CopyableValueProps {
  readonly label: string
  readonly value: string
  readonly testId: string
}

/** One value rendered as selectable text with a copy control (AC5, Req 20 AC8). */
function CopyableValue({ label, value, testId }: CopyableValueProps) {
  const { t } = useTranslation(NAMESPACES)
  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>
        {label}
      </Text>
      <Group gap="xs" align="center" wrap="wrap">
        {/*
         * Selectable text, not an input: the value is not being edited, and text
         * stays readable to a screen reader and copyable by hand when the clipboard
         * is unavailable. `BidiText` keeps it byte-identical and bidi-isolated from
         * the Arabic or Hebrew label beside it (Req 19 AC10).
         */}
        <Code data-testid={testId}>
          <BidiText value={value} />
        </Code>
        <CopyButton value={value} timeout={COPY_FEEDBACK_MS}>
          {({ copied, copy }) => (
            <Button
              type="button"
              size="compact-xs"
              variant="default"
              onClick={copy}
              aria-label={t('adminAccounts:link.copyValue', { value: label })}
              data-testid={`${testId}-copy`}
            >
              {copied ? t('shell:action.copied') : t('shell:action.copy')}
            </Button>
          )}
        </CopyButton>
      </Group>
    </Stack>
  )
}

/** The create-link control and the single rendering of an issued token (AC4–AC6). */
export function RegistrationLinkPanel() {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const create = useCreateRegistrationLink()

  // AC6: leaving the screen discards the token rather than waiting for the cache to
  // be collected. `reset` is stable across renders, so this runs on unmount only.
  const { reset } = create
  useEffect(() => reset, [reset])

  const issued = create.data ?? null
  const token = typeof issued?.token === 'string' && issued.token !== '' ? issued.token : null

  return (
    <Paper withBorder p="md" data-testid="registration-link-panel">
      <Stack gap="sm">
        <Stack gap={2}>
          <Title order={2} size="h5">
            {t('adminAccounts:link.title')}
          </Title>
          <Text size="sm" c="dimmed">
            {t('adminAccounts:link.description')}
          </Text>
        </Stack>

        <Group gap="sm" align="flex-end" wrap="wrap">
          {/*
           * AC4: exactly the two self-registerable roles. The set is derived from the
           * contract's `Role` union in `forms/validators.ts`, not spelled here.
           */}
          {SELF_REGISTRATION_ROLE_VALUES.values.map((role) => (
            <Button
              key={role}
              type="button"
              loading={create.isPending && create.variables === role}
              onClick={() => {
                create.mutate(role as RegistrationLinkRole)
              }}
              data-testid={`registration-link-create-${role}`}
            >
              {t('adminAccounts:link.create', { role: t(`adminAccounts:role.${role}`) })}
            </Button>
          ))}
        </Group>

        {create.isError ? <ErrorPresenter error={create.error} /> : null}

        {issued === null ? null : (
          <Alert
            color="green"
            variant="light"
            withCloseButton={false}
            title={t('adminAccounts:link.issuedTitle')}
            data-testid="registration-link-issued"
          >
            <Stack gap="sm">
              {/* AC5: the token is not retrievable afterwards, stated plainly. */}
              <Text size="sm" fw={500} data-testid="registration-link-once-notice">
                {t('adminAccounts:link.onceNotice')}
              </Text>

              {token === null ? (
                <Text size="sm" data-testid="registration-link-no-token">
                  {t('adminAccounts:link.noToken')}
                </Text>
              ) : (
                <>
                  <CopyableValue
                    label={t('adminAccounts:link.token')}
                    value={token}
                    testId="registration-link-token"
                  />
                  <CopyableValue
                    label={t('adminAccounts:link.url')}
                    value={registrationLinkUrl(token)}
                    testId="registration-link-url"
                  />
                </>
              )}

              <Stack gap={0}>
                <Text size="sm" data-testid="registration-link-expires">
                  {t('adminAccounts:link.expires', {
                    value: formatDateTime(issued.expires_at, locale),
                  })}
                </Text>
                <Text size="xs" c="dimmed">
                  {t('adminAccounts:card.utc', { value: utcTimestamp(issued.expires_at) })}
                </Text>
              </Stack>

              <Text size="sm">
                {t('adminAccounts:link.forRole', {
                  role: t(`adminAccounts:role.${issued.role}`),
                })}
              </Text>

              <Group gap="sm">
                <Button
                  type="button"
                  size="xs"
                  variant="default"
                  onClick={() => {
                    // AC6: the Admin can discard the value as soon as it is recorded.
                    create.reset()
                  }}
                  data-testid="registration-link-dismiss"
                >
                  {t('adminAccounts:link.dismiss')}
                </Button>
              </Group>
            </Stack>
          </Alert>
        )}

        {/* Req 20 AC7: announced without moving focus. */}
        <LiveAnnouncement message={create.isSuccess ? t('adminAccounts:announce.linkIssued') : null} />
      </Stack>
    </Paper>
  )
}
