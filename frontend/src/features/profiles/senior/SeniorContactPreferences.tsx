/**
 * The contact-preference controls of the Senior profile (Requirement 10 AC3–AC7,
 * AC10, AC11).
 *
 * | criterion | here |
 * | --- | --- |
 * | AC3 a control offering exactly `Chat`, `Email`, `Both`, `None` | the channel select, built from `CONTACT_CHANNEL_PREF_VALUES` |
 * | AC4 a required scope control offering exactly the three scopes | the scope select, rendered only while the channel is contactable |
 * | AC5 no scope control at all while the channel is `None` | `showsContactScope`, the same predicate that omits the member |
 * | AC6/AC7 the conditional requirements | stated beside the scope control, enforced in `model.ts` |
 * | AC10 the account email as the contact address, and no alternate-address input | {@link ContactAddress} — a read-only surface, no input |
 * | AC11 "chat contact not yet available" where a chat action would be | {@link ChatPlaceholder} |
 *
 * ## Why these are native selects
 *
 * Both controls are `NativeSelect`: keyboard-operable by construction (Req 20
 * AC2), and — for the scope — able to hold "nothing chosen yet" as an empty first
 * option. That matters for AC4: a scope control that silently defaulted to one of
 * the three values would record a contact scope the Senior never chose, so the
 * empty option is what makes "required" a reportable violation rather than a
 * default nobody asked for.
 *
 * The option sets are derived from the contract-backed value sets rather than
 * written out, so "exactly these values" in AC3 and AC4 is a fact about the
 * generated declarations rather than a list a reviewer has to check.
 *
 * ## The contact address is displayed, never entered (AC10)
 *
 * There is no input for an alternate contact email anywhere in this file, which is
 * the prohibition of AC10. The address itself is the account's registered email —
 * a value no endpoint in the current contract exposes for the *authenticated*
 * account (`SeniorProfileDTO` carries no email, and there is no self-account read),
 * the same gap `features/jobs/contacts.ts` records for a contactable Senior's
 * address. So {@link ContactAddressProps.accountEmail} renders the address when a
 * caller holds it and the surface names the registered account address otherwise.
 * Nothing else has to change when the contract exposes it.
 */

import { Alert, Group, NativeSelect, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import type { ContactChannelPref, ContactScopePref } from '../../../api/enums'
import {
  CONTACT_CHANNEL_PREF_VALUES,
  CONTACT_SCOPE_PREF_VALUES,
} from '../../../forms/validators'
import { profileFieldAria } from '../shared/fieldAria'
import { FieldMessages } from '../shared/ProfileMessages'
import type { FieldMessageIndex } from '../shared/violationMessages'

import {
  CONTACT_CHANNEL_PATH,
  CONTACT_SCOPE_PATH,
  showsChatPlaceholder,
  showsContactScope,
  showsEmailContact,
} from './model'

/** Namespaces these controls resolve their strings against (Req 19 AC2). */
const NAMESPACES = ['profiles', 'shell'] as const

/** The identity and message props of one select (Req 20 AC5, AC6). */
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

export interface ContactAddressProps {
  /**
   * The account's registered email address, when the caller holds it.
   *
   * `null` renders the localized statement that the registered account address is
   * the contact address — see the module comment for why the value is not always
   * available.
   */
  readonly accountEmail: string | null
}

/** The contact address, displayed and never editable (AC10). */
export function ContactAddress({ accountEmail }: ContactAddressProps) {
  const { t } = useTranslation(NAMESPACES)
  const known = typeof accountEmail === 'string' && accountEmail.trim() !== ''

  return (
    <Stack gap={0} data-testid="senior-contact-address">
      <Text size="sm" c="dimmed">
        {t('profiles:senior.contactAddressLabel')}
      </Text>
      {/* Rendered verbatim: an address is content, not something to reformat. */}
      <Text data-testid="senior-contact-address-value">
        {known ? accountEmail : t('profiles:senior.contactAddressRegistered')}
      </Text>
      <Text size="xs" c="dimmed">
        {t('profiles:senior.contactAddressNote')}
      </Text>
    </Stack>
  )
}

/** The Phase 1 chat notice, where a chat contact action would otherwise be (AC11). */
export function ChatPlaceholder() {
  const { t } = useTranslation(NAMESPACES)
  return (
    <Alert
      role="status"
      variant="light"
      color="gray"
      withCloseButton={false}
      data-testid="senior-chat-unavailable"
    >
      {t('profiles:senior.chatUnavailable')}
    </Alert>
  )
}

export interface SeniorContactPreferencesProps {
  readonly channel: ContactChannelPref
  readonly scope: ContactScopePref | null
  /** Localized messages of this form, looked up by input path. */
  readonly messages: FieldMessageIndex
  /** The account's registered email address, when the caller holds it (AC10). */
  readonly accountEmail: string | null
  readonly onChannelChange: (channel: ContactChannelPref) => void
  readonly onScopeChange: (scope: ContactScopePref | null) => void
}

/** The Contact_Channel_Preference and Contact_Scope_Preference controls. */
export function SeniorContactPreferences({
  channel,
  scope,
  messages,
  accountEmail,
  onChannelChange,
  onScopeChange,
}: SeniorContactPreferencesProps) {
  const { t } = useTranslation(NAMESPACES)
  const scopePresented = showsContactScope(channel)

  return (
    <Stack gap="sm" data-testid="senior-contact-preferences">
      {/* AC3: exactly the four declared channels. */}
      <NativeSelect
        {...fieldProps(CONTACT_CHANNEL_PATH, messages.messagesFor(CONTACT_CHANNEL_PATH))}
        label={t('profiles:senior.contactChannelLabel')}
        description={t('profiles:senior.contactChannelDescription')}
        value={channel}
        data={CONTACT_CHANNEL_PREF_VALUES.values.map((value) => ({
          value,
          label: t(`profiles:contactChannel.${value}`),
        }))}
        onChange={(event) => {
          const next = event.currentTarget.value
          if (CONTACT_CHANNEL_PREF_VALUES.includes(next)) {
            onChannelChange(next)
          }
        }}
        data-testid="senior-contact-channel"
      />

      {/*
       * AC4 and AC5 in one expression: while the channel is `None` the control is
       * not rendered at all — and `toSeniorUpdateRequest` omits the member for the
       * same reason, so the hidden control and the absent member are one decision.
       */}
      {scopePresented ? (
        <Stack gap={4}>
          <NativeSelect
            {...fieldProps(CONTACT_SCOPE_PATH, messages.messagesFor(CONTACT_SCOPE_PATH))}
            label={t('profiles:senior.contactScopeLabel')}
            withAsterisk
            value={scope ?? ''}
            data={[
              { value: '', label: t('profiles:senior.contactScopePlaceholder') },
              ...CONTACT_SCOPE_PREF_VALUES.values.map((value) => ({
                value,
                label: t(`profiles:contactScope.${value}`),
              })),
            ]}
            onChange={(event) => {
              const next = event.currentTarget.value
              onScopeChange(CONTACT_SCOPE_PREF_VALUES.includes(next) ? next : null)
            }}
            data-testid="senior-contact-scope"
          />
          {/*
           * AC6 and AC7 stated before a save is attempted, so the requirement is
           * read as a condition of the chosen scope rather than as a surprise
           * rejection. The rules themselves live in `model.ts`.
           */}
          <Text size="xs" c="dimmed" data-testid="senior-contact-scope-requirement">
            {scope === 'SameCompany'
              ? t('profiles:senior.scopeRequiresCompany')
              : scope === 'FieldOfExpertise'
                ? t('profiles:senior.scopeRequiresExpertise')
                : t('profiles:senior.scopeHint')}
          </Text>
        </Stack>
      ) : (
        <Text size="xs" c="dimmed" data-testid="senior-contact-none-note">
          {t('profiles:senior.contactNoneNote')}
        </Text>
      )}

      {/* AC10: the registered account address, displayed and not editable. */}
      {showsEmailContact(channel) ? (
        <Group gap="xl" align="flex-start">
          <ContactAddress accountEmail={accountEmail} />
        </Group>
      ) : null}

      {/* AC11: no chat action exists yet, so its place carries the notice. */}
      {showsChatPlaceholder(channel) ? <ChatPlaceholder /> : null}
    </Stack>
  )
}
