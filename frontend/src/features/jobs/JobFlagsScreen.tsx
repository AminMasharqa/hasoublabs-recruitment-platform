import { useState } from 'react'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Anchor,
  Box,
  Button,
  Container,
  Group,
  Modal,
  Paper,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { EmptyState, ErrorState, LoadingState } from '../../errors/ErrorPresenter'
import { formatDateTime } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'
import type { Locale } from '../../lib/locale'
import { useApiClient } from '../../shell/appServices'

import { createJobBody, EMPTY_JOB_DRAFT, type JobDraft } from './authoringRules'
import { JobForm } from './JobForm'
import { nextFlagsPage, resolveFlag, SOURCES_QUERY_SCOPE, type JobFlag } from './sourcesApi'
import { useFlagsQuery } from './sourcesQueries'

const NAMESPACES = ['jobSources', 'errors', 'shell', 'jobs'] as const
const MAX_URL_CHARS = 100

interface FlagRowProps {
  readonly flag: JobFlag
  readonly locale: Locale
  readonly onDismiss: () => void
  readonly onCreateJd: () => void
}

function FlagRow({ flag, locale, onDismiss, onCreateJd }: FlagRowProps) {
  const { t } = useTranslation(NAMESPACES)
  const truncatedUrl =
    flag.external_url.length > MAX_URL_CHARS
      ? `${flag.external_url.slice(0, MAX_URL_CHARS)}…`
      : flag.external_url

  return (
    <Paper withBorder p="md" component="li" data-testid={`flag-row-${flag.id}`}>
      <Stack gap="xs">
        <Group gap="md" wrap="wrap">
          <Stack gap={2} style={{ flex: 1 }}>
            <Text size="sm" fw={500}>
              {t('jobSources:flags.fields.externalUrl')}
            </Text>
            <Anchor
              href={flag.external_url}
              target="_blank"
              rel="noopener noreferrer"
              size="sm"
            >
              {truncatedUrl}
            </Anchor>
          </Stack>
          <Stack gap={2}>
            <Text size="sm" fw={500}>
              {t('jobSources:flags.fields.missingFields')}
            </Text>
            <Text size="sm">{flag.missing_fields.join(', ')}</Text>
          </Stack>
          <Stack gap={2}>
            <Text size="sm" fw={500}>
              {t('jobSources:flags.fields.flaggedAt')}
            </Text>
            <Text size="sm">{formatDateTime(flag.flagged_at, locale)}</Text>
          </Stack>
        </Group>
        <Group gap="xs">
          <Button
            variant="subtle"
            color="orange"
            size="sm"
            onClick={onDismiss}
            data-testid={`dismiss-${flag.id}`}
          >
            {t('jobSources:flags.dismiss')}
          </Button>
          <Button
            variant="light"
            size="sm"
            onClick={onCreateJd}
            data-testid={`create-jd-${flag.id}`}
          >
            {t('jobSources:flags.createJd')}
          </Button>
        </Group>
      </Stack>
    </Paper>
  )
}

export function JobFlagsScreen() {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const api = useApiClient()
  const queryClient = useQueryClient()

  const flagsQuery = useFlagsQuery()
  const [afterId, setAfterId] = useState<string | undefined>(undefined)
  const [dismissingFlag, setDismissingFlag] = useState<JobFlag | null>(null)
  const [creatingJdFlag, setCreatingJdFlag] = useState<JobFlag | null>(null)

  const flags = flagsQuery.data ?? []
  const next = nextFlagsPage(flags)

  const dismissMutation = useMutation({
    mutationFn: (flagId: string) => resolveFlag(api, flagId, { action: 'dismiss' }),
    onSuccess: () => {
      setDismissingFlag(null)
      void queryClient.invalidateQueries({ queryKey: [SOURCES_QUERY_SCOPE] })
    },
  })

  const createJdMutation = useMutation({
    mutationFn: (body: JobDraft) =>
      resolveFlag(api, creatingJdFlag!.id, {
        action: 'create_jd',
        jd_data: createJobBody(body),
      }),
    onSuccess: () => {
      setCreatingJdFlag(null)
      void queryClient.invalidateQueries({ queryKey: [SOURCES_QUERY_SCOPE] })
    },
  })

  return (
    <Container size="lg" py="md" data-testid="flags-screen">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('jobSources:flags.title')}
          </Title>
          <Text c="dimmed">{t('jobSources:flags.description')}</Text>
        </Stack>

        {flagsQuery.isPending ? (
          <LoadingState label={t('jobSources:flags.title')} />
        ) : flagsQuery.isError ? (
          <ErrorState
            error={flagsQuery.error}
            onRetry={() => {
              void flagsQuery.refetch()
            }}
          />
        ) : flags.length === 0 ? (
          <div data-testid="flags-empty">
            <EmptyState destination={t('jobSources:flags.title')} />
          </div>
        ) : (
          <>
            <Box
              component="ul"
              aria-label={t('jobSources:flags.title')}
              className="list-reset"
            >
              <Stack gap="md">
                {flags.map((flag) => (
                  <FlagRow
                    key={flag.id}
                    flag={flag}
                    locale={locale}
                    onDismiss={() => {
                      dismissMutation.reset()
                      setDismissingFlag(flag)
                    }}
                    onCreateJd={() => {
                      createJdMutation.reset()
                      setCreatingJdFlag(flag)
                    }}
                  />
                ))}
              </Stack>
            </Box>

            <Group gap="sm">
              {next.hasNextPage ? (
                <Button
                  type="button"
                  onClick={() => setAfterId(next.nextCursor ?? undefined)}
                  data-testid="flags-next-page"
                >
                  {t('shell:action.next')}
                </Button>
              ) : null}
              {afterId != null ? (
                <Button
                  type="button"
                  variant="default"
                  onClick={() => setAfterId(undefined)}
                  data-testid="flags-first-page"
                >
                  {t('shell:action.first')}
                </Button>
              ) : null}
            </Group>
          </>
        )}
      </Stack>

      {/* Dismiss confirm modal */}
      <Modal
        opened={dismissingFlag != null}
        onClose={() => setDismissingFlag(null)}
        title={t('jobSources:flags.confirmDismiss')}
        closeButtonProps={{ 'aria-label': t('shell:action.close') }}
      >
        <Stack gap="sm" data-testid="confirm-dismiss-dialog">
          <Text>{t('jobSources:flags.confirmDismissBody')}</Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setDismissingFlag(null)}>
              {t('shell:action.cancel')}
            </Button>
            <Button
              color="orange"
              loading={dismissMutation.isPending}
              onClick={() => {
                if (dismissingFlag != null) {
                  dismissMutation.mutate(dismissingFlag.id)
                }
              }}
              data-testid="confirm-dismiss"
            >
              {t('jobSources:flags.dismissAction')}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Create JD modal */}
      <Modal
        opened={creatingJdFlag != null}
        onClose={() => setCreatingJdFlag(null)}
        title={t('jobSources:createJdModal.title')}
        closeButtonProps={{ 'aria-label': t('shell:action.close') }}
        size="xl"
      >
        <Stack gap="sm" data-testid="create-jd-modal">
          <Text c="dimmed">{t('jobSources:createJdModal.description')}</Text>
          <JobForm
            initial={{
              ...EMPTY_JOB_DRAFT,
              externalUrl: creatingJdFlag?.external_url ?? '',
            }}
            submitLabel={t('jobSources:createJdModal.submit')}
            onSubmit={(draft) => {
              createJdMutation.mutate(draft)
            }}
            pending={createJdMutation.isPending}
            error={createJdMutation.isError ? createJdMutation.error : null}
          />
        </Stack>
      </Modal>
    </Container>
  )
}
