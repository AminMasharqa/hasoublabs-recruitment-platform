import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'

import { useApiClient } from '../../shell/appServices'

import {
  createSource,
  deleteSource,
  flagsQueryKey,
  getSource,
  listFlags,
  listRuns,
  listSources,
  resolveFlag,
  runsQueryKey,
  SOURCES_QUERY_SCOPE,
  sourcesQueryKey,
  sourceQueryKey,
  triggerCollect,
  updateSource,
  type CollectionRun,
  type FlagResolveBody,
  type FlagResolveResult,
  type JobFlag,
  type JobSource,
  type JobSourceCreateBody,
  type JobSourceUpdateBody,
} from './sourcesApi'

export function useSourcesQuery(afterId?: string): UseQueryResult<JobSource[]> {
  const api = useApiClient()
  return useQuery({
    queryKey: sourcesQueryKey(afterId ?? null),
    queryFn: () => listSources(api, afterId),
  })
}

export function useSourceQuery(sourceId: string): UseQueryResult<JobSource> {
  const api = useApiClient()
  return useQuery({
    queryKey: sourceQueryKey(sourceId),
    queryFn: () => getSource(api, sourceId),
  })
}

export function useRunsQuery(sourceId: string, afterId?: string): UseQueryResult<CollectionRun[]> {
  const api = useApiClient()
  return useQuery({
    queryKey: runsQueryKey(sourceId, afterId ?? null),
    queryFn: () => listRuns(api, sourceId, afterId),
  })
}

export function useFlagsQuery(afterId?: string): UseQueryResult<JobFlag[]> {
  const api = useApiClient()
  return useQuery({
    queryKey: flagsQueryKey(afterId ?? null),
    queryFn: () => listFlags(api, afterId),
  })
}

export function useCreateSourceMutation(): UseMutationResult<
  JobSource,
  unknown,
  JobSourceCreateBody
> {
  const api = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body) => createSource(api, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [SOURCES_QUERY_SCOPE] })
    },
  })
}

export function useUpdateSourceMutation(
  sourceId: string,
): UseMutationResult<JobSource, unknown, JobSourceUpdateBody> {
  const api = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body) => updateSource(api, sourceId, body),
    onSuccess: (source) => {
      queryClient.setQueryData<JobSource>(sourceQueryKey(source.id), source)
      void queryClient.invalidateQueries({ queryKey: [SOURCES_QUERY_SCOPE] })
    },
  })
}

export function useDeleteSourceMutation(): UseMutationResult<void, unknown, string> {
  const api = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (sourceId) => deleteSource(api, sourceId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [SOURCES_QUERY_SCOPE] })
    },
  })
}

export function useTriggerCollectMutation(
  sourceId: string,
): UseMutationResult<CollectionRun, unknown, void> {
  const api = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => triggerCollect(api, sourceId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [SOURCES_QUERY_SCOPE] })
    },
  })
}

export function useResolveFlagMutation(
  flagId: string,
): UseMutationResult<FlagResolveResult, unknown, FlagResolveBody> {
  const api = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body) => resolveFlag(api, flagId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [SOURCES_QUERY_SCOPE] })
    },
  })
}
