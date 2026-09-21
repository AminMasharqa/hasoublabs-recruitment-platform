/**
 * `/candidate/cvs` — the Candidate's CV_Variants (Requirement 11 AC1–AC7).
 *
 * The read is `GET /me/cv-variants` and every control on the screen is decided
 * from its answer:
 *
 * - **AC1** each variant is listed with its name, description, primary and
 *   archived designations and version count (`CvVariantCard`).
 * - **AC2** the create control opens the form that posts a 1–100 character name
 *   and an optional ≤300 character description.
 * - **AC3** while five active variants exist the create control is disabled and
 *   the limit is stated as the reason. Disabled rather than hidden: a control that
 *   vanishes explains nothing.
 * - **AC4–AC7** the per-variant controls, in `CvVariantActions`.
 *
 * The loading, empty and error surfaces are the Error_Presenter primitives, so
 * this screen inherits the localized message, the Support_Reference and the retry
 * control of Requirement 21 AC6–AC8 rather than inventing its own.
 *
 * Version upload, scan polling and download (AC8–AC20) are task 17.2 and live on
 * the variant screen this one links to.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 19.2, 20.7, 21.6, 21.7, 21.8.
 */

import { Button, Container, Divider, Paper, Stack, Text, Title } from '@mantine/core'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState, ErrorState, LiveAnnouncement, LoadingState } from '../../errors/ErrorPresenter'
import { formatNumber } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'

import { CvVariantCard } from './CvVariantCard'
import { CvVariantForm } from './CvVariantForm'
import { useCreateCvVariant, useCvVariantsQuery } from './variantQueries'
import {
  canCreateVariant,
  countActiveVariants,
  MAX_ACTIVE_VARIANTS,
  orderVariantsForDisplay,
  type CvVariant,
} from './variantRules'

/** Namespaces this screen resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['cvs', 'shell', 'errors'] as const

interface VariantListProps {
  readonly variants: readonly CvVariant[]
}

/** The listed variants, active ones first (AC1). */
function VariantList({ variants }: VariantListProps) {
  const { t } = useTranslation(NAMESPACES)

  if (variants.length === 0) {
    return <EmptyState destination={t('shell:nav.cvs')} />
  }

  return (
    <Stack gap="md" data-testid="cv-variant-list">
      {orderVariantsForDisplay(variants).map((variant) => (
        <CvVariantCard key={variant.id} variant={variant} variants={variants} />
      ))}
    </Stack>
  )
}

interface CreatePanelProps {
  readonly variants: readonly CvVariant[]
}

/** The create control and the form it opens (AC2, AC3). */
function CreatePanel({ variants }: CreatePanelProps) {
  const { t } = useTranslation(NAMESPACES)
  const scope = useId()
  const [open, setOpen] = useState(false)
  const create = useCreateCvVariant()

  const allowed = canCreateVariant(variants)
  const reasonId = `${scope}-create-reason`

  return (
    <Paper withBorder p="md" data-testid="cv-variant-create-panel">
      <Stack gap="sm">
        <Button
          type="button"
          disabled={!allowed}
          {...(allowed ? {} : { 'aria-describedby': reasonId })}
          aria-expanded={open && allowed}
          onClick={() => {
            setOpen((current) => !current)
            create.reset()
          }}
          data-testid="cv-variant-create-open"
        >
          {t('cvs:create.open')}
        </Button>

        {/* AC3: the limit is stated as the reason, beside the control it disables. */}
        {allowed ? null : (
          <Text id={reasonId} size="sm" c="dimmed" data-testid="cv-variant-create-reason">
            {t('cvs:create.disabledReason', { max: MAX_ACTIVE_VARIANTS })}
          </Text>
        )}

        {allowed && open ? (
          <>
            <Divider />
            <CvVariantForm
              idPrefix="cv-variant-create"
              submitLabel={t('cvs:create.submit')}
              pending={create.isPending}
              error={create.error}
              onCancel={() => {
                setOpen(false)
                create.reset()
              }}
              onSubmit={(draft) => {
                create.mutate(draft, { onSuccess: () => setOpen(false) })
              }}
            />
          </>
        ) : null}

        {/* Req 20 AC7: announced without moving focus. */}
        <LiveAnnouncement message={create.isSuccess ? t('cvs:announce.created') : null} />
      </Stack>
    </Paper>
  )
}

/**
 * The CV_Variant management screen.
 *
 * Registered by the shell for the `candidateCvs` path id; it holds no route
 * knowledge of its own.
 */
export function CvVariantsScreen() {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const variants = useCvVariantsQuery()

  return (
    <Container size="md" py="md" data-testid="cv-variants-screen">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('cvs:title')}
          </Title>
          <Text c="dimmed">{t('cvs:intro', { max: MAX_ACTIVE_VARIANTS })}</Text>
        </Stack>

        {variants.isPending ? (
          <LoadingState label={t('cvs:title')} />
        ) : variants.isError ? (
          <ErrorState
            error={variants.error}
            onRetry={() => {
              void variants.refetch()
            }}
          />
        ) : (
          <>
            <CreatePanel variants={variants.data} />
            <Text size="sm" c="dimmed" data-testid="cv-variant-active-count">
              {t('cvs:activeCount', {
                value: formatNumber(countActiveVariants(variants.data), locale),
                max: formatNumber(MAX_ACTIVE_VARIANTS, locale),
              })}
            </Text>
            <VariantList variants={variants.data} />
          </>
        )}
      </Stack>
    </Container>
  )
}
