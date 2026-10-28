/**
 * `/senior/jobs` — where a Senior authors Job_Descriptions
 * (Requirement 13 AC1, AC11–AC16).
 *
 * The Senior's entry point into authoring: the creation form of AC1, and the route
 * every posting's lifecycle controls are reached through.
 *
 * ## Why there is no list of the Senior's own postings
 *
 * The contract exposes no own-postings read. `GET /api/v1/jobs` browses `Open`
 * Job_Descriptions — every account's, not the caller's — and the all-status listing
 * of AC17 is `GET /api/v1/admin/jobs`, which requires the Admin role. So a list here
 * would either be a filtered guess over one page of other people's `Open` roles or a
 * request the Backend_Api would refuse. Requirement 13 asks for neither: it asks for
 * creation, extraction and the lifecycle controls, which are the creation screen and
 * the authoring surface this screen links to.
 *
 * Rather than render a list that would silently omit every `Draft` and `Closed`
 * posting, the screen says what is reachable and how — a newly created posting lands
 * on its authoring surface, and an existing one is reached by its own address. An
 * empty list would have implied the Senior has no postings, which is a stronger claim
 * than the contract supports.
 *
 * Requirements: 13.1, 13.11, 19.2, 21.7.
 */

import { Anchor, Button, Container, Group, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { ROUTE_PATHS } from '../../routing/paths'

/** Namespaces this screen resolves its strings against (Req 19 AC2). */
const NAMESPACES = ['jobs', 'shell'] as const

/** The Senior authoring entry point. */
export function SeniorJobsScreen() {
  const { t } = useTranslation(NAMESPACES)

  return (
    <Container size="md" py="md" data-testid="senior-jobs-screen">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1} size="h3">
            {t('jobs:senior.title')}
          </Title>
          <Text c="dimmed">{t('jobs:senior.description')}</Text>
        </Stack>

        <Group gap="sm">
          <Button
            component={Link}
            to={ROUTE_PATHS.seniorJobNew}
            data-testid="senior-jobs-create"
          >
            {t('jobs:authoring.create')}
          </Button>
          <Anchor component={Link} to={ROUTE_PATHS.jobs} size="sm" data-testid="senior-jobs-browse">
            {t('jobs:senior.browseOpen')}
          </Anchor>
        </Group>

        <Text size="sm" c="dimmed" data-testid="senior-jobs-reach">
          {t('jobs:senior.noListing')}
        </Text>
      </Stack>
    </Container>
  )
}
