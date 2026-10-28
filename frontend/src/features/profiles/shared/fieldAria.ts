/**
 * The attributes that tie a profile input to the messages rendered against it
 * (Requirement 20 AC6).
 *
 * `forms/violations.ts` already owns the id derivation and the `aria-describedby`
 * contract; this module is the small adapter a profile field uses, so every field
 * in both profile slices spells the association the same way and the focus helper
 * (`useViolationFocus`) can find the first affected input by id.
 *
 * ## Why the messages go through the component library's error slot
 *
 * Mantine's `Input` applies its own aria attributes *after* the caller's rest
 * props, so an `aria-invalid` or `aria-describedby` passed alongside the value is
 * silently dropped and the input ends up described by nothing. Supplying `error`
 * is what sets `aria-invalid`, and {@link ProfileFieldAria.errorProps} is what
 * makes the generated `aria-describedby` point at the id `forms/violations.ts`
 * derived from the field path — the same id the focus helper resolves. Registering
 * an input and being described by its messages therefore stay one fact rather than
 * two that can drift.
 *
 * Deliberately JSX-free: the caller builds the message element, this module only
 * decides the identifiers.
 */

import {
  inputElementId,
  violationMessageId,
  type RenderedInput,
} from '../../../forms/violations'

/**
 * Props a profile field passes to the component library's error slot.
 *
 * The `data-` index signature is what makes this assignable to Mantine's own
 * `errorProps`, which declares one; `data-testid` is the member actually set.
 */
export interface ProfileFieldErrorProps {
  /** DOM id of the message element, which `aria-describedby` will point at. */
  readonly id: string
  /** Stable hook for a test, equal to the message element id. */
  readonly [attribute: `data-${string}`]: string
}

/** The identity and message wiring of one profile field. */
export interface ProfileFieldAria {
  /** DOM id of the input, derived from its canonical path. */
  readonly id: string
  /** DOM id of the element rendering this field's messages. */
  readonly messageId: string
  /** Whether any message is currently rendered against this field. */
  readonly invalid: boolean
  /** Props for the error slot; `undefined` while the field is clean. */
  readonly errorProps?: ProfileFieldErrorProps
}

/**
 * Builds the wiring for one field.
 *
 * With no message the field carries its id and nothing else: `aria-invalid` and a
 * description pointing at an empty element would both be lies.
 */
export function profileFieldAria(path: string, hasMessages: boolean): ProfileFieldAria {
  const input: RenderedInput = { path }
  const id = inputElementId(input)
  const messageId = violationMessageId(input)
  if (!hasMessages) {
    return { id, messageId, invalid: false }
  }
  return {
    id,
    messageId,
    invalid: true,
    errorProps: { id: messageId, 'data-testid': messageId },
  }
}
