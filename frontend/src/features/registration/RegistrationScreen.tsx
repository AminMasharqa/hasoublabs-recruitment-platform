/**
 * The unauthenticated Registration_Link screen (Requirement 6 AC1, AC2, AC3).
 *
 * One read decides everything this screen renders: `GET /registration-links/{token}`
 * with the token from the address (AC1).
 *
 * | outcome | surface |
 * | --- | --- |
 * | 200 naming a self-registerable role | the role-fixed form (AC2) |
 * | 400–599 | the invalid-or-expired notice, no form (AC3) |
 * | 200 naming any other role | the same notice — nothing to register |
 * | no response at all (timeout, transport) | a retryable read failure |
 *
 * The last row is a deliberate narrowing of AC3, which is scoped to "a status code
 * in the range 400 to 599". A request that never reached the Backend_Api says
 * nothing about the link, so telling the user their link has expired would be an
 * invention; they get the standard failed-read surface with its Support_Reference
 * and a retry control instead (Requirement 21 AC8).
 *
 * The screen holds no route knowledge beyond the `:token` parameter — it is
 * registered against the already-declared public `register` path through the
 * shell's screen table, and the route carries no guard (Requirement 6 AC1).
 */

import { Container, Stack, Text, Title } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'

import { ErrorState, LoadingState } from '../../errors/ErrorPresenter'
import { useApiClient } from '../../shell/appServices'

import { RegistrationForm } from './RegistrationForm'
import {
  fetchRegistrationLink,
  isLinkRejection,
  registrationLinkQueryKey,
  selfRegistrationRole,
  type RegistrationLink,
} from './registrationLink'

/** Namespaces this screen resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['registration', 'shell', 'errors'] as const

/**
 * The invalid-or-expired-link surface (AC3).
 *
 * Localized instruction to request a new Registration_Link, and no form — not a
 * disabled one, not a hidden one. Nothing about the refusal is echoed back: the
 * Error_Envelope of a bad link would only tell the user what they already know.
 */
function InvalidLinkNotice() {
  const { t } = useTranslation(NAMESPACES)
  return (
    <Stack gap="xs" role="alert" data-testid="registration-invalid-link">
      <Title order={2} size="h4">
        {t('registration:invalidLink.title')}
      </Title>
      <Text>{t('registration:invalidLink.body')}</Text>
    </Stack>
  )
}

/** The `/register/:token` screen. */
export function RegistrationScreen() {
  const { t } = useTranslation(NAMESPACES)
  const api = useApiClient()
  const params = useParams()
  const token = (params.token ?? '').trim()

  const link = useQuery<RegistrationLink>({
    queryKey: registrationLinkQueryKey(token),
    // AC1: the token is validated before anything else is rendered.
    queryFn: ({ signal }) => fetchRegistrationLink(api, token, signal),
    // An address with no token has nothing to validate; the notice below covers it.
    enabled: token !== '',
    // Link validity is a now question, and the answer is not worth keeping after
    // the screen is left.
    staleTime: 0,
    gcTime: 0,
  })

  const role = selfRegistrationRole(link.data)

  return (
    <Container size="sm" py="md" data-testid="registration-screen">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('registration:title')}
          </Title>
          {role === null ? null : <Text c="dimmed">{t('registration:intro')}</Text>}
        </Stack>

        {token === '' ? (
          <InvalidLinkNotice />
        ) : link.isPending ? (
          <LoadingState label={t('registration:checking')} showLabel />
        ) : link.isError ? (
          // AC3 for a refusal; a request that never arrived stays retryable.
          isLinkRejection(link.error) ? (
            <InvalidLinkNotice />
          ) : (
            <ErrorState
              error={link.error}
              title={t('registration:linkFailed')}
              onRetry={() => {
                void link.refetch()
              }}
            />
          )
        ) : role === null ? (
          <InvalidLinkNotice />
        ) : (
          /* AC2: the form is built for the role the link named. */
          <RegistrationForm role={role} token={token} />
        )}
      </Stack>
    </Container>
  )
}
