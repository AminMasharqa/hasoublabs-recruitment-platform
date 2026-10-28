/**
 * The recovery boundary for an unhandled rendering error.
 *
 * Requirement 21 AC11: when an unhandled rendering error occurs, the Web_Client
 * renders a recovery boundary that
 * - retains the application shell,
 * - presents a reload control, and
 * - presents the Support_Reference of the most recent failed request.
 *
 * Requirement 23 AC1 counts this boundary as one of the surfaces that must carry
 * that Support_Reference, and AC3 is what makes it available: the reference is
 * retained for the browsing context in `supportReferenceStore.ts`, so it survives
 * the unmount of the subtree that crashed. AC2's copy control comes with
 * {@link LatestSupportReference}. AC4 holds because the store only ever records a
 * failure and {@link LatestSupportReference} renders nothing when none was
 * recorded — a crash on the very first render shows no reference row rather than
 * an empty one.
 *
 * Requirement 20: the fallback announces itself through `role="alert"` and
 * nothing here calls `focus()`, so the user's focus stays where they put it
 * (AC7); the reload control is a real `button` reachable by keyboard with its
 * name resolved from the catalogue (AC1, AC5, AC8).
 *
 * ## Placement: inside the shell, never around it
 *
 * "Retains the application shell" is a statement about where this component is
 * mounted, and it is the whole reason the component exists as a subtree boundary
 * rather than as a top-level one. An error boundary replaces **its own children**
 * with the fallback, so:
 *
 * - Mounted **inside** the shell — around the routed content, i.e. wrapping the
 *   `Outlet` inside `AppShell` — a crash replaces only the routed region. The
 *   header, the Navigation_Menu, the LocaleControl, the ContextSwitch and the
 *   sign-out control all stay mounted and operable, which is what AC11 requires
 *   and what lets a user navigate away instead of reloading.
 * - Mounted **around** the shell, a crash would take the shell down with it, and
 *   the requirement would be violated no matter what this component renders.
 *
 * So `src/shell/AppShell.tsx` (task 12.1) must place it under the providers and
 * inside the shell chrome. It composes safely more than once: a feature screen
 * that wants a smaller blast radius — one panel of a dashboard — can wrap that
 * panel in its own boundary, and the nearest one wins.
 *
 * Nothing above the boundary may itself be a crash source for this to hold, which
 * is why the providers (Direction_Provider, MantineProvider,
 * QueryClientProvider, SessionContext) sit above it: the fallback renders
 * *through* them — it needs Mantine and i18next to render at all.
 *
 * ## Why a class component
 *
 * React 19 still offers no hook equivalent of `componentDidCatch` /
 * `getDerivedStateFromError`; a boundary must be a class. The fallback itself is
 * the ordinary function component {@link RecoveryNotice}, so all the localization
 * and the Support_Reference subscription stay in hook-land and the class holds
 * nothing but the caught-error flag.
 */

import { Alert, Button, Stack, Text } from '@mantine/core'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { LatestSupportReference } from './SupportReference'

/** Namespaces the fallback resolves its strings against. */
const NAMESPACES = ['shell', 'errors'] as const

export interface RecoveryNoticeProps {
  /** The reload control's handler. */
  readonly onReload: () => void
}

/**
 * The fallback surface: the localized explanation, the reload control and the
 * retained Support_Reference (AC11).
 *
 * Exported so the shell can preview it and so task 10.3 can assert its contents
 * without having to make a component throw.
 *
 * The copy in `shell:recovery.body` says the rest of the application is still
 * available, which is true precisely because of where the boundary is mounted —
 * see the placement note above. Reload is offered as the way to retry this
 * region, not as the only way out.
 */
export function RecoveryNotice({ onReload }: RecoveryNoticeProps) {
  const { t } = useTranslation(NAMESPACES)

  return (
    <Alert
      role="alert"
      variant="light"
      color="red"
      withCloseButton={false}
      title={t('shell:recovery.title')}
      data-testid="recovery-boundary"
    >
      <Stack gap="xs" align="flex-start">
        <Text>{t('shell:recovery.body')}</Text>
        <LatestSupportReference />
        <Button type="button" variant="default" onClick={onReload} data-testid="recovery-reload">
          {t('shell:action.reload')}
        </Button>
      </Stack>
    </Alert>
  )
}

export interface RecoveryBoundaryProps {
  /** The subtree to guard — the routed content, mounted inside the shell. */
  readonly children?: ReactNode
  /**
   * Reload handler for the recovery control. Defaults to reloading the browsing
   * context, which is what AC11 asks for; a test or an embedding host passes its
   * own.
   */
  readonly onReload?: () => void
  /**
   * Observer for a caught rendering error.
   *
   * Nothing is logged by default: React already reports an uncaught rendering
   * error to the console itself, and a rendering error can carry rendered values
   * in its message, so the boundary adds no second log that could carry a
   * password, a Verification_Code or a Residency_Proof value with it
   * (Requirement 23 AC7). A host that wants reporting supplies it here and owns
   * the hygiene of what it forwards.
   */
  readonly onError?: (error: unknown, errorInfo: ErrorInfo) => void
  /**
   * When this value changes, a caught error is discarded and the children are
   * re-rendered.
   *
   * A boundary has no way of knowing on its own that the thing which crashed is
   * gone. The shell passes the current location, so navigating with the retained
   * Navigation_Menu clears the fallback instead of leaving it up until a reload.
   * Left undefined the fallback stays until the user reloads.
   */
  readonly resetKey?: unknown
}

interface RecoveryBoundaryState {
  /**
   * Whether a rendering error was caught. A separate flag rather than
   * `error !== null`, because a thrown value may legitimately be `null` or
   * `undefined` and the fallback must still show.
   */
  readonly hasError: boolean
  /**
   * The `resetKey` the current state was reconciled against, so a change to it
   * can be detected during rendering rather than in a post-update effect.
   */
  readonly observedResetKey: unknown
}

/** Reloads the browsing context — the default recovery action of AC11. */
function reloadBrowsingContext(): void {
  if (typeof window !== 'undefined') {
    window.location.reload()
  }
}

/**
 * Catches an unhandled rendering error in its subtree and renders
 * {@link RecoveryNotice} in its place (AC11, Req 23 AC1).
 *
 * Mount inside the application shell, around the routed content — see the module
 * note. The caught error itself is deliberately not rendered: its message is
 * developer text, unlocalized and potentially carrying values the user entered,
 * while the Support_Reference is the identifier support can actually trace.
 */
export class RecoveryBoundary extends Component<RecoveryBoundaryProps, RecoveryBoundaryState> {
  constructor(props: RecoveryBoundaryProps) {
    super(props)
    this.state = { hasError: false, observedResetKey: props.resetKey }
  }

  static getDerivedStateFromError(): Pick<RecoveryBoundaryState, 'hasError'> {
    return { hasError: true }
  }

  /**
   * Discards a caught error when `resetKey` changes.
   *
   * Done here rather than in `componentDidUpdate`, so the recovered children
   * render in the same commit as the key change instead of after a throwaway
   * render of the fallback.
   */
  static getDerivedStateFromProps(
    props: RecoveryBoundaryProps,
    state: RecoveryBoundaryState,
  ): RecoveryBoundaryState | null {
    if (props.resetKey === state.observedResetKey) {
      return null
    }
    return { hasError: false, observedResetKey: props.resetKey }
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo)
  }

  private readonly handleReload = (): void => {
    const reload = this.props.onReload ?? reloadBrowsingContext
    reload()
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return <RecoveryNotice onReload={this.handleReload} />
    }
    return this.props.children
  }
}
