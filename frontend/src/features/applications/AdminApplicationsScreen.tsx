/**
 * `/admin/applications` — the Admin view of Applications (Requirement 14 AC12, AC13,
 * AC14).
 *
 * Two independent surfaces, because the contract exposes two independent capabilities
 * to an Admin and no listing that joins them:
 *
 * - the **applicant list** of a named Job_Description, `GET /jobs/{jd_id}/applicants`,
 *   rendering exactly the three Applicant_Card fields (AC12) — the same component the
 *   Senior destination uses, so the three-field restriction has one implementation;
 * - the **status control** of a named Application,
 *   `PATCH /admin/applications/{application_id}/status` (AC13), whose success
 *   invalidates the applicant list and the Application detail (AC14).
 *
 * Both are addressed through the query string: `?jd=…` names the Job_Description and
 * `?application_id=…` names the Application. The second parameter is the one the
 * candidate-progress report already drills down with
 * (`features/reports/drilldowns.ts`), so following an Application drill-down out of a
 * report lands here with the control already pointed at that Application.
 *
 * ## Why the Application identifier is typed rather than picked
 *
 * An Applicant_Card carries no identifier — that is the point of AC12 — and the
 * contract exposes no Admin listing of Applications. So the Application the status
 * control acts on is named by the address: from a report drill-down, from a
 * Candidate's Application detail, or pasted. Inventing a listing here would mean
 * inventing an endpoint.
 *
 * The Admin role is the route group's requirement (`ADMIN_ACCESS`), so AC13's "WHERE
 * the account holds the Admin role" is structural: no check here duplicates it, and an
 * unauthorized navigation renders the uniform denial before this element mounts
 * (Requirement 8 AC4, AC8).
 *
 * Requirements: 14.12, 14.13, 14.14, 18.5, 19.2, 19.11, 21.6.
 */

import { Button, Container, Divider, Group, Paper, Stack, Text, TextInput, Title } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import type { ApplicationStatus } from '../../api/enums'
import { textForSubmission } from '../../i18n/formatting'

import { ApplicantList } from './ApplicantList'
import { ApplicationStatusControl } from './ApplicationStatusControl'
import { JobSelector } from './JobSelector'
import { readApplicationId, readJdId, writeSelection } from './selection'

/** Namespaces this screen resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['applications', 'shell', 'errors'] as const

interface ApplicationSelectorProps {
  readonly applicationId: string
  readonly onSelect: (applicationId: string) => void
}

/** Names the Application the status control acts on (AC13). */
function ApplicationSelector({ applicationId, onSelect }: ApplicationSelectorProps) {
  const { t } = useTranslation(NAMESPACES)
  const [draft, setDraft] = useState(applicationId)

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSelect(draft.trim())
      }}
    >
      <Group gap="sm" align="flex-end" wrap="wrap">
        <TextInput
          label={t('applications:admin.applicationLabel')}
          description={t('applications:admin.applicationHint')}
          value={draft}
          onChange={(event) => {
            // Req 19 AC11: carried through exactly as entered.
            setDraft(textForSubmission(event.currentTarget.value))
          }}
          data-testid="admin-application-input"
        />
        <Button type="submit" data-testid="admin-application-submit">
          {t('applications:admin.applicationSubmit')}
        </Button>
      </Group>
    </form>
  )
}

/** The Admin Application destination (AC12, AC13, AC14). */
export function AdminApplicationsScreen() {
  const { t } = useTranslation(NAMESPACES)
  const [searchParams, setSearchParams] = useSearchParams()
  const [status, setStatus] = useState<ApplicationStatus | null>(null)

  const jdId = readJdId(searchParams)
  const applicationId = readApplicationId(searchParams)

  /** Rewrites the address, retaining the selection that was not changed. */
  const select = (selection: { readonly jdId?: string; readonly applicationId?: string }): void => {
    setSearchParams(
      writeSelection({
        jdId: selection.jdId ?? jdId,
        applicationId: selection.applicationId ?? applicationId,
      }),
    )
  }

  return (
    <Container size="md" py="md" data-testid="admin-applications-screen">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('applications:admin.title')}
          </Title>
          <Text c="dimmed">{t('applications:admin.description')}</Text>
        </Stack>

        {/* AC13: the Application the status control acts on. */}
        <Paper withBorder p="md">
          <Stack gap="sm">
            <Title order={2} size="h5">
              {t('applications:admin.statusSection')}
            </Title>
            <ApplicationSelector
              key={applicationId}
              applicationId={applicationId}
              onSelect={(selected) => select({ applicationId: selected })}
            />
            {applicationId === '' ? (
              <Text c="dimmed" data-testid="admin-no-application">
                {t('applications:admin.noApplication')}
              </Text>
            ) : (
              <ApplicationStatusControl
                key={applicationId}
                applicationId={applicationId}
                {...(jdId === '' ? {} : { jdId })}
              />
            )}
          </Stack>
        </Paper>

        <Divider />

        {/* AC12: the applicant list of a named Job_Description. */}
        <Paper withBorder p="md">
          <Stack gap="sm">
            <Title order={2} size="h5">
              {t('applications:admin.applicantsSection')}
            </Title>
            <JobSelector
              jdId={jdId}
              onSelect={(selected) => {
                setStatus(null)
                select({ jdId: selected })
              }}
            />
          </Stack>
        </Paper>

        <ApplicantList jdId={jdId} status={status} onStatusChange={setStatus} />
      </Stack>
    </Container>
  )
}
