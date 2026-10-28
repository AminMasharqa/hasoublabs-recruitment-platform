/**
 * `/admin/exports` — the exports destination (Requirement 18 AC6–AC11).
 *
 * The same {@link ExportPanel} the reports destination carries, on its own screen
 * for the Admin who came to export rather than to read. It is the export half of
 * Requirement 18 and nothing else: no report is read here, so nothing competes
 * with the poll for attention.
 *
 * The filters are read from this screen's own address bar through the same
 * `reportFilters.ts` round trip, so an export requested here is bounded exactly as
 * one requested from the reports destination (AC6), and a link to a bounded export
 * is shareable.
 *
 * AC11 is a property of the route: `/admin/exports` sits in the `admin` guarded
 * group, so neither the destination nor this screen is reachable while the
 * Active_Context is `CANDIDATE` or `SENIOR`.
 *
 * Requirements: 18.6, 18.7, 18.8, 18.9, 18.10, 18.11, 19.2.
 */

import { Container, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { ExportPanel } from './ExportPanel'
import { ReportFilterControls } from './ReportFilterControls'
import { readReportFilters, writeReportFilters, type ReportFilters } from './reportFilters'

/** Namespaces this screen resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['reports', 'shell'] as const

/** The exports destination. */
export function ExportsScreen() {
  const { t } = useTranslation(NAMESPACES)
  const [searchParams, setSearchParams] = useSearchParams()

  const filters = readReportFilters(searchParams)
  const appliedQuery = writeReportFilters(filters).toString()

  const applyFilters = (applied: ReportFilters) => {
    setSearchParams(writeReportFilters(applied))
  }

  return (
    <Container size="md" py="md" data-testid="exports-screen">
      <Stack gap="lg">
        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('reports:exports.title')}
          </Title>
          <Text c="dimmed">{t('reports:exports.description')}</Text>
        </Stack>

        <ReportFilterControls
          key={appliedQuery}
          applied={filters}
          onApply={applyFilters}
          onClear={() => setSearchParams(new URLSearchParams())}
        />

        <ExportPanel filters={filters} />
      </Stack>
    </Container>
  )
}
