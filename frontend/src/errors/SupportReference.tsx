/**
 * The Support_Reference surface.
 *
 * Requirement 23:
 * - AC1 the Support_Reference of a failed request is rendered in every error
 *   state, error dialog and recovery boundary ({@link SupportReference},
 *   {@link LatestSupportReference}).
 * - AC2 a copy control places it on the clipboard ({@link SupportReference}).
 * - AC3 the most recent failed request's reference is retained for the lifetime
 *   of the browsing context — that retention lives in `supportReferenceStore.ts`
 *   and is read here through {@link useLatestFailedSupportReference}.
 * - AC4 a Support_Reference is never rendered on a successful outcome:
 *   {@link SupportReference} renders nothing at all for an absent or blank
 *   reference, and the store only ever records a failure, so no successful
 *   outcome has a value to render.
 *
 * Requirement 21 AC2 renders this beside the generic fallback message and AC8
 * renders it inside the read-failure error state; both go through
 * `ErrorPresenter.tsx`. AC11 renders {@link LatestSupportReference} in the
 * recovery boundary, which has no error object of its own.
 */

import { Group, Text, Tooltip, UnstyledButton } from '@mantine/core'
import { useClipboard } from '@mantine/hooks'
import { useTranslation } from 'react-i18next'

import { BidiText } from '../i18n/DirectionProvider'

import {
  usableSupportReference,
  useLatestFailedSupportReference,
} from './supportReferenceStore'

/** How long the copy control reports success before reverting to its label. */
export const COPY_FEEDBACK_MS = 2000

export interface SupportReferenceProps {
  /**
   * The failed request's Support_Reference. `null`, `undefined` and blank render
   * nothing, which is what keeps a successful outcome free of one (AC4).
   */
  readonly reference: string | null | undefined
  /** Whether to render the "quote this when you contact support" hint. */
  readonly showHint?: boolean
  /** Class applied to the wrapper, for surface-specific spacing. */
  readonly className?: string
}

/**
 * Renders a failed request's Support_Reference with a copy control (AC1, AC2).
 *
 * The value is rendered through {@link BidiText}, so it is byte-identical to the
 * `X-Request-ID` the server issued and bidi-isolated from the localized label
 * beside it — an identifier a user reads out to support must not be visually
 * reordered by surrounding Arabic or Hebrew text (Requirement 19 AC10).
 *
 * The copy control carries an explicit accessible name (Requirement 20 AC8) and
 * its visible label reports the copy outcome. When the clipboard is unavailable
 * the rendered value remains selectable text, which is the fallback a user still
 * has.
 */
export function SupportReference({ reference, showHint = false, className }: SupportReferenceProps) {
  const { t } = useTranslation('shell')
  const clipboard = useClipboard({ timeout: COPY_FEEDBACK_MS })
  const value = usableSupportReference(reference)

  if (value === null) {
    return null
  }

  return (
    <div className={className} data-testid="support-reference">
      <Group gap="xs" wrap="wrap" align="center">
        <Text component="span" size="sm" fw={500}>
          {t('supportReference.label')}
        </Text>
        <Text component="span" size="sm" ff="monospace" data-testid="support-reference-value">
          <BidiText value={value} />
        </Text>
        <Tooltip label={t('supportReference.copy')} withArrow>
          <UnstyledButton
            type="button"
            onClick={() => {
              clipboard.copy(value)
            }}
            aria-label={t('supportReference.copy')}
            data-testid="support-reference-copy"
            style={{ textDecoration: 'underline' }}
          >
            <Text component="span" size="sm">
              {clipboard.copied ? t('action.copied') : t('action.copy')}
            </Text>
          </UnstyledButton>
        </Tooltip>
      </Group>
      {showHint ? (
        <Text size="xs" c="dimmed">
          {t('supportReference.hint')}
        </Text>
      ) : null}
    </div>
  )
}

/**
 * Renders the retained Support_Reference of the most recent failed request (AC3)
 * for a surface that holds no error object — the recovery boundary of
 * Requirement 21 AC11.
 *
 * Renders nothing when no failure has been recorded in this browsing context, so
 * a first-render crash shows no empty reference row.
 */
export function LatestSupportReference({
  showHint = true,
  className,
}: Omit<SupportReferenceProps, 'reference'> = {}) {
  const reference = useLatestFailedSupportReference()
  return <SupportReference reference={reference} showHint={showHint} className={className} />
}
