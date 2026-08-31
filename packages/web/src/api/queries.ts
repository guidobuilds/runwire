import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import { api, unwrap } from './client';
import type { Capability, SessionDetailResponse, StatusResponse } from './types';

/**
 * Percent-encodes one path-param value.
 *
 * `hc<AppType>` interpolates path params **verbatim** — `replaceUrlParam` in
 * `hono/dist/client/utils.js` is a bare `urlString.replace(reg, () => `/${v}`)`
 * — so a value containing `/` silently spreads across path segments and matches
 * no route. Every real `ProjectRef.key` is a repo URL or a filesystem path, so
 * an unencoded key is a 404 on every project page, not an edge case (measured
 * against a live `scout serve`: encoded → 200 with 40 summaries, raw → 404).
 *
 * The encoding lives here, at the layer that builds the request, rather than at
 * a route call site: a call site fix leaves every other caller of the same hook
 * broken. Callers pass the **raw** value — it is also what the query key is
 * built from, so the cache stays keyed by identity rather than by spelling.
 *
 * TanStack Router already does the mirror-image job for the browser URL
 * (`encodePathParam` always encodes, and hands the decoded value back to the
 * component), so a route's `useParams()` value goes straight into these hooks.
 */
function pathParam(value: string): string {
  return encodeURIComponent(value);
}

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
        await api.api.projects[':key'].sessions.$get({ param: { key: pathParam(key) } }),
      ),
  });
}

export function useHarnessSessions(id: string) {
  return useQuery({
    queryKey: queryKeys.harnessSessions(id),
    queryFn: async () =>
      unwrap<InferResponseType<(typeof api.api.harnesses)[':id']['sessions']['$get']>>(
        await api.api.harnesses[':id'].sessions.$get({ param: { id: pathParam(id) } }),
      ),
  });
}

export function useSession(id: string) {
  return useQuery({
    queryKey: queryKeys.session(id),
    queryFn: async () =>
      unwrap<SessionDetailResponse>(
        await api.api.sessions[':id'].$get({ param: { id: pathParam(id) } }),
      ),
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
