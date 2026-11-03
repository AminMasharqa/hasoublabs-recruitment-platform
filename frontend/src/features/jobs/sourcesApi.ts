import type { components } from '../../api/generated/schema'
import type { ApiClient } from '../../api/client'
import { byId, DEFAULT_PAGE_SIZE, deriveLastIdCursor, type NextPage } from '../../lib/cursor'

// ── Type aliases ──────────────────────────────────────────────────────────────

export type JobSource = components['schemas']['JobSourceDTO']
export type CollectionRun = components['schemas']['CollectionRunDTO']
export type JobFlag = components['schemas']['JobDescriptionFlagDTO']
export type JobSourceCreateBody = components['schemas']['JobSourceCreateRequest']
export type JobSourceUpdateBody = components['schemas']['JobSourceUpdateRequest']
export type FlagResolveBody = components['schemas']['FlagResolveRequest']
export type FlagResolveResult = components['schemas']['FlagResolveResponse']

// ── Paths ─────────────────────────────────────────────────────────────────────

const SOURCES_PATH = '/api/v1/jobs/sources'
const SOURCE_PATH = '/api/v1/jobs/sources/{source_id}'
const SOURCE_COLLECT_PATH = '/api/v1/jobs/sources/{source_id}/collect'
const SOURCE_RUNS_PATH = '/api/v1/jobs/sources/{source_id}/runs'
const FLAGS_PATH = '/api/v1/jobs/flags'
const FLAG_RESOLVE_PATH = '/api/v1/jobs/flags/{flag_id}/resolve'

// ── Cache scope ───────────────────────────────────────────────────────────────

export const SOURCES_QUERY_SCOPE = 'job-sources'

// ── Query key factories ───────────────────────────────────────────────────────

export function sourcesQueryKey(afterId: string | null): readonly unknown[] {
  return [SOURCES_QUERY_SCOPE, 'list', afterId]
}

export function sourceQueryKey(sourceId: string): readonly unknown[] {
  return [SOURCES_QUERY_SCOPE, 'detail', sourceId]
}

export function runsQueryKey(sourceId: string, afterId: string | null): readonly unknown[] {
  return [SOURCES_QUERY_SCOPE, 'runs', sourceId, afterId]
}

export function flagsQueryKey(afterId: string | null): readonly unknown[] {
  return [SOURCES_QUERY_SCOPE, 'flags', afterId]
}

// ── Page helpers (bare-array pagination) ─────────────────────────────────────

export function nextSourcesPage(items: JobSource[] | null | undefined): NextPage<string> {
  return deriveLastIdCursor(items, { limit: DEFAULT_PAGE_SIZE, cursorOf: byId })
}

export function nextRunsPage(items: CollectionRun[] | null | undefined): NextPage<string> {
  return deriveLastIdCursor(items, { limit: DEFAULT_PAGE_SIZE, cursorOf: byId })
}

export function nextFlagsPage(items: JobFlag[] | null | undefined): NextPage<string> {
  return deriveLastIdCursor(items, { limit: DEFAULT_PAGE_SIZE, cursorOf: byId })
}

// ── API functions ─────────────────────────────────────────────────────────────

export async function listSources(api: ApiClient, afterId?: string): Promise<JobSource[]> {
  const { data } = await api.request('get', SOURCES_PATH, {
    params: { query: { ...(afterId ? { after_id: afterId } : {}), limit: DEFAULT_PAGE_SIZE } },
  })
  return data
}

export async function createSource(
  api: ApiClient,
  body: JobSourceCreateBody,
): Promise<JobSource> {
  const { data } = await api.request('post', SOURCES_PATH, { body })
  return data
}

export async function getSource(api: ApiClient, sourceId: string): Promise<JobSource> {
  const { data } = await api.request('get', SOURCE_PATH, {
    params: { path: { source_id: sourceId } },
  })
  return data
}

export async function updateSource(
  api: ApiClient,
  sourceId: string,
  body: JobSourceUpdateBody,
): Promise<JobSource> {
  const { data } = await api.request('patch', SOURCE_PATH, {
    params: { path: { source_id: sourceId } },
    body,
  })
  return data
}

export async function deleteSource(api: ApiClient, sourceId: string): Promise<void> {
  await api.request('delete', SOURCE_PATH, {
    params: { path: { source_id: sourceId } },
  })
}

export async function triggerCollect(api: ApiClient, sourceId: string): Promise<CollectionRun> {
  const { data } = await api.request('post', SOURCE_COLLECT_PATH, {
    params: { path: { source_id: sourceId } },
  })
  return data
}

export async function listRuns(
  api: ApiClient,
  sourceId: string,
  afterId?: string,
): Promise<CollectionRun[]> {
  const { data } = await api.request('get', SOURCE_RUNS_PATH, {
    params: {
      path: { source_id: sourceId },
      query: { ...(afterId ? { after_id: afterId } : {}), limit: DEFAULT_PAGE_SIZE },
    },
  })
  return data
}

export async function listFlags(api: ApiClient, afterId?: string): Promise<JobFlag[]> {
  const { data } = await api.request('get', FLAGS_PATH, {
    params: { query: { ...(afterId ? { after_id: afterId } : {}), limit: DEFAULT_PAGE_SIZE } },
  })
  return data
}

export async function resolveFlag(
  api: ApiClient,
  flagId: string,
  body: FlagResolveBody,
): Promise<FlagResolveResult> {
  const { data } = await api.request('post', FLAG_RESOLVE_PATH, {
    params: { path: { flag_id: flagId } },
    body,
  })
  return data
}
