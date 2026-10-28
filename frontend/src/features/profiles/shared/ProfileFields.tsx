/**
 * The input primitives both profile editors are built from.
 *
 * Each one is the same three things: a labelled control, the messages placed on
 * it, and the association between the two (Requirement 20 AC5, AC6). Sharing them
 * means a field cannot end up labelled in one slice and unlabelled in the other,
 * and it means the DOM id every input carries is always the one derived from its
 * canonical path — which is what lets the focus helper find the first affected
 * input after a rejected save.
 *
 * The value is held by the caller and passed straight through, never rewritten
 * here: an input that trimmed or reformatted while being typed would both fight
 * the user and lose entered values on a 422 (Req 9 AC11, Req 19 AC10).
 *
 * The messages travel through the component library's `error` slot with an
 * explicit `errorProps.id` — see `fieldAria.ts` for why that is the only wiring
 * that actually reaches the input's `aria-describedby`.
 *
 * `maxLength` is set from the Form_Validator bounds where the caller supplies it —
 * an aid, exactly as Req 22 AC12 describes, since the Backend_Api remains the
 * authoritative validator.
 */

import { Select, Textarea, TextInput } from '@mantine/core'

import { profileFieldAria } from './fieldAria'
import { FieldMessages } from './ProfileMessages'

/** What every profile field needs. */
interface ProfileFieldBase {
  /** Canonical path of the input, e.g. `education.2.start_year`. */
  readonly path: string
  /** Localized label. */
  readonly label: string
  /** Localized messages placed on this input, in the order reported. */
  readonly messages: readonly string[]
  readonly required?: boolean
}

/**
 * The identity and message props of one field.
 *
 * Returned as one object so every control below spreads the identical wiring.
 */
function fieldProps(path: string, messages: readonly string[]) {
  const aria = profileFieldAria(path, messages.length > 0)
  if (!aria.invalid) {
    return { id: aria.id }
  }
  return {
    id: aria.id,
    error: <FieldMessages messages={messages} />,
    errorProps: aria.errorProps,
  }
}

export interface ProfileTextFieldProps extends ProfileFieldBase {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly maxLength?: number
  /**
   * Input purpose, so a browser offers the right keyboard and the right
   * autofill: `email`, `tel`, `url`, `date` or a bare `text`.
   */
  readonly type?: 'text' | 'email' | 'tel' | 'url' | 'date' | 'number'
  /** Numeric bounds, for `type="number"`. */
  readonly min?: number
  readonly max?: number
  readonly autoComplete?: string
}

/** A single-line text field. */
export function ProfileTextField({
  path,
  label,
  messages,
  required,
  value,
  onChange,
  maxLength,
  type = 'text',
  min,
  max,
  autoComplete,
}: ProfileTextFieldProps) {
  return (
    <TextInput
      {...fieldProps(path, messages)}
      type={type}
      label={label}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      maxLength={maxLength}
      min={min}
      max={max}
      withAsterisk={required}
      {...(autoComplete === undefined ? {} : { autoComplete })}
    />
  )
}

export interface ProfileTextareaFieldProps extends ProfileFieldBase {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly maxLength?: number
  readonly rows?: number
}

/** A multi-line text field. */
export function ProfileTextareaField({
  path,
  label,
  messages,
  required,
  value,
  onChange,
  maxLength,
  rows = 4,
}: ProfileTextareaFieldProps) {
  return (
    <Textarea
      {...fieldProps(path, messages)}
      label={label}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      maxLength={maxLength}
      rows={rows}
      withAsterisk={required}
    />
  )
}

export interface ProfileSelectFieldProps extends ProfileFieldBase {
  readonly value: string
  readonly onChange: (value: string) => void
  /** The permitted values with their localized labels, in declaration order. */
  readonly data: readonly { readonly value: string; readonly label: string }[]
}

/**
 * A field restricted to an enumerated value set.
 *
 * Deselection is off: these fields carry a value at all times, and "no enrolment
 * status" is not a state the Backend_Api accepts.
 */
export function ProfileSelectField({
  path,
  label,
  messages,
  required,
  value,
  onChange,
  data,
}: ProfileSelectFieldProps) {
  return (
    <Select
      {...fieldProps(path, messages)}
      label={label}
      value={value}
      onChange={(next) => onChange(next ?? value)}
      data={data.map((option) => ({ value: option.value, label: option.label }))}
      allowDeselect={false}
      withAsterisk={required}
      comboboxProps={{ withinPortal: false }}
    />
  )
}
