import type {
  EventAction,
  EventKind,
  EventSortField,
  EventStatus,
  Scope,
  SortDirection,
  TokenField,
} from '@runwire/core';
import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import {
  fetchSessionProfileContext,
  fetchSessionProfileMergedEvents,
  fetchSessionProfileModels,
  fetchSessionProfileSignals,
  fetchSessionProfileSpawns,
  fetchSessionProfileTimeline,
} from '@/lib/api/session-profile';

export type ProfileSpawnsSelection = {
  scope: Scope;
  limit?: number;
  expandedIds?: readonly string[];
  refresh?: number;
};

export type ProfileSignalsSelection = {
  scope: Scope;
  refresh?: number;
};

export type ProfileTimelineSelection = {
  scope: Scope;
  field: TokenField;
  refresh?: number;
};

export type ProfileMergedEventsSelection = {
  scope: Scope;
  sort?: EventSortField;
  dir?: SortDirection;
  kind?: readonly EventKind[];
  action?: readonly EventAction[];
  status?: EventStatus;
  model?: string;
  q?: string;
  limit?: number;
  offset?: number;
  refresh?: number;
};

export type ProfileModelsSelection = {
  refresh?: number;
};

export type ProfileContextSelection = {
  refresh?: number;
};

const noRefetch = { refetchOnWindowFocus: false, refetchInterval: false } as const;
const stableIds = (ids: readonly string[] = []) => [...new Set(ids)].sort();

export const sessionProfileKeys = {
  spawns: (id: string, selection: ProfileSpawnsSelection) =>
    [
      'session-profile',
      id,
      'spawns',
      selection.scope,
      selection.limit ?? null,
      stableIds(selection.expandedIds),
      selection.refresh ?? 0,
    ] as const,
  signals: (id: string, selection: ProfileSignalsSelection) =>
    ['session-profile', id, 'signals', selection.scope, selection.refresh ?? 0] as const,
  timeline: (id: string, selection: ProfileTimelineSelection) =>
    [
      'session-profile',
      id,
      'timeline',
      selection.scope,
      selection.field,
      selection.refresh ?? 0,
    ] as const,
  mergedEvents: (id: string, selection: ProfileMergedEventsSelection) =>
    [
      'session-profile',
      id,
      'merged',
      selection.scope,
      selection.sort ?? null,
      selection.dir ?? null,
      stableIds(selection.kind),
      stableIds(selection.action),
      selection.status ?? null,
      selection.model ?? null,
      selection.q ?? null,
      selection.limit ?? null,
      selection.offset ?? null,
      selection.refresh ?? 0,
    ] as const,
  models: (id: string, selection: ProfileModelsSelection) =>
    ['session-profile', id, 'models', selection.refresh ?? 0] as const,
  context: (id: string, selection: ProfileContextSelection) =>
    ['session-profile', id, 'context', selection.refresh ?? 0] as const,
};

export function sessionProfileSpawnsOptions(id: string, selection: ProfileSpawnsSelection) {
  const limit = selection.limit ?? 50;
  return infiniteQueryOptions({
    queryKey: sessionProfileKeys.spawns(id, selection),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      fetchSessionProfileSpawns(id, { ...selection, limit, offset: pageParam }, signal),
    getNextPageParam: (page) =>
      page.offset + page.limit < page.total ? page.offset + page.limit : undefined,
    ...noRefetch,
  });
}

export function useSessionProfileSpawns(id: string, selection: ProfileSpawnsSelection) {
  return useInfiniteQuery(sessionProfileSpawnsOptions(id, selection));
}

export function sessionProfileSignalsOptions(id: string, selection: ProfileSignalsSelection) {
  return queryOptions({
    queryKey: sessionProfileKeys.signals(id, selection),
    queryFn: ({ signal }) => fetchSessionProfileSignals(id, selection, signal),
    ...noRefetch,
  });
}

export function useSessionProfileSignals(id: string, selection: ProfileSignalsSelection) {
  return useQuery(sessionProfileSignalsOptions(id, selection));
}

export function sessionProfileTimelineOptions(id: string, selection: ProfileTimelineSelection) {
  return queryOptions({
    queryKey: sessionProfileKeys.timeline(id, selection),
    queryFn: ({ signal }) => fetchSessionProfileTimeline(id, selection, signal),
    ...noRefetch,
  });
}

export function useSessionProfileTimeline(id: string, selection: ProfileTimelineSelection) {
  return useQuery(sessionProfileTimelineOptions(id, selection));
}

/** Page-number navigation (shadcn Pagination), not infinite scroll: each page
 * is its own cached query keyed by {scope, filter, limit, offset}, and
 * `keepPreviousData` keeps the prior page's rows on screen while the next
 * page loads instead of flashing a loading state. */
export function sessionProfileMergedEventsOptions(
  id: string,
  selection: ProfileMergedEventsSelection,
) {
  return queryOptions({
    queryKey: sessionProfileKeys.mergedEvents(id, selection),
    queryFn: ({ signal }) => fetchSessionProfileMergedEvents(id, selection, signal),
    placeholderData: keepPreviousData,
    ...noRefetch,
  });
}

export function useSessionProfileMergedEvents(id: string, selection: ProfileMergedEventsSelection) {
  return useQuery(sessionProfileMergedEventsOptions(id, selection));
}

export function sessionProfileModelsOptions(id: string, selection: ProfileModelsSelection) {
  return queryOptions({
    queryKey: sessionProfileKeys.models(id, selection),
    queryFn: ({ signal }) => fetchSessionProfileModels(id, signal),
    ...noRefetch,
  });
}

export function useSessionProfileModels(id: string, selection: ProfileModelsSelection) {
  return useQuery(sessionProfileModelsOptions(id, selection));
}

export function sessionProfileContextOptions(id: string, selection: ProfileContextSelection) {
  return queryOptions({
    queryKey: sessionProfileKeys.context(id, selection),
    queryFn: ({ signal }) => fetchSessionProfileContext(id, signal),
    ...noRefetch,
  });
}

export function useSessionProfileContext(id: string, selection: ProfileContextSelection) {
  return useQuery(sessionProfileContextOptions(id, selection));
}
