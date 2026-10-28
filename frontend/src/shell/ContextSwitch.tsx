/**
 * The context-switch control (Requirement 8 AC10, AC11, AC12).
 *
 * A dual-role account holds the Candidate role *and* the Senior role but acts as
 * exactly one of them at a time — the `act` claim of the Access_Token — and the
 * Route_Guard, the Navigation_Menu and the Backend_Api all decide from that claim
 * (Req 8 AC3, AC5–AC7). Changing it is therefore not a client-side toggle: it is
 * a new token pair from `POST /auth/context`, and everything read under the old
 * claim has to go.
 *
 * ## The four things AC11 asks for, in the order they must happen
 *
 * | # | AC11 clause | here |
 * | --- | --- | --- |
 * | 1 | replace both stored tokens | `establishSession(tokenPairFrom(data))` → `SessionManager.login` |
 * | 2 | discard every cached server-state entry | `clearServerState('context-switch')` |
 * | 3 | rebuild the Navigation_Menu from the new `act` | follows from (1); nothing calls it |
 * | 4 | navigate to the landing destination of the new Active_Context | `landingPathFor(principal.act)` |
 *
 * The cache is discarded **before** the pair is adopted, and that order is the
 * whole point rather than a detail. `clearServerState` cancels in-flight reads
 * and empties the cache; adopting the pair republishes the session, which
 * re-renders the tree under the new `act`. Doing it the other way round leaves a
 * window in which a screen mounted for the new context reads entries fetched
 * under the old one — data the new context may not even be entitled to see
 * (Req 8 AC9) — and a read already on the wire could repopulate the cache after
 * it was cleared.
 *
 * Clause 3 is satisfied by *not* being implemented. The Navigation_Menu derives
 * itself from the session's `AccessSubject` (`routing/access.ts`), so republishing
 * the principal rebuilds it; a second, explicit rebuild here would be a way for
 * the two to disagree.
 *
 * ## AC12 is structural
 *
 * `POST /auth/context` is only reachable from {@link ContextSwitchControl}, which
 * cannot be rendered without a non-empty {@link ContextSwitchTargets} — and
 * `contextSwitchTargets` returns `null` for every account holding the Admin role
 * and for every account that is not dual-role (`contextTargets.ts`). So AC12 is
 * not "remember to hide the control": the control, the request and the token
 * adoption are all downstream of one predicate, and an Admin-role account cannot
 * reach any of them.
 *
 * Requirements: 8.10, 8.11, 8.12.
 */

import { Button, Group, Text } from '@mantine/core'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { localizeError } from '../errors/errorMessages'
import { landingPathFor } from '../routing/paths'
import { tokenPairFrom } from '../session/SessionManager'
import { useSession } from '../session/sessionState'

import { useApiClient, useClearServerState } from './appServices'
import {
  contextSwitchTargets,
  type ContextSwitchTargets,
  type SwitchableContext,
} from './contextTargets'

/** Namespaces the control resolves its strings against (Requirement 19 AC2). */
const NAMESPACES = ['shell', 'errors'] as const

/** The contract path a context switch is requested at (Req 8 AC10). */
const SWITCH_CONTEXT_PATH = '/api/v1/auth/context' as const

interface ContextSwitchControlProps {
  /**
   * The contexts this session may switch to — non-empty by type, so the control
   * cannot be rendered for an account that may not switch (AC12).
   */
  readonly targets: ContextSwitchTargets
}

/**
 * The rendered control: one button per target context, plus the failure surface.
 *
 * Separate from {@link ContextSwitch} so the gate above it can decide *whether*
 * to present a control before anything that talks to the Backend_Api exists: this
 * component is what reads the Api_Client and the cache reset out of the shell, and
 * it is only ever instantiated for an account Requirement 8 AC10 describes.
 */
function ContextSwitchControl({ targets }: ContextSwitchControlProps) {
  const { t, i18n } = useTranslation(NAMESPACES)
  const { act, establishSession } = useSession()
  const api = useApiClient()
  const clearServerState = useClearServerState()
  const navigate = useNavigate()

  const [pending, setPending] = useState<SwitchableContext | null>(null)
  const [failure, setFailure] = useState<unknown>(null)

  /**
   * One context switch (AC10, AC11).
   *
   * Deliberately not a TanStack Query mutation: `clearServerState` empties the
   * whole client, mutation cache included, so a mutation observing its own switch
   * would be discarding the state it is reporting through. Local state is both
   * simpler and honest about the lifetime — the outcome matters until the
   * navigation lands, and not afterwards.
   */
  const switchTo = async (target: SwitchableContext): Promise<void> => {
    setPending(target)
    setFailure(null)
    try {
      const { data } = await api.request('post', SWITCH_CONTEXT_PATH, {
        body: { context: target },
      })

      // AC11, in order. See the module comment on why the cache goes first.
      clearServerState('context-switch')
      const principal = establishSession(tokenPairFrom(data))

      // `replace` rather than a push: the screen the user switched away from
      // belongs to the previous Active_Context, and leaving it in the history
      // stack would make Back navigate to something the guard now refuses.
      // A pair whose Access_Token could not be decoded leaves no session, and
      // `landingPathFor(null)` is the login screen — the honest destination.
      await navigate(landingPathFor(principal?.act ?? null), { replace: true })
    } catch (thrown) {
      // The switch failed, so the previous session is still the live one: both
      // tokens, the cache and the Active_Context are untouched, and the user
      // stays where they were with the localized reason (Req 21 AC1).
      setFailure(thrown)
    } finally {
      setPending(null)
    }
  }

  const message = failure === null ? null : localizeError(i18n, failure).message

  return (
    <Group gap="xs" wrap="nowrap" data-testid="context-switch">
      {/*
       * The label and the value are two catalogue entries rather than one
       * interpolated string with a literal separator: no punctuation is embedded
       * in a component (Req 19 AC2), and the pair reorders with the active
       * direction on its own (Req 19 AC8).
       */}
      <Text component="span" size="sm" c="dimmed">
        {t('shell:context.label')}
      </Text>
      <Text component="span" size="sm" fw={500} data-testid="context-switch-active">
        {act === null ? '' : t(`shell:context.${act}`)}
      </Text>

      {targets.map((target) => (
        <Button
          key={target}
          type="button"
          variant="light"
          size="compact-sm"
          loading={pending === target}
          // One switch at a time: a second request would race two token pairs
          // into the same session.
          disabled={pending !== null}
          aria-busy={pending === target}
          onClick={() => {
            void switchTo(target)
          }}
          data-testid={`context-switch-${target}`}
        >
          {/*
           * The accessible name is the visible text, and it names the target
           * rather than the action alone (Req 20 AC8): "Switch to Senior" is
           * operable without seeing which context is currently active.
           */}
          {t('shell:context.switchTo', { context: t(`shell:context.${target}`) })}
        </Button>
      ))}

      {message === null ? null : (
        // `role="alert"` announces the failure without moving focus (Req 20 AC7).
        <Text role="alert" component="span" size="sm" c="red" data-testid="context-switch-error">
          {message}
        </Text>
      )}
    </Group>
  )
}

/**
 * Presents the context-switch control for a dual-role account, and nothing at all
 * for anyone else (AC10, AC12).
 *
 * Takes no props: the role set and the Active_Context come from the session, so no
 * caller can ask for a control the account is not entitled to, and the shell can
 * place it in the header without knowing who is signed in.
 */
export function ContextSwitch() {
  const { roles, act } = useSession()

  // `roles` and `act` are stable between session changes, so the decision is
  // taken once per change rather than on every header render.
  const targets = useMemo(() => contextSwitchTargets(roles, act), [roles, act])

  if (targets === null) {
    return null
  }
  return <ContextSwitchControl targets={targets} />
}
