/**
 * One CV_Variant as the list renders it (Requirement 11 AC1).
 *
 * AC1 fixes what is shown: the name, the description, the primary designation,
 * the archived designation and the version count. The primary badge is not read
 * off `is_primary` per row but resolved across the whole list by
 * {@link isRenderedPrimary}, which is what makes "exactly one variant renders as
 * primary" (AC7) a property of the rendering rather than a hope about the payload.
 *
 * The name and the description are Backend_Api text and go through `BidiText`, so
 * an Arabic or Hebrew variant name is rendered byte-identically and is
 * bidi-isolated from the Latin controls around it (Req 19 AC10).
 *
 * The version count is rendered here; the versions themselves are task 17.2,
 * which fills in the detail screen this card links to.
 *
 * Requirements: 11.1, 11.7, 19.2, 19.10, 19.12.
 */

import { Anchor, Badge, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { BidiText } from '../../i18n/DirectionProvider'
import { formatDateTime, formatNumber } from '../../i18n/formatting'
import { useActiveLocale } from '../../i18n/localeDirection'
import { candidateCvVariantPath } from '../../routing/paths'

import { CvVariantActions } from './CvVariantActions'
import { isRenderedPrimary, type CvVariant } from './variantRules'

/** Namespaces the card resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['cvs', 'shell'] as const

export interface CvVariantCardProps {
  readonly variant: CvVariant
  /** The whole list: the primary designation and the archive guard are list facts. */
  readonly variants: readonly CvVariant[]
  /** Renders the link to the variant's own screen. Omitted on that screen itself. */
  readonly withDetailLink?: boolean
}

/** One variant, with its designations and its controls. */
export function CvVariantCard({ variant, variants, withDetailLink = true }: CvVariantCardProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const locale = useActiveLocale(i18n)
  const primary = isRenderedPrimary(variant, variants)

  return (
    <Paper withBorder p="md" data-testid={`variant-card-${variant.id}`}>
      <Stack gap="xs">
        <Group gap="xs" justify="space-between" wrap="wrap">
          <Title order={3} size="h5" data-testid={`variant-name-${variant.id}`}>
            <BidiText value={variant.name} />
          </Title>
          <Group gap="xs">
            {primary ? (
              <Badge color="blue" data-testid={`variant-primary-badge-${variant.id}`}>
                {t('cvs:primary.badge')}
              </Badge>
            ) : null}
            {variant.is_archived ? (
              <Badge color="gray" variant="light" data-testid={`variant-archived-badge-${variant.id}`}>
                {t('cvs:archived.badge')}
              </Badge>
            ) : null}
          </Group>
        </Group>

        {variant.description === null || variant.description === '' ? null : (
          <Text size="sm" data-testid={`variant-description-${variant.id}`}>
            <BidiText value={variant.description} />
          </Text>
        )}

        <Group gap="md">
          <Text size="sm" c="dimmed" data-testid={`variant-version-count-${variant.id}`}>
            {t('cvs:versions.count', { value: formatNumber(variant.version_count, locale) })}
          </Text>
          <Text size="sm" c="dimmed">
            {t('cvs:created', { value: formatDateTime(variant.created_at, locale) })}
          </Text>
        </Group>

        {withDetailLink ? (
          <Anchor
            component={Link}
            to={candidateCvVariantPath(variant.id)}
            size="sm"
            data-testid={`variant-detail-link-${variant.id}`}
          >
            {t('cvs:versions.manage')}
          </Anchor>
        ) : null}

        <CvVariantActions variant={variant} variants={variants} />
      </Stack>
    </Paper>
  )
}
