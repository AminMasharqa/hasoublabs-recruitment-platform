import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '../../api/client'
import type { CollectionRun, JobFlag, JobSource } from './sourcesApi'
import {
  createSource,
  deleteSource,
  flagsQueryKey,
  getSource,
  listFlags,
  listRuns,
  listSources,
  nextFlagsPage,
  nextRunsPage,
  nextSourcesPage,
  resolveFlag,
  runsQueryKey,
  SOURCES_QUERY_SCOPE,
  sourcesQueryKey,
  sourceQueryKey,
  triggerCollect,
  updateSource,
} from './sourcesApi'

function stubApi(data: unknown): ApiClient {
  return { request: vi.fn().mockResolvedValue({ data }) } as unknown as ApiClient
}

describe('query key factories', () => {
  it('sourcesQueryKey prefixes with SOURCES_QUERY_SCOPE', () => {
    expect(sourcesQueryKey(null)[0]).toBe(SOURCES_QUERY_SCOPE)
    expect(sourcesQueryKey(null)[1]).toBe('list')
  })
  it('sourceQueryKey includes the sourceId', () => {
    expect(sourceQueryKey('abc')).toContain('abc')
  })
  it('runsQueryKey includes the sourceId', () => {
    expect(runsQueryKey('abc', null)).toContain('abc')
  })
  it('flagsQueryKey prefixes with SOURCES_QUERY_SCOPE', () => {
    expect(flagsQueryKey(null)[0]).toBe(SOURCES_QUERY_SCOPE)
  })
})

describe('nextSourcesPage', () => {
  it('returns hasNextPage false for fewer than DEFAULT_PAGE_SIZE items', () => {
    const items = [{ id: 'a' }] as JobSource[]
    expect(nextSourcesPage(items).hasNextPage).toBe(false)
  })
  it('returns hasNextPage true when items.length === DEFAULT_PAGE_SIZE', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: String(i) })) as JobSource[]
    const result = nextSourcesPage(items)
    expect(result.hasNextPage).toBe(true)
    if (result.hasNextPage) expect(result.nextCursor).toBe('19')
  })
})

describe('nextRunsPage', () => {
  it('returns hasNextPage false for an empty run list', () => {
    expect(nextRunsPage([] as CollectionRun[]).hasNextPage).toBe(false)
  })
})

describe('nextFlagsPage', () => {
  it('returns hasNextPage true when items.length === DEFAULT_PAGE_SIZE', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: String(i) })) as JobFlag[]
    expect(nextFlagsPage(items).hasNextPage).toBe(true)
  })
})

describe('API functions call the correct endpoints', () => {
  it('listSources calls GET /api/v1/jobs/sources', async () => {
    const api = stubApi([])
    await listSources(api)
    expect(api.request).toHaveBeenCalledWith('get', '/api/v1/jobs/sources', expect.anything())
  })
  it('createSource calls POST /api/v1/jobs/sources', async () => {
    const api = stubApi({ id: 'x' })
    await createSource(api, {
      name: 'Test',
      source_type: 'greenhouse',
      slug: 'test',
      poll_interval_hours: 6,
    })
    expect(api.request).toHaveBeenCalledWith('post', '/api/v1/jobs/sources', expect.anything())
  })
  it('deleteSource calls DELETE /api/v1/jobs/sources/{source_id}', async () => {
    const api = stubApi(undefined)
    await deleteSource(api, 'abc')
    expect(api.request).toHaveBeenCalledWith(
      'delete',
      '/api/v1/jobs/sources/{source_id}',
      expect.anything(),
    )
  })
  it('triggerCollect calls POST /api/v1/jobs/sources/{source_id}/collect', async () => {
    const api = stubApi({ id: 'r1' })
    await triggerCollect(api, 'abc')
    expect(api.request).toHaveBeenCalledWith(
      'post',
      '/api/v1/jobs/sources/{source_id}/collect',
      expect.anything(),
    )
  })
  it('listRuns calls GET /api/v1/jobs/sources/{source_id}/runs', async () => {
    const api = stubApi([])
    await listRuns(api, 'abc')
    expect(api.request).toHaveBeenCalledWith(
      'get',
      '/api/v1/jobs/sources/{source_id}/runs',
      expect.anything(),
    )
  })
  it('listFlags calls GET /api/v1/jobs/flags', async () => {
    const api = stubApi([])
    await listFlags(api)
    expect(api.request).toHaveBeenCalledWith('get', '/api/v1/jobs/flags', expect.anything())
  })
  it('resolveFlag calls POST /api/v1/jobs/flags/{flag_id}/resolve', async () => {
    const api = stubApi({ flag_id: 'f1', status: 'resolved', job_description_id: null })
    await resolveFlag(api, 'f1', { action: 'dismiss' })
    expect(api.request).toHaveBeenCalledWith(
      'post',
      '/api/v1/jobs/flags/{flag_id}/resolve',
      expect.anything(),
    )
  })
  it('updateSource calls PATCH /api/v1/jobs/sources/{source_id}', async () => {
    const api = stubApi({ id: 'x' })
    await updateSource(api, 'abc', { enabled: false })
    expect(api.request).toHaveBeenCalledWith(
      'patch',
      '/api/v1/jobs/sources/{source_id}',
      expect.anything(),
    )
  })
  it('getSource calls GET /api/v1/jobs/sources/{source_id}', async () => {
    const api = stubApi({ id: 'x' })
    await getSource(api, 'abc')
    expect(api.request).toHaveBeenCalledWith(
      'get',
      '/api/v1/jobs/sources/{source_id}',
      expect.anything(),
    )
  })
})
