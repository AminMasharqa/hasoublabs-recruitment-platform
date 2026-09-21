/**
 * The Audit_Log chain verification surface (Requirement 17 AC6, AC7).
 *
 * AC6: a verify control that calls `GET /admin/audit/chain/verify` and renders the
 * returned `ok`, `first_bad_id`, `checked_from_id` and `max_id`. All four are shown
 * on every answer, including an intact one — the range that was walked is what
 * makes an "intact" verdict mean something, and `first_bad_id` is stated as absent
 * rather than omitted, so a reader can tell "no bad entry" from "this screen did
 * not show me that field".
 *
 * AC7: an `ok` of false renders a tampering alert naming `first_bad_id`. The
 * verdict is decided by `chainVerdict`, which treats anything that is not the
 * boolean `true` as a chain that did not verify — see `chainVerify.ts` for why that
 * asymmetry is deliberate.
 *
 * ## Why nothing is verified until asked
 *
 * A chain walk is expensive on the Backend_Api and nobody opening the Audit_Log
 * asked for one, so the query starts disabled and the control is what enables it.
 * A second press refetches, because the answer is about the chain *now*.
 *
 * Requirements: 17.6, 17.7, 19.2, 20.7, 21.6, 21.8.
 */

import { Alert, Button, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState, LiveAnnouncement, LoadingState } from '../../errors/ErrorPresenter'
import { BidiText } from '../../i18n/DirectionProvider'
import { formatNumber } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'

import { useChainVerifyQuery } from './auditQueries'
import { chainOkValue, chainRange, chainVerdict } from './chainVerify'

/** Namespaces this panel resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['audit', 'shell', 'errors'] as const

interface VerifyFactProps {
  readonly label: string
  readonly testId: string
  readonly children: React.ReactNode
}

/** One labelled member of the verification response (AC6). */
function VerifyFact({ label, testId, children }: VerifyFactProps) {
  return (
    <Stack gap={0}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" ff="monospace" data-testid={testId}>
        {children}
      </Text>
    </Stack>
  )
}

/** The chain verification panel (AC6, AC7). */
export function ChainVerifyPanel() {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  /**
   * Whether verification has been asked for.
   *
   * Separate from the query's own state because "not asked" and "asked, still
   * running" are different things to render, and a disabled query reports both as
   * pending.
   */
  const [asked, setAsked] = useState(false)
  const verify = useChainVerifyQuery({ enabled: asked })

  const report = verify.data
  const verdict = chainVerdict(report)
  const range = chainRange(report)
  /** An identifier as text, or the localized "none" for an absent one. */
  const identifier = (value: number | null): string =>
    value === null ? t('audit:verify.none') : formatNumber(value, locale, { useGrouping: false })

  return (
    <Paper withBorder p="md" data-testid="audit-chain-verify">
      <Stack gap="sm">
        <Stack gap={4}>
          <Title order={2} size="h5">
            {t('audit:verify.title')}
          </Title>
          <Text size="sm" c="dimmed">
            {t('audit:verify.description')}
          </Text>
        </Stack>

        <Group gap="sm">
          <Button
            type="button"
            onClick={() => {
              if (asked) {
                void verify.refetch()
              } else {
                setAsked(true)
              }
            }}
            loading={verify.isFetching}
            data-testid="audit-chain-verify-run"
          >
            {t('audit:verify.action')}
          </Button>
        </Group>

        {!asked ? null : verify.isPending ? (
          <LoadingState label={t('audit:verify.running')} />
        ) : verify.isError ? (
          <ErrorState
            error={verify.error}
            onRetry={() => {
              void verify.refetch()
            }}
          />
        ) : verdict === null ? null : (
          <Stack gap="sm">
            {/* AC7: an `ok` of false is a tampering alert naming `first_bad_id`. */}
            {verdict.tampered ? (
              <Alert
                role="alert"
                variant="light"
                color="red"
                withCloseButton={false}
                title={t('audit:verify.tamperedTitle')}
                data-testid="audit-chain-tampered"
              >
                <Text data-testid="audit-chain-tampered-message">
                  {verdict.firstBadId === null
                    ? t('audit:verify.tamperedUnknown')
                    : t('audit:verify.tampered', {
                        id: formatNumber(verdict.firstBadId, locale, { useGrouping: false }),
                      })}
                </Text>
              </Alert>
            ) : (
              <Alert
                role="status"
                variant="light"
                color="teal"
                withCloseButton={false}
                title={t('audit:verify.intactTitle')}
                data-testid="audit-chain-intact"
              >
                <Text>{t('audit:verify.intact')}</Text>
              </Alert>
            )}

            {/* AC6: all four members, on every answer. */}
            <Group gap="lg" wrap="wrap" data-testid="audit-chain-facts">
              <VerifyFact label={t('audit:verify.ok')} testId="audit-chain-ok">
                {/* The contract's own value, rendered verbatim rather than translated. */}
                <BidiText value={chainOkValue(report)} />
              </VerifyFact>
              <VerifyFact label={t('audit:verify.firstBadId')} testId="audit-chain-first-bad-id">
                {identifier(verdict.tampered ? verdict.firstBadId : null)}
              </VerifyFact>
              <VerifyFact label={t('audit:verify.checkedFromId')} testId="audit-chain-checked-from-id">
                {identifier(range.checkedFromId)}
              </VerifyFact>
              <VerifyFact label={t('audit:verify.maxId')} testId="audit-chain-max-id">
                {identifier(range.maxId)}
              </VerifyFact>
            </Group>
          </Stack>
        )}

        {/* Req 20 AC7: announced without moving focus. */}
        <LiveAnnouncement
          message={
            !asked || verify.isFetching
              ? null
              : verify.isError
                ? t('audit:announce.verifyFailed')
                : verdict === null
                  ? null
                  : verdict.tampered
                    ? t('audit:announce.verifyTampered')
                    : t('audit:announce.verifyIntact')
          }
          assertive={verify.isError || verdict?.tampered === true}
        />
      </Stack>
    </Paper>
  )
}
