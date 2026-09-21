/**
 * Unit tests for contactable-Senior decoding and the mail action
 * (Requirement 12 AC8, AC9, AC10).
 *
 * The mail action is the one place where a wrong verdict would contact someone who
 * asked not to be contacted, so the `None` and `Chat` preferences are asserted to
 * produce no action at all — whatever else the response carried.
 */

import { describe, expect, it } from 'vitest'

import {
  acceptsEmail,
  activeContactChannels,
  decodeContactableSeniors,
  mailActionHref,
} from './contacts'

describe('decoding the contactable Seniors (AC8)', () => {
  it('keeps every entry that can be rendered as a person', () => {
    expect(
      decodeContactableSeniors([
        { account_id: 'a-1', full_name: 'Dana', contact_channel_pref: 'Both', email: 'dana@x.test' },
        { account_id: 'a-2', full_name: 'أمين', contact_channel_pref: 'Chat' },
        { account_id: 'a-3', full_name: 'Unknown pref', contact_channel_pref: 'Carrier pigeon' },
      ]),
    ).toEqual([
      { accountId: 'a-1', fullName: 'Dana', channelPreference: 'Both', email: 'dana@x.test' },
      { accountId: 'a-2', fullName: 'أمين', channelPreference: 'Chat', email: null },
      // A preference the contract does not declare names no channel at all.
      { accountId: 'a-3', fullName: 'Unknown pref', channelPreference: null, email: null },
    ])
  })

  it('drops an entry with no identifier or no name, and tolerates a non-list body', () => {
    expect(decodeContactableSeniors([{ full_name: 'No id' }, { account_id: 'a-4' }, 7])).toEqual([])
    expect(decodeContactableSeniors(null)).toEqual([])
  })
})

describe('the active channels of a preference (AC8)', () => {
  it('expands the preference into the channels it names', () => {
    expect(activeContactChannels('Chat')).toEqual(['Chat'])
    expect(activeContactChannels('Email')).toEqual(['Email'])
    expect(activeContactChannels('Both')).toEqual(['Chat', 'Email'])
    expect(activeContactChannels('None')).toEqual([])
    expect(activeContactChannels(null)).toEqual([])
  })
})

describe('the mail action (AC9)', () => {
  it('is offered for Email and Both when an address is reported', () => {
    expect(
      mailActionHref({
        accountId: 'a-1',
        fullName: 'Dana',
        channelPreference: 'Email',
        email: 'dana@x.test',
      }),
    ).toBe('mailto:dana@x.test')
    expect(
      mailActionHref({
        accountId: 'a-2',
        fullName: 'Noa',
        channelPreference: 'Both',
        email: 'noa+jobs@x.test',
      }),
    ).toBe('mailto:noa%2Bjobs@x.test')
  })

  it('is never offered for a preference that excludes email', () => {
    for (const preference of ['Chat', 'None', null] as const) {
      expect(acceptsEmail(preference)).toBe(false)
      expect(
        mailActionHref({
          accountId: 'a-3',
          fullName: 'Ron',
          channelPreference: preference,
          // Even with an address on the entry, the preference decides.
          email: 'ron@x.test',
        }),
      ).toBeNull()
    }
  })

  it('is absent when the response reported no address', () => {
    expect(
      mailActionHref({
        accountId: 'a-4',
        fullName: 'Lior',
        channelPreference: 'Email',
        email: null,
      }),
    ).toBeNull()
  })
})
