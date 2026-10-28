/**
 * `/senior/jobs/new` and `/admin/jobs/new` — creating a Job_Description
 * (Requirement 13 AC1–AC10).
 *
 * - **AC1** the creation form is `JobForm`. *Who* may reach it is decided by the
 *   route groups this screen is registered in — `SENIOR_ACCESS` and `ADMIN_ACCESS` —
 *   so "the Active_Context is `SENIOR` or the account holds the Admin role" is
 *   structural (Req 8 AC4) rather than a check this screen performs on itself.
 * - **AC2** a manual submission calls `POST /jobs` and lands on the authoring surface
 *   of the returned `Draft`, which renders its status.
 * - **AC3–AC5** the extraction controls and the ≤5s poll are `JobExtractionPanel`
 *   and `useExtractionDraftQuery`.
 * - **AC6** a `ready` draft becomes the form's initial values; the form is remounted
 *   with the draft identifier as its `key`, so the pre-populated values are ordinary
 *   editable form state rather than a second source of truth.
 * - **AC7** every reported skill candidate is presented for confirmation or
 *   replacement by `SkillCandidatePanel`.
 * - **AC8** the inputs the extraction left empty carry the manual-entry warning.
 * - **AC9** confirming calls `POST /jobs/extract/{draft_id}:confirm` with the
 *   confirmed values.
 * - **AC10** no persistence request exists for a draft until the user confirms:
 *   `canConfirmExtraction` is the submit control's own gate, and the confirmation
 *   mutation is reachable from nowhere else.
 *
 * ## Which terms the confirmation carries
 *
 * The candidate panel and the skill editor are two different things. Candidates are
 * the extractor's proposals awaiting a decision (AC7); the editor holds terms the
 * user typed. The confirmed body carries the union — the terms the user kept or
 * substituted, plus anything they added by hand — de-duplicated by
 * `normalizeSkillTerms`, so confirming a proposal that was also typed manually asks
 * for one skill rather than two.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 19.2, 20.7, 21.1.
 */

import { Anchor, Container, Stack, Text, Title } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { LiveAnnouncement } from '../../errors/ErrorPresenter'
import { ROUTE_PATHS, adminJobPath, seniorJobPath } from '../../routing/paths'
import { useSession } from '../../session/sessionState'

import { useConfirmExtraction, useCreateJob, useExtractionDraftQuery } from './authoringQueries'
import {
  createJobBody,
  EMPTY_JOB_DRAFT,
  normalizeSkillTerms,
  type JobDraft,
} from './authoringRules'
import {
  canConfirmExtraction,
  confirmedSkillTerms,
  decideSkillCandidate,
  draftFromExtraction,
  initialSkillResolutions,
  missingExtractedFields,
  type SkillDecision,
  type SkillResolution,
} from './extraction'
import { JobExtractionPanel } from './JobExtractionPanel'
import { JobForm } from './JobForm'
import type { JobDescription } from './jobsApi'
import { SkillCandidatePanel } from './SkillCandidatePanel'

/** Namespaces this screen resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['jobs', 'shell', 'errors'] as const

/** The decisions taken about one extraction draft's candidates (AC7). */
interface DecidedCandidates {
  /** The draft the decisions belong to; `null` while none have been taken. */
  readonly draftId: string | null
  readonly resolutions: readonly SkillResolution[]
}

const NO_DECISIONS: DecidedCandidates = Object.freeze({
  draftId: null,
  resolutions: Object.freeze([]) as readonly SkillResolution[],
})

/** The Job_Description creation screen (AC1–AC10). */
export function JobNewScreen() {
  const { t } = useTranslation(NAMESPACES)
  const { act } = useSession()
  const navigate = useNavigate()

  /** The extraction draft being polled, or `null` while the form is manual (AC5). */
  const [draftId, setDraftId] = useState<string | null>(null)
  const [decided, setDecided] = useState<DecidedCandidates>(NO_DECISIONS)

  const poll = useExtractionDraftQuery(draftId)
  const draft = poll.data
  const ready = draft !== undefined && draft.outcome === 'ready'
  const readyDraftId = ready ? draft.id : null

  /**
   * The candidate rows (AC7), derived rather than synchronized.
   *
   * Decisions are held against the draft they were taken for, so a second
   * extraction starts from undecided rows without an effect resetting them — and a
   * refetch of the *same* draft cannot discard decisions the user has already made,
   * which an effect keyed on the decoded payload would.
   */
  const resolutions: readonly SkillResolution[] =
    decided.draftId === readyDraftId && readyDraftId !== null
      ? decided.resolutions
      : initialSkillResolutions(ready && draft !== undefined ? draft.skillCandidates : [])

  const create = useCreateJob()
  const confirm = useConfirmExtraction()
  const pending = create.isPending || confirm.isPending
  const failure = create.error ?? confirm.error ?? null

  /** Where a created Job_Description is authored from, per Active_Context. */
  const authoringPathOf = (job: JobDescription): string =>
    act === 'ADMIN' ? adminJobPath(job.id) : seniorJobPath(job.id)

  const landOn = (job: JobDescription): void => {
    // AC2: the returned Job_Description — status included — is rendered by the
    // authoring surface, whose detail cache the mutation has already seeded.
    void navigate(authoringPathOf(job))
  }

  /** AC10: the gate the submit control reads, and the only way to reach AC9's call. */
  const confirmable = canConfirmExtraction(draft, resolutions)

  const submit = (edited: JobDraft): void => {
    if (ready && draft !== undefined) {
      if (!confirmable) {
        return
      }
      const body = createJobBody({
        ...edited,
        skillTerms: normalizeSkillTerms([
          ...edited.skillTerms,
          ...confirmedSkillTerms(resolutions),
        ]),
      })
      confirm.mutate({ draftId: draft.id, body }, { onSuccess: landOn })
      return
    }
    create.mutate(edited, { onSuccess: landOn })
  }

  const decide = (index: number, decision: SkillDecision, replacement?: string): void => {
    setDecided({
      draftId: readyDraftId,
      resolutions: decideSkillCandidate(resolutions, index, decision, replacement),
    })
  }

  const listPath = act === 'ADMIN' ? ROUTE_PATHS.adminJobs : ROUTE_PATHS.seniorJobs

  return (
    <Container size="md" py="md" data-testid="job-new-screen">
      <Stack gap="md">
        <Anchor component={Link} to={listPath} size="sm" data-testid="job-new-back">
          {t('jobs:authoring.backToList')}
        </Anchor>

        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('jobs:authoring.newTitle')}
          </Title>
          <Text c="dimmed">{t('jobs:authoring.newDescription')}</Text>
        </Stack>

        {/* AC3–AC5, AC8 */}
        <JobExtractionPanel
          draft={draft}
          isPolling={poll.isPending && poll.fetchStatus !== 'idle'}
          pollError={poll.error}
          onStarted={(id) => setDraftId(id)}
          onDiscard={() => {
            setDraftId(null)
            setDecided(NO_DECISIONS)
            create.reset()
            confirm.reset()
          }}
        />

        {/* AC6: the ready draft *is* the form's initial state, remounted with it. */}
        <JobForm
          key={readyDraftId ?? 'manual'}
          initial={ready && draft !== undefined ? draftFromExtraction(draft.fields) : EMPTY_JOB_DRAFT}
          missingExtracted={
            ready && draft !== undefined ? missingExtractedFields(draft.fields) : []
          }
          submitLabel={ready ? t('jobs:authoring.confirmAndCreate') : t('jobs:authoring.create')}
          onSubmit={submit}
          pending={pending}
          error={failure}
          // AC7, AC10: an undecided candidate keeps the control disabled, and says why.
          blockedReason={
            ready && !confirmable ? t('jobs:authoring.confirmationRequired') : null
          }
          testId="job-create-form"
        >
          <SkillCandidatePanel
            resolutions={resolutions}
            onDecide={decide}
            disabled={pending}
          />
        </JobForm>

        <LiveAnnouncement
          message={
            create.isSuccess || confirm.isSuccess ? t('jobs:announce.created') : null
          }
        />
      </Stack>
    </Container>
  )
}
