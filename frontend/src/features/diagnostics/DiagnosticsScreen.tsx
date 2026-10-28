/**
 * The diagnostics surface (Requirement 23 AC5, AC6).
 *
 * Two facts, and nothing else:
 *
 * - **AC5** the bundle version identifier of the JavaScript that is actually
 *   running, baked in at build time (`bundleVersion.ts`).
 * - **AC6** the status `GET /health` returns, rendered as the service reported it
 *   (`health.ts`).
 *
 * Plus the Support_Reference of the most recent failed request, which
 * Requirement 23 AC3 retains for the browsing context and which has to be
 * *readable* somewhere for that retention to be worth anything. The uniform
 * authorization-denied surface deliberately renders none (Req 21 AC4), and the
 * recovery boundary only appears after a rendering crash, so this screen is where
 * a user who was refused ten minutes ago can still find the reference to quote.
 * It renders only when a failure has been recorded, so a session that has had
 * none shows nothing — a Support_Reference still never accompanies a success
 * (AC4).
 *
 * ## Why the probe is a query and not a one-off fetch
 *
 * `useQuery` gives the three states Requirement 21 AC6 and AC8 ask of every
 * asynchronous read for free — the loading indicator, the localized error message
 * with its Support_Reference and its retry control — and `dataUpdatedAt` is the
 * honest answer to "when was this checked", taken from the cache rather than from
 * a clock this component would have to hold. `staleTime: 0` is the one default
 * this screen overrides: a cached health answer is worthless, because the whole
 * point of opening the screen is to ask *now*.
 *
 * ## Accessibility and localization
 *
 * Every string is a `shell` catalogue entry (Req 19 AC2) in all three locales.
 * The two machine values — the bundle identifier and the reported status — are
 * rendered through `BidiText`, byte-identically and bidi-isolated, so an
 * identifier read out to support is not visually reordered by the Arabic or
 * Hebrew label beside it (Req 19 AC10). The probe outcome is announced through a
 * live region without moving focus (Req 20 AC7), and the timestamp is shown both
 * in the active Locale's convention and as its authoritative UTC value
 * (Req 19 AC12).
 *
 * Requirements: 23.5, 23.6.
 */

import { Container, Paper, Stack, Text, Title } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState, LiveAnnouncement, LoadingState } from '../../errors/ErrorPresenter'
import { supportReferenceOf } from '../../errors/errorMessages'
import { SupportReference } from '../../errors/SupportReference'
import { useLatestFailedSupportReference } from '../../errors/supportReferenceStore'
import { BidiText } from '../../i18n/DirectionProvider'
import { formatDateTime, utcTimestamp } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'
import { useApiClient } from '../../shell/appServices'

import { bundleVersion } from './bundleVersion'
import { fetchHealth, HEALTH_QUERY_KEY, type HealthReport } from './health'

/** Namespaces this screen resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['shell', 'errors'] as const

interface FactProps {
  /** Localized label of the fact. */
  readonly label: string
  readonly children: ReactNode
}

/**
 * One labelled diagnostic fact.
 *
 * A description list rather than a heading-and-paragraph pair: the label names
 * the value and nothing more, so `dt`/`dd` is what assistive technology should
 * hear, and the association needs no `aria-*` wiring to be correct.
 */
function Fact({ label, children }: FactProps) {
  return (
    <Paper withBorder p="md">
      <Stack component="dl" gap={4} m={0}>
        <Text component="dt" size="sm" c="dimmed">
          {label}
        </Text>
        <Text component="dd" m={0}>
          {children}
        </Text>
      </Stack>
    </Paper>
  )
}

interface HealthFactsProps {
  readonly report: HealthReport
  /** When the answer arrived, as epoch milliseconds from the cache. */
  readonly checkedAtMs: number
}

/** The resolved probe: the localized reading, the reported value, the instant (AC6). */
function HealthFacts({ report, checkedAtMs }: HealthFactsProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)

  return (
    <Stack gap="xs" data-testid="diagnostics-health">
      <Text data-testid="diagnostics-health-indicator">
        {t(`shell:diagnostics.status.${report.indicator}`)}
      </Text>
      {report.status === null ? null : (
        <Text size="sm" c="dimmed">
          {t('shell:diagnostics.reportedStatus')}
          {': '}
          <Text component="span" ff="monospace" data-testid="diagnostics-health-status">
            <BidiText value={report.status} />
          </Text>
        </Text>
      )}
      <Text size="sm" c="dimmed" data-testid="diagnostics-health-checked-at">
        {t('shell:diagnostics.checkedAt')}
        {': '}
        {formatDateTime(checkedAtMs, locale)}
        {' · '}
        {t('shell:diagnostics.utc', { value: utcTimestamp(checkedAtMs) })}
      </Text>
    </Stack>
  )
}

/**
 * The `/diagnostics` screen.
 *
 * Registered by the shell through the route `elements` table for the
 * `diagnostics` path id; it holds no route knowledge of its own.
 */
export function DiagnosticsScreen() {
  const { t } = useTranslation(NAMESPACES)
  const api = useApiClient()
  const version = bundleVersion()
  const retainedReference = useLatestFailedSupportReference()

  const health = useQuery<HealthReport>({
    queryKey: HEALTH_QUERY_KEY,
    queryFn: ({ signal }) => fetchHealth(api, signal),
    // Opening this screen is a request to check now, so nothing cached counts.
    staleTime: 0,
  })

  /**
   * The retained reference, unless it belongs to the probe failure this screen is
   * already showing — a failing probe *becomes* the most recent failed request, so
   * without this the same identifier would appear twice under two different
   * labels, and a user quoting it would have to guess which one matters.
   */
  const earlierFailureReference =
    retainedReference !== null && retainedReference !== supportReferenceOf(health.error)
      ? retainedReference
      : null

  return (
    <Container size="sm" py="md" data-testid="diagnostics-screen">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('shell:diagnostics.title')}
          </Title>
          <Text c="dimmed">{t('shell:diagnostics.description')}</Text>
        </Stack>

        {/* Requirement 23 AC5. */}
        <Fact label={t('shell:diagnostics.bundleVersion')}>
          {version === null ? (
            <Text component="span" c="dimmed" data-testid="diagnostics-bundle-version-unknown">
              {t('shell:diagnostics.bundleVersionUnknown')}
            </Text>
          ) : (
            <Text component="span" ff="monospace" data-testid="diagnostics-bundle-version">
              <BidiText value={version} />
            </Text>
          )}
        </Fact>

        {/* Requirement 23 AC6. */}
        <Fact label={t('shell:diagnostics.apiHealth')}>
          {health.isPending ? (
            <LoadingState label={t('shell:diagnostics.apiHealth')} />
          ) : health.isError ? (
            <ErrorState
              error={health.error}
              onRetry={() => {
                void health.refetch()
              }}
            />
          ) : (
            <HealthFacts report={health.data} checkedAtMs={health.dataUpdatedAt} />
          )}
        </Fact>

        {/*
         * Requirement 23 AC1, AC3: the retained reference of the most recent
         * failed request. The whole row is omitted when there has been none, so a
         * session that has seen no failure carries no reference and no empty
         * label promising one (AC4).
         */}
        {earlierFailureReference === null ? null : (
          <Fact label={t('shell:diagnostics.latestFailure')}>
            <SupportReference reference={earlierFailureReference} showHint />
          </Fact>
        )}

        {/* Req 20 AC7: announced without moving focus. */}
        <LiveAnnouncement
          message={
            health.isPending
              ? null
              : health.isError
                ? t('shell:state.errorTitle')
                : t(`shell:diagnostics.status.${health.data.indicator}`)
          }
          assertive={health.isError}
        />
      </Stack>
    </Container>
  )
}
