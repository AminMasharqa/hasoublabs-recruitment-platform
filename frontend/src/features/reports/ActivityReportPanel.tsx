/**
 * The activity report (Requirement 18 AC1).
 *
 * AC1 asks for *every returned metric*, and the list it renders is
 * {@link ACTIVITY_METRIC_KEYS} — derived from the contract type in
 * `activityMetrics.ts`, so a metric the Backend_Api adds cannot be silently
 * dropped from this panel.
 *
 * The two period members are rendered too — they are what the counts are counts
 * *of* — but separately from the counts, because they are instants rather than
 * numbers and an unbounded report returns them as `null`.
 *
 * Counts are formatted for the active Locale and the period is formatted in UTC,
 * which stays the authoritative zone (Requirement 19 AC12).
 *
 * Requirements: 18.1, 19.2, 19.12, 20.5.
 */

import { Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { formatDateTime, formatNumber } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'

import { ACTIVITY_METRIC_KEYS } from './activityMetrics'
import type { ActivityReport } from './reportsApi'

/** Namespaces the panel resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['reports', 'shell'] as const

export interface ActivityReportPanelProps {
  readonly report: ActivityReport
}

/** The activity report metrics (AC1). */
export function ActivityReportPanel({ report }: ActivityReportPanelProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const unbounded = t('reports:activity.unbounded')

  return (
    <Stack gap="sm" data-testid="activity-report">
      <Stack gap={2}>
        <Text size="sm" c="dimmed">
          {t('reports:activity.period')}
        </Text>
        <Text size="sm" data-testid="activity-period">
          {t('reports:activity.periodRange', {
            from:
              report.period_from === null ? unbounded : formatDateTime(report.period_from, locale),
            to: report.period_to === null ? unbounded : formatDateTime(report.period_to, locale),
          })}
        </Text>
      </Stack>

      <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="sm">
        {ACTIVITY_METRIC_KEYS.map((key) => (
          <Paper key={key} withBorder p="sm" data-testid={`activity-metric-${key}`}>
            <Stack gap={0}>
              <Text size="xs" c="dimmed" id={`activity-metric-label-${key}`}>
                {t(`reports:metric.${key}`)}
              </Text>
              <Title
                order={3}
                size="h4"
                aria-describedby={`activity-metric-label-${key}`}
                data-testid={`activity-metric-value-${key}`}
              >
                {formatNumber(report[key], locale)}
              </Title>
            </Stack>
          </Paper>
        ))}
      </SimpleGrid>
    </Stack>
  )
}
