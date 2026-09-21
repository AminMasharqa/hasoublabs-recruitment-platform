/**
 * The extraction controls and the polling surface
 * (Requirement 13 AC3, AC4, AC5, AC8).
 *
 * Two ways in — a public URL of at most 500 characters (AC3) and raw text of 1 to
 * 10000 characters (AC4) — and one asynchronous outcome between them. The bounds are
 * the Form_Validator's `POST /jobs/extract:url` and `POST /jobs/extract:text`
 * schemas, so they are the mirrored Pydantic bounds rather than numbers spelled out
 * here, and a failing value never reaches the network (Requirement 22 AC1, AC12).
 *
 * ## What this panel does not own
 *
 * The poll itself, the decoded draft and the form it pre-populates belong to the
 * screen: AC6's pre-population and AC10's persistence gate are decisions about the
 * *form*, and a panel that owned the draft would have to reach into the form to
 * apply them. So this component starts an extraction, reports the draft identifier
 * upwards, and renders the state of whatever draft it is handed back — pending,
 * failed, or ready with the count of fields that still need manual entry (AC8).
 *
 * ## Why a failed extraction is not an error state
 *
 * A rejected URL or an unreachable page is a perfectly successful request whose
 * *outcome* is that nothing could be extracted (see `extraction.ts` on why `ready`
 * is not the same as succeeded). It is reported as a statement with the extractor's
 * own text, next to a working manual form — not as an error surface that would
 * suggest the platform failed.
 *
 * Requirements: 13.3, 13.4, 13.5, 13.8, 19.2, 19.10, 20.7, 21.6, 22.1, 22.12.
 */

import { Button, Divider, Fieldset, Group, Loader, Stack, Text, Textarea, TextInput } from '@mantine/core'
import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorPresenter, LiveAnnouncement } from '../../errors/ErrorPresenter'
import {
  BOUNDS,
  SCHEMAS,
  validateSchema,
  type ValidationIssue,
} from '../../forms/validators'
import { BidiText } from '../../i18n/DirectionProvider'
import { textForSubmission } from '../../i18n/formatting'
import { issueTexts } from '../admin-accounts'

import { useExtractFromText, useExtractFromUrl } from './authoringQueries'
import { missingExtractedFields, type ExtractionDraft } from './extraction'

/** Namespaces this panel resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['jobs', 'shell', 'errors', 'validation'] as const

/** Renders every message of a set, not merely the first (Req 22 AC9). */
function errorContent(messages: readonly string[]): ReactNode | undefined {
  if (messages.length === 0) {
    return undefined
  }
  return messages.map((message) => (
    <span key={message} style={{ display: 'block' }}>
      {message}
    </span>
  ))
}

export interface JobExtractionPanelProps {
  /** The draft currently being polled, as the screen decoded it. */
  readonly draft?: ExtractionDraft | undefined
  /** Whether the poll has yet to answer for the first time. */
  readonly isPolling?: boolean
  /** A failed poll, rendered by the Error_Presenter. */
  readonly pollError?: unknown
  /** Called with the identifier of a started extraction (AC3, AC4). */
  readonly onStarted: (draftId: string) => void
  /** Called when the user abandons the extraction and returns to a blank form. */
  readonly onDiscard: () => void
}

/** The URL and text extraction controls with their polling surface (AC3–AC5). */
export function JobExtractionPanel({
  draft,
  isPolling = false,
  pollError,
  onStarted,
  onDiscard,
}: JobExtractionPanelProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const scope = useId()
  const [url, setUrl] = useState('')
  const [rawText, setRawText] = useState('')
  const [urlIssues, setUrlIssues] = useState<readonly ValidationIssue[]>([])
  const [textIssues, setTextIssues] = useState<readonly ValidationIssue[]>([])

  const fromUrl = useExtractFromUrl()
  const fromText = useExtractFromText()

  const started = (draftId: string): void => {
    if (draftId !== '') {
      onStarted(draftId)
    }
  }

  const submitUrl = (): void => {
    const found = validateSchema(SCHEMAS.jobExtractUrl, { url })
    setUrlIssues(found)
    if (found.length > 0) {
      return
    }
    fromUrl.mutate(url.trim(), { onSuccess: (created) => started(created.id) })
  }

  const submitText = (): void => {
    const found = validateSchema(SCHEMAS.jobExtractText, { raw_text: rawText })
    setTextIssues(found)
    if (found.length > 0) {
      return
    }
    fromText.mutate(rawText, { onSuccess: (created) => started(created.id) })
  }

  const busy = fromUrl.isPending || fromText.isPending
  const pending = draft?.outcome === 'pending' || (draft === undefined && isPolling)
  const missing = draft === undefined ? [] : missingExtractedFields(draft.fields)

  const startFailure = fromUrl.error ?? fromText.error ?? pollError ?? null

  return (
    <Fieldset legend={t('jobs:extract.legend')} data-testid="job-extraction-panel">
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {t('jobs:extract.description')}
        </Text>

        {startFailure === null ? null : <ErrorPresenter error={startFailure} />}

        {/* AC3 */}
        <Stack gap="xs">
          <TextInput
            id={`${scope}-url`}
            label={t('jobs:extract.urlLabel')}
            description={t('jobs:extract.urlHint', { max: BOUNDS.job.extractUrl.maxLength })}
            placeholder="https://"
            value={url}
            inputMode="url"
            maxLength={BOUNDS.job.extractUrl.maxLength}
            disabled={busy || pending}
            error={errorContent(issueTexts(i18n, urlIssues))}
            errorProps={{ id: `${scope}-url-violation` }}
            onChange={(event) => setUrl(textForSubmission(event.currentTarget.value))}
            data-testid="job-extract-url"
          />
          <Group gap="sm">
            <Button
              type="button"
              variant="light"
              loading={fromUrl.isPending}
              disabled={pending || fromText.isPending}
              onClick={submitUrl}
              data-testid="job-extract-url-submit"
            >
              {t('jobs:extract.fromUrl')}
            </Button>
          </Group>
        </Stack>

        <Divider label={t('jobs:extract.or')} labelPosition="center" />

        {/* AC4 */}
        <Stack gap="xs">
          <Textarea
            id={`${scope}-text`}
            label={t('jobs:extract.textLabel')}
            description={t('jobs:extract.textHint', {
              min: BOUNDS.job.extractText.minLength,
              max: BOUNDS.job.extractText.maxLength,
            })}
            value={rawText}
            autosize
            minRows={4}
            maxRows={12}
            maxLength={BOUNDS.job.extractText.maxLength}
            disabled={busy || pending}
            error={errorContent(issueTexts(i18n, textIssues))}
            errorProps={{ id: `${scope}-text-violation` }}
            onChange={(event) => setRawText(textForSubmission(event.currentTarget.value))}
            data-testid="job-extract-text"
          />
          <Group gap="sm">
            <Button
              type="button"
              variant="light"
              loading={fromText.isPending}
              disabled={pending || fromUrl.isPending}
              onClick={submitText}
              data-testid="job-extract-text-submit"
            >
              {t('jobs:extract.fromText')}
            </Button>
          </Group>
        </Stack>

        {/* AC5: the poll's state, in words. */}
        {pending ? (
          <Group gap="xs" role="status" aria-live="polite" data-testid="job-extract-pending">
            <Loader size="sm" aria-hidden="true" />
            <Text size="sm">{t('jobs:extract.pending')}</Text>
          </Group>
        ) : null}

        {draft?.outcome === 'failed' ? (
          <Stack gap={4} role="status" data-testid="job-extract-failed">
            <Text size="sm" c="red">
              {t('jobs:extract.failed')}
            </Text>
            {draft.failureMessage === null ? null : (
              // Backend_Api text, rendered byte-identically (Req 19 AC10).
              <Text size="sm" c="dimmed" data-testid="job-extract-failure-message">
                <BidiText value={draft.failureMessage} />
              </Text>
            )}
          </Stack>
        ) : null}

        {draft?.outcome === 'unknown' ? (
          <Text size="sm" role="status" data-testid="job-extract-unknown">
            {t('jobs:extract.unknownStatus', { status: draft.reportedStatus })}
          </Text>
        ) : null}

        {draft?.outcome === 'ready' ? (
          <Stack gap={4} data-testid="job-extract-ready">
            <Text size="sm" c="green">
              {t('jobs:extract.ready')}
            </Text>
            {/* AC8: how many inputs the extraction left for manual entry. */}
            {missing.length === 0 ? null : (
              <Text size="sm" c="dimmed" data-testid="job-extract-missing">
                {t('jobs:extract.missingCount', { count: missing.length })}
              </Text>
            )}
          </Stack>
        ) : null}

        {draft === undefined ? null : (
          <Group gap="sm">
            <Button
              type="button"
              variant="default"
              onClick={() => {
                setUrl('')
                setRawText('')
                setUrlIssues([])
                setTextIssues([])
                fromUrl.reset()
                fromText.reset()
                onDiscard()
              }}
              data-testid="job-extract-discard"
            >
              {t('jobs:extract.discard')}
            </Button>
          </Group>
        )}

        <LiveAnnouncement
          message={
            draft?.outcome === 'ready'
              ? t('jobs:announce.extractionReady')
              : draft?.outcome === 'failed'
                ? t('jobs:announce.extractionFailed')
                : null
          }
        />
      </Stack>
    </Fieldset>
  )
}
