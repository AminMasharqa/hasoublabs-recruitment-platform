/**
 * The contactable Seniors of one Job_Description (Requirement 12 AC8, AC9, AC10).
 *
 * - **AC8** each returned Senior is rendered with their full name and their active
 *   contact channels, expanded from the `Contact_Channel_Preference` by
 *   `activeContactChannels`.
 * - **AC9** a Senior whose preference is `Email` or `Both` gets their account
 *   email address as a `mailto:` action, from `mailActionHref`.
 * - **AC10** a response with zero entries renders the localized "no Seniors to
 *   contact" message.
 *
 * The decisions are all in `contacts.ts`; this file renders them.
 *
 * ## Two honest gaps
 *
 * `Chat` is rendered as a channel with a note that the platform chat is not
 * available yet, because it genuinely is not (Requirement 10 AC10) — offering a
 * control for it would promise something no endpoint backs.
 *
 * A Senior who accepts email but whose entry carried no address renders the
 * channel and says the address is not reported, rather than being hidden or given
 * a fabricated `mailto:`. `SeniorContactDTO` does not declare an `email` member
 * today (see `contacts.ts`), so this is the branch that runs until it does — and
 * hiding the Senior would misreport who is contactable, which is what AC8 asks
 * about.
 *
 * Requirements: 12.8, 12.9, 12.10, 19.2, 19.10, 21.6, 21.8.
 */

import { Anchor, Box, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { ErrorState, LoadingState } from '../../errors/ErrorPresenter'
import { BidiText } from '../../i18n/DirectionProvider'

import {
  acceptsEmail,
  activeContactChannels,
  mailActionHref,
  type ContactableSenior,
} from './contacts'
import { useContactableSeniorsQuery } from './jobQueries'

/** Namespaces the panel resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['jobs', 'shell', 'errors'] as const

interface SeniorEntryProps {
  readonly senior: ContactableSenior
}

/** One contactable Senior (AC8, AC9). */
function SeniorEntry({ senior }: SeniorEntryProps) {
  const { t } = useTranslation(NAMESPACES)
  const channels = activeContactChannels(senior.channelPreference)
  const href = mailActionHref(senior)

  return (
    <Paper withBorder p="sm" component="li" data-testid={`contact-senior-${senior.accountId}`}>
      <Stack gap={4}>
        <Text fw={500} data-testid={`contact-senior-name-${senior.accountId}`}>
          <BidiText value={senior.fullName} />
        </Text>

        <Text size="xs" c="dimmed">
          {t('jobs:contacts.channels')}
        </Text>
        <Group gap="xs" wrap="wrap" data-testid={`contact-senior-channels-${senior.accountId}`}>
          {channels.map((channel) => (
            <Text key={channel} size="sm" data-channel={channel}>
              {channel === 'Chat' ? t('jobs:contacts.channelChat') : t('jobs:contacts.channelEmail')}
            </Text>
          ))}
        </Group>

        {channels.includes('Chat') ? (
          <Text size="xs" c="dimmed">
            {t('jobs:contacts.chatUnavailable')}
          </Text>
        ) : null}

        {/* AC9: the address as a mail action, for `Email` and `Both` only. */}
        {href === null ? (
          acceptsEmail(senior.channelPreference) ? (
            <Text size="sm" c="dimmed" data-testid={`contact-senior-mail-missing-${senior.accountId}`}>
              {t('jobs:contacts.mailUnavailable')}
            </Text>
          ) : null
        ) : (
          <Anchor
            href={href}
            size="sm"
            aria-label={t('jobs:contacts.mailTo', { name: senior.fullName })}
            data-testid={`contact-senior-mail-${senior.accountId}`}
          >
            {t('jobs:contacts.mail')}
          </Anchor>
        )}
      </Stack>
    </Paper>
  )
}

export interface ContactableSeniorsProps {
  readonly jdId: string
}

/** The contactable-Seniors panel of one Job_Description (AC8, AC10). */
export function ContactableSeniors({ jdId }: ContactableSeniorsProps) {
  const { t } = useTranslation(NAMESPACES)
  const contacts = useContactableSeniorsQuery(jdId)
  const seniors = contacts.data ?? []

  return (
    <Stack gap="xs" data-testid="contactable-seniors">
      <Title order={2} size="h5">
        {t('jobs:contacts.title')}
      </Title>

      {contacts.isPending ? (
        <LoadingState label={t('jobs:contacts.loading')} />
      ) : contacts.isError ? (
        <ErrorState
          error={contacts.error}
          onRetry={() => {
            void contacts.refetch()
          }}
        />
      ) : seniors.length === 0 ? (
        // AC10: a localized statement, not the generic empty state — the message
        // is about this role's contactability, not about an empty destination.
        <Text role="status" data-testid="contactable-seniors-empty">
          {t('jobs:contacts.empty')}
        </Text>
      ) : (
        <Box
          component="ul"
          aria-label={t('jobs:contacts.title')}
          data-testid="contactable-seniors-list"
          style={{ listStyle: 'none', margin: 0, padding: 0 }}
        >
          <Stack gap="sm">
            {seniors.map((senior) => (
              <SeniorEntry key={senior.accountId} senior={senior} />
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  )
}
