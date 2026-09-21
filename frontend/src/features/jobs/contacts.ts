/**
 * Contactable Seniors of a Job_Description, as
 * `GET /api/v1/jobs/{jd_id}/contactable-seniors` returns them
 * (Requirement 12 AC8, AC9, AC10).
 *
 * Pure: decoding and the mail-action decision only.
 *
 * ## The active channels
 *
 * `Contact_Channel_Preference` is one value, but it names up to two channels:
 * `Chat` and `Email` name one each, `Both` names both, `None` names none. The
 * panel renders the channels rather than the preference value, because "how can I
 * reach this person" is the question the user is actually asking — so
 * {@link activeContactChannels} expands the preference into the channel list AC8
 * asks for.
 *
 * `Chat` is rendered as a channel and nothing more: the platform chat is a Phase 1
 * placeholder with no endpoint behind it (Requirement 10 AC10), so offering an
 * action for it would promise something the Backend_Api cannot do. `Email` is the
 * one channel with an action, and AC9 scopes that action to exactly the `Email`
 * and `Both` preferences.
 *
 * ## Why the mail action can be missing on a Senior who accepts email
 *
 * `SeniorContactDTO` carries `account_id`, `full_name` and `contact_channel_pref`
 * — and no address. AC9 asks for the Senior's account email address as a mail
 * action, so the value it needs is one the contract does not currently expose, in
 * the same way Assumption 3 records the recruiter contact email as absent from the
 * Job_Description contract. {@link contactEmailOf} therefore reads an `email`
 * member when the response carries one and yields `null` otherwise, and the panel
 * renders the channel without a `mailto:` in that case rather than fabricating an
 * address or hiding a Senior who is genuinely contactable. Nothing else has to
 * change when the member appears.
 *
 * Requirements: 12.8, 12.9, 12.10.
 */

import type { ContactChannelPref } from '../../api/enums'
import { CONTACT_CHANNEL_PREF_VALUES } from '../../forms/validators'

/** A channel a Senior can be reached through. */
export type ContactChannel = 'Chat' | 'Email'

/** One contactable Senior, reduced to what the panel renders. */
export interface ContactableSenior {
  readonly accountId: string
  readonly fullName: string
  /**
   * The declared preference, or `null` when the response named a value the
   * contract does not declare. `null` yields no channels and no action, which is
   * the safe reading: it never invents a way to contact someone.
   */
  readonly channelPreference: ContactChannelPref | null
  /** The account email address, when the response carried one. */
  readonly email: string | null
}

function readString(source: Record<string, unknown>, member: string): string | null {
  const value = source[member]
  if (typeof value !== 'string') {
    return null
  }
  return value.trim() === '' ? null : value
}

/** Reads the account email address of a contactable Senior, when present (AC9). */
export function contactEmailOf(source: Record<string, unknown>): string | null {
  return readString(source, 'email')
}

/**
 * Decodes the contactable-Seniors response.
 *
 * An entry without an identifier or a name is dropped: it can be neither rendered
 * as a person nor keyed in a list.
 */
export function decodeContactableSeniors(body: unknown): readonly ContactableSenior[] {
  if (!Array.isArray(body)) {
    return []
  }
  const seniors: ContactableSenior[] = []
  for (const entry of body) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      continue
    }
    const record = entry as Record<string, unknown>
    const accountId = readString(record, 'account_id')
    const fullName = readString(record, 'full_name')
    if (accountId === null || fullName === null) {
      continue
    }
    const preference = record.contact_channel_pref
    seniors.push({
      accountId,
      fullName,
      channelPreference: CONTACT_CHANNEL_PREF_VALUES.includes(preference) ? preference : null,
      email: contactEmailOf(record),
    })
  }
  return seniors
}

/** The channels a preference names, in the order the panel renders them (AC8). */
export function activeContactChannels(
  preference: ContactChannelPref | null,
): readonly ContactChannel[] {
  switch (preference) {
    case 'Chat':
      return ['Chat']
    case 'Email':
      return ['Email']
    case 'Both':
      return ['Chat', 'Email']
    default:
      return []
  }
}

/** Whether AC9 asks for a mail action for this preference: `Email` or `Both`. */
export function acceptsEmail(preference: ContactChannelPref | null): boolean {
  return preference === 'Email' || preference === 'Both'
}

/**
 * The `mailto:` target of a Senior's mail action, or `null` when there is none
 * (AC9).
 *
 * `null` for a Senior whose preference excludes email — the action must not exist
 * then, whatever the response happened to carry — and for one whose address the
 * response did not report.
 */
export function mailActionHref(senior: ContactableSenior): string | null {
  if (!acceptsEmail(senior.channelPreference) || senior.email === null) {
    return null
  }
  return `mailto:${encodeURIComponent(senior.email).replace(/%40/g, '@')}`
}
