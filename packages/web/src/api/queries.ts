import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import { usePrefs } from '../state/prefs';
import { api, unwrap } from './client';
import type {
  Capability,
  CompareSessionsResponse,
  SessionDetailResponse,
  SessionsListResponse,
  SessionTraceResponse,
  StatusResponse,
} from './types';

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

/**
 * The `?automated=` value for a given `showAutomated` preference.
 *
 * Only the literal `exclude` narrows anything server-side, so "show them" is
 * spelled by sending nothing at all — the request for the unfiltered view is
 * byte-identical to what every client sent before this feature existed.
 */
function automatedQuery(showAutomated: boolean): { automated?: string } {
  return showAutomated ? {} : { automated: 'exclude' };
}

/**
 * Query keys.
 *
 * The five keys that take `showAutomated` are exactly the five whose response
 * body changes with the preference (`/projects`, `/harnesses`, the two scoped
 * session lists, and the unscoped one). Leaving the flag out of even one of
 * them is a **silent** bug rather than a loud one: react-query would happily
 * serve the cached payload from the other setting, so a screen would keep
 * showing the old row set and the old totals with no error anywhere.
 *
 * The other four keys are deliberately unkeyed on it because their responses
 * genuinely do not vary: `status` is adapter facts, and `session`, `trace` and
 * `compareSessions` all address sessions by explicit id, which the server
 * resolves regardless of the filter. Keying those on the flag would only buy
 * needless refetches on every toggle.
 */
export const queryKeys = {
  status: ['status'] as const,
  projects: (showAutomated: boolean) => ['projects', { showAutomated }] as const,
  harnesses: (showAutomated: boolean) => ['harnesses', { showAutomated }] as const,
  projectSessions: (key: string, showAutomated: boolean) =>
    ['projects', key, 'sessions', { showAutomated }] as const,
  harnessSessions: (id: string, showAutomated: boolean) =>
    ['harnesses', id, 'sessions', { showAutomated }] as const,
  session: (id: string) => ['sessions', id] as const,
  compareSessions: (ids: string[]) => ['sessions', 'compare', ids.join(',')] as const,
  allSessions: (showAutomated: boolean) => ['sessions', 'all', { showAutomated }] as const,
  trace: (id: string) => ['sessions', id, 'trace'] as const,
};

export function useStatus() {
  return useQuery({
    queryKey: queryKeys.status,
    queryFn: async () => unwrap<StatusResponse>(await api.api.status.$get()),
  });
}

/**
 * Whether machine-initiated sessions are in scope for this render.
 *
 * Read from the preference *inside* each hook rather than passed in by callers:
 * `SessionTable` alone is mounted from three routes, and `useProjectSessions`
 * is additionally called once per card on the Projects index. Threading a
 * parameter through all of those means every present and future call site has
 * to remember it, and forgetting at one of them is invisible (that screen just
 * quietly disagrees with the rest of the app about how many sessions exist).
 * Sourcing it here makes the flag impossible to omit.
 */
function useShowAutomated(): boolean {
  return usePrefs().showAutomated;
}

export function useProjects() {
  const showAutomated = useShowAutomated();
  return useQuery({
    queryKey: queryKeys.projects(showAutomated),
    queryFn: async () =>
      unwrap<InferResponseType<typeof api.api.projects.$get>>(
        await api.api.projects.$get({ query: automatedQuery(showAutomated) }),
      ),
  });
}

export function useHarnesses() {
  const showAutomated = useShowAutomated();
  return useQuery({
    queryKey: queryKeys.harnesses(showAutomated),
    queryFn: async () =>
      unwrap<InferResponseType<typeof api.api.harnesses.$get>>(
        await api.api.harnesses.$get({ query: automatedQuery(showAutomated) }),
      ),
  });
}

export function useProjectSessions(key: string) {
  const showAutomated = useShowAutomated();
  return useQuery({
    queryKey: queryKeys.projectSessions(key, showAutomated),
    queryFn: async () =>
      unwrap<SessionsListResponse>(
        await api.api.projects[':key'].sessions.$get({
          param: { key: pathParam(key) },
          query: automatedQuery(showAutomated),
        }),
      ),
  });
}

export function useHarnessSessions(id: string) {
  const showAutomated = useShowAutomated();
  return useQuery({
    queryKey: queryKeys.harnessSessions(id, showAutomated),
    queryFn: async () =>
      unwrap<SessionsListResponse>(
        await api.api.harnesses[':id'].sessions.$get({
          param: { id: pathParam(id) },
          query: automatedQuery(showAutomated),
        }),
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

/** `GET /api/sessions/:id/trace` (packages/server/src/routes.ts). */
export function useTrace(id: string) {
  return useQuery({
    queryKey: queryKeys.trace(id),
    queryFn: async () =>
      unwrap<SessionTraceResponse>(
        await api.api.sessions[':id'].trace.$get({ param: { id: pathParam(id) } }),
      ),
  });
}

/**
 * One `useTrace`-shaped query per id, for Compare's compact ribbon strip
 * (f8, DECISIONS D33 — a shared step-index axis across every compared
 * session). Each trace is fetched independently (so one slow/failing
 * session's trace never blocks the others' ribbons from rendering) and keyed
 * with the same `queryKeys.trace(id)` `useTrace` uses, so a trace already
 * cached from Session detail is reused rather than re-fetched.
 */
export function useTraces(ids: readonly string[]) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: queryKeys.trace(id),
      queryFn: async () =>
        unwrap<SessionTraceResponse>(
          await api.api.sessions[':id'].trace.$get({ param: { id: pathParam(id) } }),
        ),
    })),
  });
}

export function useCompareSessions(ids: string[]) {
  return useQuery({
    queryKey: queryKeys.compareSessions(ids),
    queryFn: async () =>
      unwrap<CompareSessionsResponse>(
        await api.api.sessions.$get({ query: { ids: ids.join(',') } }),
      ),
    enabled: ids.length > 0,
  });
}

/**
 * `GET /api/sessions` with no `ids` (packages/server/src/routes.ts, f5): every
 * root session's summary + rollup, unscoped by project or harness — the
 * Sessions landing screen's data source. Keyed separately from
 * `compareSessions` (whose key embeds the ids string) so the two branches of
 * the one route never collide in the query cache.
 */
export function useAllSessions() {
  const showAutomated = useShowAutomated();
  return useQuery({
    queryKey: queryKeys.allSessions(showAutomated),
    queryFn: async () =>
      unwrap<SessionsListResponse>(
        await api.api.sessions.$get({ query: automatedQuery(showAutomated) }),
      ),
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
