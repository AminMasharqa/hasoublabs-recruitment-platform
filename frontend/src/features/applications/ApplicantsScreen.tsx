/**
 * `/senior/applicants` and `/senior/jobs/:jdId/applicants` — the applicants of one
 * Job_Description (Requirement 14 AC12).
 *
 * One screen on both paths, because they differ only in where the Job_Description
 * identifier comes from: the per-role address carries it in the path, and the menu
 * destination reads it from the `jd` query parameter through `JobSelector`. The path
 * wins when both are present — an address that names a role is more specific than a
 * selection left over in the query string.
 *
 * The Senior Active_Context is the route group's requirement (`SENIOR_ACCESS`), so
 * AC12's "WHERE the Active_Context is SENIOR or the account holds the Admin role" is
 * structural on this path: no check here duplicates it, and the Admin reaches the same
 * list from `/admin/applications` (Requirement 8 AC4, AC7, AC8). The Backend_Api
 * additionally refuses a Job_Description the caller may not see, which renders as the
 * uniform denial (Requirement 21 AC3).
 *
 * The three-field restriction of AC12 lives in `ApplicantList`; this screen decides
 * only which Job_Description is being asked about.
 *
 * Requirements: 14.12, 19.2, 21.6, 21.7, 21.8.
 */

import { Container, Paper, Stack, Text, Title } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router-dom'

import type { ApplicationStatus } from '../../api/enums'

import { ApplicantList } from './ApplicantList'
import { JobSelector } from './JobSelector'
import { readJdId, writeSelection } from './selection'

/** Namespaces this screen resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['applications', 'shell', 'errors'] as const

/** The Senior applicant list (AC12). */
export function ApplicantsScreen() {
  const { t } = useTranslation(NAMESPACES)
  const params = useParams<{ jdId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const [status, setStatus] = useState<ApplicationStatus | null>(null)

  const fromPath = (params.jdId ?? '').trim()
  const jdId = fromPath === '' ? readJdId(searchParams) : fromPath

  return (
    <Container size="md" py="md" data-testid="applicants-screen">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('applications:applicants.title')}
          </Title>
          <Text c="dimmed">{t('applications:applicants.description')}</Text>
        </Stack>

        {/* The selector belongs to the menu destination only; the per-role address
            already names its Job_Description. */}
        {fromPath === '' ? (
          <Paper withBorder p="md">
            <JobSelector
              jdId={jdId}
              onSelect={(selected) => {
                setStatus(null)
                setSearchParams(writeSelection({ jdId: selected }))
              }}
            />
          </Paper>
        ) : (
          <Text size="sm" c="dimmed" data-testid="applicants-jd">
            {t('applications:applicants.jdLabel')}
            {': '}
            {jdId}
          </Text>
        )}

        <ApplicantList jdId={jdId} status={status} onStatusChange={setStatus} />
      </Stack>
    </Container>
  )
}
