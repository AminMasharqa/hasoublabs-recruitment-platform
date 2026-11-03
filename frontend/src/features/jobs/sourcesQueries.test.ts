import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '../../api/client'
import { AppServicesContext, type AppServices } from '../../shell/appServices'
import {
  useCreateSourceMutation,
  useDeleteSourceMutation,
  useFlagsQuery,
  useRunsQuery,
  useSourceQuery,
  useSourcesQuery,
} from './sourcesQueries'
import { SOURCES_QUERY_SCOPE } from './sourcesApi'

function makeWrapper(api: ApiClient) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const services: AppServices = {
    api,
    queryClient,
    clearServerState: vi.fn(),
  }
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(AppServicesContext.Provider, { value: services }, children),
    )
  }
}

describe('useSourcesQuery', () => {
  it('calls listSources and returns data', async () => {
    const api = {
      request: vi.fn().mockResolvedValue({ data: [{ id: 'src-1' }] }),
    } as unknown as ApiClient
    const { result } = renderHook(() => useSourcesQuery(), { wrapper: makeWrapper(api) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ id: 'src-1' }])
  })
})

describe('useSourceQuery', () => {
  it('calls getSource with the given id', async () => {
    const api = {
      request: vi.fn().mockResolvedValue({ data: { id: 'src-1' } }),
    } as unknown as ApiClient
    const { result } = renderHook(() => useSourceQuery('src-1'), { wrapper: makeWrapper(api) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ id: 'src-1' })
  })
})

describe('useRunsQuery', () => {
  it('calls listRuns with the given sourceId', async () => {
    const api = {
      request: vi.fn().mockResolvedValue({ data: [] }),
    } as unknown as ApiClient
    const { result } = renderHook(() => useRunsQuery('src-1'), { wrapper: makeWrapper(api) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.request).toHaveBeenCalledWith(
      'get',
      '/api/v1/jobs/sources/{source_id}/runs',
      expect.anything(),
    )
  })
})

describe('useFlagsQuery', () => {
  it('calls listFlags and returns data', async () => {
    const api = {
      request: vi.fn().mockResolvedValue({ data: [] }),
    } as unknown as ApiClient
    const { result } = renderHook(() => useFlagsQuery(), { wrapper: makeWrapper(api) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([])
  })
})

describe('useCreateSourceMutation', () => {
  it('invalidates sources list on success', async () => {
    const api = {
      request: vi.fn().mockResolvedValue({ data: { id: 'new' } }),
    } as unknown as ApiClient
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const services: AppServices = { api, queryClient, clearServerState: vi.fn() }
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(AppServicesContext.Provider, { value: services }, children),
      )
    const { result } = renderHook(() => useCreateSourceMutation(), { wrapper })
    await result.current.mutateAsync({
      name: 'T',
      source_type: 'greenhouse',
      slug: 't',
      poll_interval_hours: 6,
    })
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining([SOURCES_QUERY_SCOPE]),
      }),
    )
  })
})

describe('useDeleteSourceMutation', () => {
  it('invalidates sources list on success', async () => {
    const api = {
      request: vi.fn().mockResolvedValue({ data: undefined }),
    } as unknown as ApiClient
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const services: AppServices = { api, queryClient, clearServerState: vi.fn() }
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(AppServicesContext.Provider, { value: services }, children),
      )
    const { result } = renderHook(() => useDeleteSourceMutation(), { wrapper })
    await result.current.mutateAsync('src-1')
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining([SOURCES_QUERY_SCOPE]),
      }),
    )
  })
})
