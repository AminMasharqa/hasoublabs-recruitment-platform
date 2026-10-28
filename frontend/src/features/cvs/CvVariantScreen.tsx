/**
 * `/candidate/cvs/:variantId` — one CV_Variant (Requirement 11 AC1, AC4–AC7).
 *
 * The same variant facts and the same controls as the list row, on a screen of
 * their own, because the versions of a variant belong here: `CvVersionPanel`
 * mounts the version list, the upload control and the scan-state polling of
 * AC8–AC18 directly below the variant panel, addressed by the `variantId` path
 * parameter this screen already resolves.
 *
 * The variant is read from the same `GET /me/cv-variants` list the screen before
 * it rendered, for two reasons: the endpoint set carries no single-variant read,
 * and the guards of AC6 and AC7 are facts about the *list* — whether this is the
 * last active variant, and which variant is the primary one — so the list is what
 * the controls need regardless. Arriving here directly (a bookmark, a reload)
 * therefore issues the list read and resolves the variant from it, and a
 * `variantId` that names no variant of this Candidate renders a plain
 * not-found notice rather than an empty shell.
 *
 * Requirements: 11.1, 11.4, 11.5, 11.6, 11.7, 11.8, 11.12, 11.15, 19.2, 21.6, 21.8.
 */

import { Anchor, Container, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { ErrorState, LoadingState } from '../../errors/ErrorPresenter'
import { ROUTE_PATHS } from '../../routing/paths'

import { CvVariantCard } from './CvVariantCard'
import { CvVersionPanel } from './CvVersionPanel'
import { useCvVariantsQuery } from './variantQueries'
import { findVariant } from './variantRules'

/** Namespaces this screen resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['cvs', 'shell', 'errors'] as const

/**
 * The single-variant screen.
 *
 * Registered by the shell for the `candidateCvVariant` path id; it holds no route
 * knowledge beyond reading its own path parameter.
 */
export function CvVariantScreen() {
  const { t } = useTranslation(NAMESPACES)
  const { variantId } = useParams<{ variantId: string }>()
  const variants = useCvVariantsQuery()
  const variant = variants.data === undefined ? null : findVariant(variants.data, variantId)

  return (
    <Container size="md" py="md" data-testid="cv-variant-screen">
      <Stack gap="md">
        <Anchor component={Link} to={ROUTE_PATHS.candidateCvs} size="sm" data-testid="cv-variant-back">
          {t('cvs:detail.back')}
        </Anchor>

        {variants.isPending ? (
          <LoadingState label={t('cvs:title')} />
        ) : variants.isError ? (
          <ErrorState
            error={variants.error}
            onRetry={() => {
              void variants.refetch()
            }}
          />
        ) : variant === null ? (
          <Stack gap={4} role="status" data-testid="cv-variant-not-found">
            <Title order={1} size="h3">
              {t('cvs:detail.notFoundTitle')}
            </Title>
            <Text c="dimmed">{t('cvs:detail.notFound')}</Text>
          </Stack>
        ) : (
          <>
            <CvVariantCard variant={variant} variants={variants.data} withDetailLink={false} />
            {/*
             * The version half of Requirement 11: the upload control of AC8–AC11,
             * the version list of AC15, the ≤10s `PendingScan` poll of AC12 and the
             * download gating of AC13/AC14/AC16. It is given the resolved variant's
             * identifier rather than the raw path parameter, so it is mounted only
             * for a variant that exists — an unknown identifier renders the
             * not-found notice above and issues no version read.
             */}
            <CvVersionPanel variantId={variant.id} />
          </>
        )}
      </Stack>
    </Container>
  )
}
