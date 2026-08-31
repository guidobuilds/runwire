import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import { api, unwrap } from './client';
import type { Capability, SessionDetailResponse, StatusResponse } from './types';

export const queryKeys = {
  status: ['status'] as const,
  projects: ['projects'] as const,
  harnesses: ['harnesses'] as const,
  projectSessions: (key: string) => ['projects', key, 'sessions'] as const,
  harnessSessions: (id: string) => ['harnesses', id, 'sessions'] as const,
  session: (id: string) => ['sessions', id] as const,
  compareSessions: (ids: string[]) => ['sessions', 'compare', ids.join(',')] as const,
};

export function useStatus() {
  return useQuery({
    queryKey: queryKeys.status,
    queryFn: async () => unwrap<StatusResponse>(await api.api.status.$get()),
  });
}

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: async () =>
      unwrap<InferResponseType<typeof api.api.projects.$get>>(await api.api.projects.$get()),
  });
}

export function useHarnesses() {
  return useQuery({
    queryKey: queryKeys.harnesses,
    queryFn: async () =>
      unwrap<InferResponseType<typeof api.api.harnesses.$get>>(await api.api.harnesses.$get()),
  });
}

export function useProjectSessions(key: string) {
  return useQuery({
    queryKey: queryKeys.projectSessions(key),
    queryFn: async () =>
      unwrap<InferResponseType<(typeof api.api.projects)[':key']['sessions']['$get']>>(
        await api.api.projects[':key'].sessions.$get({ param: { key } }),
      ),
  });
}

export function useHarnessSessions(id: string) {
  return useQuery({
    queryKey: queryKeys.harnessSessions(id),
    queryFn: async () =>
      unwrap<InferResponseType<(typeof api.api.harnesses)[':id']['sessions']['$get']>>(
        await api.api.harnesses[':id'].sessions.$get({ param: { id } }),
      ),
  });
}

export function useSession(id: string) {
  return useQuery({
    queryKey: queryKeys.session(id),
    queryFn: async () =>
      unwrap<SessionDetailResponse>(await api.api.sessions[':id'].$get({ param: { id } })),
  });
}

export function useCompareSessions(ids: string[]) {
  return useQuery({
    queryKey: queryKeys.compareSessions(ids),
    queryFn: async () =>
      unwrap<Exclude<InferResponseType<(typeof api.api.sessions)['$get']>, { error: string }>>(
        await api.api.sessions.$get({ query: { ids: ids.join(',') } }),
      ),
    enabled: ids.length > 0,
  });
}

export function useRescan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      unwrap<InferResponseType<typeof api.api.rescan.$post>>(await api.api.rescan.$post()),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

/**
 * Adapter capabilities for a harness. `undefined` while status is loading or the
 * harness is unknown — callers must treat that as "capability present" (absence
 * renders as missing-in-session, never as not-provided).
 */
export function useAdapterCapabilities(harnessId: string): readonly Capability[] | undefined {
  const { data, isPending } = useStatus();
  if (isPending || !data) return undefined;
  return data.adapters.find((adapter) => adapter.id === harnessId)?.capabilities;
}

/** Display name from status, falling back to the harness id while loading. */
export function useAdapterDisplayName(harnessId: string): string {
  const { data } = useStatus();
  return data?.adapters.find((adapter) => adapter.id === harnessId)?.displayName ?? harnessId;
}
