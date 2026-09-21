/**
 * The pending-skill review destination (Requirement 16 AC17).
 *
 * Lists the unmatched skill terms of `GET /api/v1/admin/skills/pending` — the terms
 * Candidates and Seniors entered that the Skill_Taxonomy could not match, awaiting
 * an Admin's decision.
 *
 * Read-only, deliberately: the contract exposes no endpoint that approves, merges or
 * rejects a pending term, so there is no control here that could attempt one. A
 * disabled "approve" would advertise an action that does not exist.
 *
 * Every term is rendered verbatim through `BidiText` — these are values a person
 * typed, frequently in Arabic or Hebrew, and the review is only useful if what the
 * Admin reads is byte-identical to what was entered (Req 19 AC10, AC11).
 *
 * Requirements: 16.17, 19.2, 19.10, 19.12, 21.6, 21.7, 21.8.
 */

import { Card, Group, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { EmptyState, ErrorState, LiveAnnouncement, LoadingState } from '../../errors/ErrorPresenter'
import { BidiText } from '../../i18n/DirectionProvider'
import { formatDateTime } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'

import { usePendingSkillsQuery } from './accountQueries'

/** Namespaces the panel resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['adminAccounts', 'shell', 'errors'] as const

/** The pending-skill review list (AC17). */
export function PendingSkillsPanel() {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const pending = usePendingSkillsQuery()

  const entries = pending.data ?? []

  return (
    <Stack gap="md" data-testid="pending-skills-panel">
      <Stack gap={2}>
        <Title order={2} size="h5">
          {t('adminAccounts:pendingSkills.title')}
        </Title>
        <Text size="sm" c="dimmed">
          {t('adminAccounts:pendingSkills.description')}
        </Text>
      </Stack>

      {pending.isPending ? (
        <LoadingState label={t('adminAccounts:pendingSkills.title')} />
      ) : pending.isError ? (
        <ErrorState
          error={pending.error}
          onRetry={() => {
            void pending.refetch()
          }}
        />
      ) : entries.length === 0 ? (
        <>
          <EmptyState destination={t('adminAccounts:pendingSkills.title')} />
          <LiveAnnouncement message={t('adminAccounts:pendingSkills.empty')} />
        </>
      ) : (
        <Stack
          component="ul"
          gap="sm"
          aria-label={t('adminAccounts:pendingSkills.listLabel')}
          data-testid="pending-skills-list"
          style={{ listStyle: 'none', margin: 0, padding: 0 }}
        >
          {entries.map((entry) => (
            <Card
              key={entry.id}
              component="li"
              withBorder
              padding="sm"
              data-testid={`pending-skill-${entry.id}`}
            >
              <Stack gap={2}>
                <Text fw={600} data-testid={`pending-skill-term-${entry.id}`}>
                  <BidiText value={entry.rawTerm} />
                </Text>
                {entry.normalizedTerm === null ? null : (
                  <Group gap={4}>
                    <Text size="sm" c="dimmed">
                      {t('adminAccounts:pendingSkills.normalized')}
                    </Text>
                    <Text size="sm">
                      <BidiText value={entry.normalizedTerm} />
                    </Text>
                  </Group>
                )}
                {entry.createdAt === null ? null : (
                  <Text size="sm" c="dimmed">
                    {t('adminAccounts:pendingSkills.recorded', {
                      value: formatDateTime(entry.createdAt, locale),
                    })}
                  </Text>
                )}
              </Stack>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  )
}
