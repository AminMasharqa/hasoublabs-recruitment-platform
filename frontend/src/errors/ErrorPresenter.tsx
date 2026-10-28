/**
 * The Error_Presenter: the loading, empty, error and authorization-denied
 * surfaces every feature slice renders.
 *
 * Requirement 21:
 * - AC1 every Error_Envelope `error` member renders its localized catalogue
 *   entry ({@link ErrorMessage}, via `localizeError`).
 * - AC2 an unrecognized `error` member renders the generic localized failure
 *   message together with the Support_Reference ({@link ErrorPresenter}).
 * - AC3/AC4/AC5 one authorization-denied surface, identical in text, actions and
 *   timing for every resource ({@link AuthorizationDeniedNotice}).
 * - AC6 a loading indicator for every unresolved asynchronous read
 *   ({@link LoadingState}).
 * - AC7 an empty state naming the destination, with a clear-filter control while
 *   a filter is applied ({@link EmptyState}).
 * - AC8 an error state carrying the localized message, the Support_Reference and
 *   a retry control ({@link ErrorState}).
 *
 * Requirement 23 AC1 renders the Support_Reference in every error state and
 * AC3 records it as the most recent failed reference; AC4 keeps it off every
 * successful outcome — no primitive here renders on success.
 *
 * Requirement 20: outcomes are announced through a live region and no primitive
 * ever calls `focus()`, so nothing here moves focus (AC7). Every control carries
 * a text alternative (AC8) and every string comes from a catalogue (Req 19 AC2).
 *
 * The mapping itself is pure and lives in `errorMessages.ts`; the retained
 * reference lives in `supportReferenceStore.ts`. This module is rendering only.
 *
 * ## The uniform denial is structural, not conventional
 *
 * Requirement 21 AC3–AC5 forbid the authorization-denied surface from varying —
 * in text, in available actions or in timing — with the requested route or
 * resource identifier, because any variation discloses whether that resource
 * exists. {@link AuthorizationDeniedNotice} therefore takes **no props at all**:
 * there is no parameter through which a resource id, a route, a title override or
 * an extra action could reach it, so the compiler rejects the variation rather
 * than a reviewer having to notice it. {@link ErrorPresenter} branches to it
 * before any catalogue probe or interpolation runs, so the work done between
 * receiving the 403 and rendering is the same for every resource (AC5). It also
 * renders no component that mints a per-render identifier, so two denials
 * produce byte-identical markup and AC4 is checkable by comparing it.
 */

import { Alert, Button, Group, Loader, Paper, Stack, Text, VisuallyHidden } from '@mantine/core'
import type { TOptions } from 'i18next'
import { useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  authorizationDeniedMessage,
  isAuthorizationDenial,
  localizeError,
  supportReferenceOf,
} from './errorMessages'
import { SupportReference } from './SupportReference'
import { recordFailedSupportReference } from './supportReferenceStore'

/** Namespaces every primitive here resolves against. */
const NAMESPACES = ['shell', 'errors'] as const

export interface LiveAnnouncementProps {
  /**
   * The localized outcome to announce. An empty value announces nothing, so the
   * region can be mounted before the outcome is known — which is what lets a
   * screen reader observe the change rather than the initial content.
   */
  readonly message: string | null | undefined
  /** Interrupt the user rather than waiting for a pause. Reserve for failures. */
  readonly assertive?: boolean
}

/**
 * Announces an asynchronous outcome without moving focus (Requirement 20 AC7).
 *
 * Visually hidden and never focusable: the announcement is additive to whatever
 * the surface already renders, and the user's focus stays exactly where they put
 * it.
 */
export function LiveAnnouncement({ message, assertive = false }: LiveAnnouncementProps) {
  return (
    <VisuallyHidden
      role={assertive ? 'alert' : 'status'}
      aria-live={assertive ? 'assertive' : 'polite'}
      aria-atomic="true"
      data-testid="live-announcement"
    >
      {message ?? ''}
    </VisuallyHidden>
  )
}

export interface LoadingStateProps {
  /**
   * Localized label. Defaults to the shared `shell:state.loading` entry; pass a
   * destination-specific one where a screen loads several regions at once.
   */
  readonly label?: string
  /** Render the label as visible text beside the indicator. */
  readonly showLabel?: boolean
}

/**
 * The loading indicator for an unresolved asynchronous read (AC6).
 *
 * `role="status"` plus `aria-busy` names the wait for assistive technology, and
 * the label is always present as text — visibly when `showLabel` is set, in the
 * accessibility tree otherwise — because the spinner itself conveys nothing
 * (Requirement 20 AC8). Motion is Mantine's `Loader`, which honours the
 * reduced-motion preference through the shared theme (Req 20 AC12).
 */
export function LoadingState({ label, showLabel = false }: LoadingStateProps) {
  const { t } = useTranslation(NAMESPACES)
  const text = label ?? t('shell:state.loading')

  return (
    <Group
      role="status"
      aria-live="polite"
      aria-busy="true"
      gap="xs"
      justify="center"
      data-testid="loading-state"
    >
      <Loader size="sm" aria-hidden="true" />
      {showLabel ? (
        <Text size="sm" c="dimmed">
          {text}
        </Text>
      ) : (
        <VisuallyHidden>{text}</VisuallyHidden>
      )}
    </Group>
  )
}

interface EmptyStateBase {
  /**
   * The localized name of the destination the read belongs to — resolve it from
   * a catalogue entry, e.g. `t('shell:nav.jobs')`. AC7 requires the empty state
   * to name it.
   */
  readonly destination: string
  /** Optional localized elaboration rendered under the message. */
  readonly description?: ReactNode
  /** Further actions for this destination, e.g. a create control. */
  readonly children?: ReactNode
}

/**
 * Props of {@link EmptyState}.
 *
 * A discriminated union, so AC7's "WHERE a filter is applied, present a
 * clear-filter control" is a compile-time obligation: `filtered` cannot be set
 * without supplying the handler the control needs.
 */
export type EmptyStateProps =
  | (EmptyStateBase & {
      readonly filtered?: false
      readonly onClearFilters?: never
    })
  | (EmptyStateBase & {
      readonly filtered: true
      readonly onClearFilters: () => void
    })

/**
 * The empty state for a read that resolved with zero items (AC7).
 *
 * Names the destination, and while a filter is applied says so and offers the
 * clear-filter control. `role="status"` announces the outcome without moving
 * focus (Requirement 20 AC7).
 */
export function EmptyState(props: EmptyStateProps) {
  const { destination, description, children, filtered } = props
  const { t } = useTranslation(NAMESPACES)
  const message = filtered
    ? t('shell:state.emptyFiltered', { destination })
    : t('shell:state.empty', { destination })

  return (
    <Stack gap="xs" role="status" aria-live="polite" data-testid="empty-state">
      <Text>{message}</Text>
      {description === undefined ? null : (
        <Text size="sm" c="dimmed">
          {description}
        </Text>
      )}
      {filtered === true || children !== undefined ? (
        <Group gap="sm">
          {filtered === true ? (
            <Button
              type="button"
              variant="default"
              onClick={props.onClearFilters}
              data-testid="empty-state-clear-filters"
            >
              {t('shell:action.clearFilters')}
            </Button>
          ) : null}
          {children}
        </Group>
      ) : null}
    </Stack>
  )
}

/**
 * The one authorization-denied surface (AC3, AC4, AC5).
 *
 * Takes no props, so it cannot be told which route or resource was refused, and
 * cannot be given extra or different actions on one screen versus another: the
 * text is one constant catalogue entry and the action set is empty on every
 * screen. Navigation away stays available through the application shell, which
 * the surface is rendered inside and which is itself resource-independent.
 *
 * No Support_Reference is rendered here, and that is deliberate. A reference is a
 * per-request value; rendering it would make the surface carry something that
 * differs between two denials, which is exactly the observable variation AC4
 * removes. The reference of the denied request is still retained for the
 * browsing context by {@link ErrorPresenter} (Req 23 AC3), so support can trace
 * it from the recovery boundary or the diagnostics surface.
 *
 * `role="alert"` announces the refusal without moving focus (Req 20 AC7).
 *
 * Deliberately built from `Paper` and `Text` rather than from `Alert`: `Alert`
 * mints a per-render element id for its `aria-describedby`, which would make two
 * denials differ in markup — and would collide if two panels were refused at
 * once. Without it the surface is byte-identical every time, which is how AC4 is
 * verified.
 */
export function AuthorizationDeniedNotice() {
  const { i18n } = useTranslation(NAMESPACES)

  return (
    <Paper role="alert" withBorder p="md" data-testid="authorization-denied">
      <Text>{authorizationDeniedMessage(i18n)}</Text>
    </Paper>
  )
}

export interface ErrorMessageProps {
  /** The failure: a decoded `ApiError`, or any thrown value. */
  readonly error: unknown
  /**
   * Interpolation values for an entry that names machine context, e.g.
   * `illegal_transition` naming `from` and `to`. Never a resource identifier of a
   * denial: that branch ignores them.
   */
  readonly values?: TOptions
}

/**
 * The localized message of a failure, as text (AC1, AC2).
 *
 * Renders the catalogue entry for the `error` member, or the generic fallback
 * entry when the catalogue has none. Use it inside a dialog or beside a field
 * where the full error state would be too much; the Support_Reference that AC2
 * and Req 23 AC1 require alongside it is rendered by {@link ErrorPresenter}.
 */
export function ErrorMessage({ error, values }: ErrorMessageProps) {
  const { i18n } = useTranslation(NAMESPACES)
  return <>{localizeError(i18n, error, values).message}</>
}

export interface ErrorPresenterProps extends ErrorMessageProps {
  /** Retry control handler. Required on a read surface — see {@link ErrorState}. */
  readonly onRetry?: () => void
  /** Localized heading. Defaults to the shared `shell:state.errorTitle` entry. */
  readonly title?: string
  /** Further actions, rendered after the retry control. */
  readonly children?: ReactNode
}

/**
 * Renders a failure (AC1, AC2, AC3, AC8).
 *
 * A 403 `not_authorized` renders {@link AuthorizationDeniedNotice} and nothing
 * else — the branch is taken before any catalogue probe or interpolation, so the
 * rendered output and the work leading to it are identical for every resource
 * (AC4, AC5). Every other failure renders the localized message, the
 * Support_Reference (Req 23 AC1) and, when a handler is supplied, a retry
 * control.
 *
 * The Support_Reference of the failure is recorded as the most recent one for the
 * browsing context (Req 23 AC3), including for a denial, whose surface renders
 * nothing.
 */
export function ErrorPresenter({ error, values, onRetry, title, children }: ErrorPresenterProps) {
  const { t, i18n } = useTranslation(NAMESPACES)

  // Recorded from an effect, so rendering stays free of side effects and a
  // concurrent re-render cannot record the same failure twice.
  useEffect(() => {
    recordFailedSupportReference(supportReferenceOf(error))
  }, [error])

  if (isAuthorizationDenial(error)) {
    return <AuthorizationDeniedNotice />
  }

  const localized = localizeError(i18n, error, values)

  return (
    <Alert
      role="alert"
      variant="light"
      color="red"
      withCloseButton={false}
      title={title ?? t('shell:state.errorTitle')}
      data-testid="error-state"
    >
      <Stack gap="xs" align="flex-start">
        <Text>{localized.message}</Text>
        <SupportReference reference={localized.supportReference} showHint />
        {onRetry === undefined && children === undefined ? null : (
          <Group gap="sm">
            {onRetry === undefined ? null : (
              <Button type="button" variant="default" onClick={onRetry} data-testid="error-retry">
                {t('shell:action.retry')}
              </Button>
            )}
            {children}
          </Group>
        )}
      </Stack>
    </Alert>
  )
}

export interface ErrorStateProps extends ErrorPresenterProps {
  /** AC8 requires a retry control on a failed read, so the handler is required. */
  readonly onRetry: () => void
}

/**
 * The error state of a failed asynchronous read (AC8).
 *
 * {@link ErrorPresenter} with the retry handler made mandatory, so a read
 * surface cannot ship without the retry control AC8 requires while a dialog or
 * an inline mutation failure — where retrying is the user's own resubmission —
 * can still use the presenter directly.
 */
export function ErrorState(props: ErrorStateProps) {
  return <ErrorPresenter {...props} />
}
