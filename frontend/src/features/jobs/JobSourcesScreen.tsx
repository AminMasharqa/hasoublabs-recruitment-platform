import { useState } from 'react'

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
import { Link } from 'react-router-dom'

import { EmptyState, ErrorState, LoadingState } from '../../errors/ErrorPresenter'
import { adminJobSourcePath, ROUTE_PATHS } from '../../routing/paths'

import type { JobSource } from './sourcesApi'
import { useDeleteSourceMutation, useSourcesQuery } from './sourcesQueries'

const NAMESPACES = ['jobSources', 'errors', 'shell'] as const

interface SourceRowProps {
  readonly source: JobSource
  readonly onDelete: () => void
}

function SourceRow({ source, onDelete }: SourceRowProps) {
  const { t } = useTranslation(NAMESPACES)
  return (
    <Paper withBorder p="md" component="li" data-testid={`source-row-${source.id}`}>
      <Group justify="space-between" wrap="wrap">
        <Stack gap={2}>
          <Title order={3} size="h5">
            {source.name}
          </Title>
          <Text size="sm" c="dimmed">
            {t(`jobSources:sources.type.${source.source_type}`)}
          </Text>
        </Stack>
        <Group gap="xs">
          <Anchor
            component={Link}
            to={adminJobSourcePath(source.id)}
            size="sm"
            data-testid={`edit-${source.id}`}
          >
            {t('jobSources:edit.title')}
          </Anchor>
          <Button
            variant="subtle"
            color="red"
            size="sm"
            onClick={onDelete}
            data-testid={`delete-${source.id}`}
          >
            {t('jobSources:actions.deleteSource')}
          </Button>
        </Group>
      </Group>
    </Paper>
  )
}

export function JobSourcesScreen() {
  const { t } = useTranslation(NAMESPACES)
  const sourcesQuery = useSourcesQuery()
  const deleteMutation = useDeleteSourceMutation()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const sources = sourcesQuery.data ?? []

  const openDeleteModal = (sourceId: string): void => {
    deleteMutation.reset()
    setDeletingId(sourceId)
  }

  const closeDeleteModal = (): void => {
    setDeletingId(null)
    deleteMutation.reset()
  }

  const handleConfirmDelete = (): void => {
    if (deletingId == null) return
    deleteMutation.mutate(deletingId, {
      onSuccess: () => {
        setDeletingId(null)
      },
    })
  }

  return (
    <Container size="lg" py="md" data-testid="sources-screen">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('jobSources:sources.title')}
          </Title>
          <Text c="dimmed">{t('jobSources:sources.description')}</Text>
        </Stack>

        <Group>
          <Button
            component={Link}
            to={ROUTE_PATHS.adminJobSourceNew}
            variant="light"
            data-testid="sources-add"
          >
            {t('jobSources:sources.add')}
          </Button>
        </Group>

        {sourcesQuery.isPending ? (
          <div data-testid="sources-loading">
            <LoadingState label={t('jobSources:sources.title')} />
          </div>
        ) : sourcesQuery.isError ? (
          <ErrorState
            error={sourcesQuery.error}
            onRetry={() => {
              void sourcesQuery.refetch()
            }}
          />
        ) : sources.length === 0 ? (
          <div data-testid="sources-empty">
            <EmptyState destination={t('jobSources:sources.title')} />
          </div>
        ) : (
          <Box
            component="ul"
            aria-label={t('jobSources:sources.title')}
            className="list-reset"
          >
            <Stack gap="md">
              {sources.map((source) => (
                <SourceRow
                  key={source.id}
                  source={source}
                  onDelete={() => openDeleteModal(source.id)}
                />
              ))}
            </Stack>
          </Box>
        )}
      </Stack>

      <Modal
        opened={deletingId != null}
        onClose={closeDeleteModal}
        title={t('jobSources:actions.confirmDelete')}
        closeButtonProps={{ 'aria-label': t('shell:action.close') }}
      >
        <Stack gap="sm">
          <Text>{t('jobSources:actions.confirmDeleteBody')}</Text>
          {deleteMutation.isError && (
            <Text c="red" size="sm" data-testid="delete-error">
              {t('errors:fallback')}
            </Text>
          )}
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={closeDeleteModal}>
              {t('shell:action.cancel')}
            </Button>
            <Button
              color="red"
              loading={deleteMutation.isPending}
              onClick={handleConfirmDelete}
              data-testid="confirm-delete"
            >
              {t('jobSources:actions.deleteAction')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  )
}
