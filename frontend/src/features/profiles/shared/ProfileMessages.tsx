/**
 * The message surfaces a profile form renders beside and above its inputs
 * (Requirement 9 AC11, Requirement 22 AC9/AC10, Requirement 20 AC6).
 *
 * Two of them, and nothing else:
 *
 * - {@link FieldMessages} — every message placed on one input, rendered *inside*
 *   the element the input's `aria-describedby` points at. It carries no id of its
 *   own: the id belongs to the surrounding error element, which the field supplies
 *   through `errorProps` (see `fieldAria.ts`), so there is exactly one element per
 *   field that both holds the messages and is pointed at.
 * - {@link FormLevelMessages} — the messages that addressed no rendered input,
 *   which AC10 requires to be shown rather than dropped. Announced as an alert,
 *   because nothing else on screen would reveal them.
 *
 * Neither moves focus: the focus move of Req 20 AC6 belongs to the form, which
 * drives it from the partition through `useViolationFocus`.
 */

import { Alert, List } from '@mantine/core'

export interface FieldMessagesProps {
  /** Localized messages for this field, in the order they were reported. */
  readonly messages: readonly string[]
}

/**
 * Every message placed on one input.
 *
 * Renders nothing at all when the field is clean, so the field never supplies an
 * empty error element for its description to point at.
 *
 * Several messages are stacked with block-level `span`s rather than with a layout
 * component: the component library renders the surrounding error element as a `<p>`,
 * which cannot contain a `<div>`. Invalid nesting there is not cosmetic — the
 * element an input's `aria-describedby` points at is exactly the one a screen
 * reader has to parse (Req 20 AC6), and a browser repairing the markup can move
 * the messages out of it.
 */
export function FieldMessages({ messages }: FieldMessagesProps) {
  if (messages.length === 0) {
    return null
  }
  if (messages.length === 1) {
    return <>{messages[0]}</>
  }
  return (
    <>
      {messages.map((message, index) => (
        <span key={`${index}-${message}`} style={{ display: 'block' }}>
          {message}
        </span>
      ))}
    </>
  )
}

export interface FormLevelMessagesProps {
  /** Localized heading of the region. */
  readonly title: string
  /** Messages addressing no rendered input (Req 22 AC10). */
  readonly messages: readonly string[]
  /** Element id, so a form can point at the region from elsewhere. */
  readonly id?: string
}

/** The form-level message region. */
export function FormLevelMessages({ title, messages, id }: FormLevelMessagesProps) {
  if (messages.length === 0) {
    return null
  }
  return (
    <Alert
      role="alert"
      variant="light"
      color="red"
      title={title}
      withCloseButton={false}
      data-testid="form-level-messages"
      {...(id === undefined ? {} : { id })}
    >
      <List size="sm">
        {messages.map((message, index) => (
          <List.Item key={`${index}-${message}`}>{message}</List.Item>
        ))}
      </List>
    </Alert>
  )
}
