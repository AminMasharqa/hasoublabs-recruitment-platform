/**
 * The three per-variant controls: make primary, edit, archive
 * (Requirement 11 AC4, AC5, AC6, AC7).
 *
 * Rendered by both the list and the detail screen, so a Candidate finds the same
 * controls, the same refusals and the same confirmation wherever they are looking
 * at a variant. Every enablement decision is delegated to `variantRules.ts`:
 *
 * - The archive control is disabled while it is the last active variant, and the
 *   reason is rendered beside it as text (AC6). It is disabled, not hidden,
 *   because the control disappearing tells the Candidate nothing about why.
 * - Archiving always goes through a confirmation dialog (AC5). The request is
 *   issued from the dialog's confirm control and nowhere else, so there is no
 *   path to an unconfirmed archive.
 * - The primary control is offered only for a variant that is not already the
 *   rendered primary and is not archived (AC7).
 *
 * The dialog is a `Modal` from `@mantine/core` — `@mantine/modals` is not a
 * dependency of this workspace — which confines focus while it is open and
 * restores it to the control that opened it on close (Req 20 AC11).
 *
 * Requirements: 11.4, 11.5, 11.6, 11.7, 19.2, 20.7, 20.11.
 */

import { Button, Group, Modal, Stack, Text } from '@mantine/core'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorPresenter, LiveAnnouncement } from '../../errors/ErrorPresenter'

import { CvVariantForm } from './CvVariantForm'
import {
  useArchiveCvVariant,
  useSetPrimaryCvVariant,
  useUpdateCvVariant,
} from './variantQueries'
import {
  archiveBlockedReason,
  canSetPrimary,
  MAX_ACTIVE_VARIANTS,
  type CvVariant,
} from './variantRules'

/** Namespaces the controls resolve their strings against (Req 19 AC2). */
const NAMESPACES = ['cvs', 'shell', 'errors'] as const

export interface CvVariantActionsProps {
  /** The variant these controls act on. */
  readonly variant: CvVariant
  /**
   * The whole list, because both guards are decided from it: the archive refusal
   * counts the active variants (AC6) and the primary designation is resolved
   * across them (AC7).
   */
  readonly variants: readonly CvVariant[]
}

/** Make-primary, edit and archive for one variant. */
export function CvVariantActions({ variant, variants }: CvVariantActionsProps) {
  const { t } = useTranslation(NAMESPACES)
  const scope = useId()
  const [editing, setEditing] = useState(false)
  const [confirmingArchive, setConfirmingArchive] = useState(false)

  const update = useUpdateCvVariant()
  const archive = useArchiveCvVariant()
  const setPrimary = useSetPrimaryCvVariant()

  const blockedReason = archiveBlockedReason(variant, variants)
  const archiveReasonId = `${scope}-archive-reason`
  const primaryOffered = canSetPrimary(variant, variants)

  /**
   * The one outcome announced, without moving focus (Req 20 AC7). At most one of
   * the three mutations has just succeeded, since each closes over one control.
   */
  const announcement = setPrimary.isSuccess
    ? t('cvs:announce.primary')
    : update.isSuccess
      ? t('cvs:announce.updated')
      : archive.isSuccess
        ? t('cvs:announce.archived')
        : null

  const closeEditor = (): void => {
    setEditing(false)
    update.reset()
  }

  const closeArchiveConfirmation = (): void => {
    setConfirmingArchive(false)
    archive.reset()
  }

  return (
    <Stack gap="xs">
      <Group gap="xs">
        {primaryOffered ? (
          <Button
            type="button"
            variant="light"
            size="xs"
            loading={setPrimary.isPending}
            onClick={() => {
              setPrimary.mutate(variant.id)
            }}
            data-testid={`variant-set-primary-${variant.id}`}
          >
            {t('cvs:primary.set')}
          </Button>
        ) : null}

        {variant.is_archived ? null : (
          <Button
            type="button"
            variant="default"
            size="xs"
            onClick={() => {
              setEditing(true)
            }}
            data-testid={`variant-edit-${variant.id}`}
          >
            {t('cvs:edit.open')}
          </Button>
        )}

        {variant.is_archived ? null : (
          <Button
            type="button"
            variant="default"
            size="xs"
            color="red"
            disabled={blockedReason !== null}
            {...(blockedReason === null ? {} : { 'aria-describedby': archiveReasonId })}
            onClick={() => {
              setConfirmingArchive(true)
            }}
            data-testid={`variant-archive-${variant.id}`}
          >
            {t('cvs:archive.open')}
          </Button>
        )}
      </Group>

      {/* AC6: the refusal is stated, not merely enacted. */}
      {blockedReason === 'last_active' ? (
        <Text id={archiveReasonId} size="xs" c="dimmed" data-testid={`variant-archive-reason-${variant.id}`}>
          {t('cvs:archive.lastActiveReason')}
        </Text>
      ) : null}

      {setPrimary.isError ? <ErrorPresenter error={setPrimary.error} /> : null}

      {/* AC4: the edit dialog. */}
      <Modal
        opened={editing}
        onClose={closeEditor}
        title={t('cvs:edit.title')}
        closeButtonProps={{ 'aria-label': t('shell:action.close') }}
      >
        <CvVariantForm
          idPrefix="variant-edit"
          variant={variant}
          submitLabel={t('cvs:edit.submit')}
          pending={update.isPending}
          error={update.error}
          onCancel={closeEditor}
          onSubmit={(draft) => {
            update.mutate({ variant, draft }, { onSuccess: () => setEditing(false) })
          }}
        />
      </Modal>

      {/* AC5: archiving happens only after this confirmation. */}
      <Modal
        opened={confirmingArchive}
        onClose={closeArchiveConfirmation}
        title={t('cvs:archive.title')}
        closeButtonProps={{ 'aria-label': t('shell:action.close') }}
      >
        <Stack gap="sm" data-testid="variant-archive-confirm">
          <Text>{t('cvs:archive.body', { max: MAX_ACTIVE_VARIANTS })}</Text>
          {archive.isError ? <ErrorPresenter error={archive.error} /> : null}
          <Group gap="sm">
            <Button
              type="button"
              color="red"
              loading={archive.isPending}
              onClick={() => {
                archive.mutate(variant.id, { onSuccess: () => setConfirmingArchive(false) })
              }}
              data-testid="variant-archive-confirm-submit"
            >
              {t('cvs:archive.confirm')}
            </Button>
            <Button
              type="button"
              variant="default"
              disabled={archive.isPending}
              onClick={closeArchiveConfirmation}
              data-testid="variant-archive-confirm-cancel"
            >
              {t('shell:action.cancel')}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <LiveAnnouncement message={announcement} />
    </Stack>
  )
}
