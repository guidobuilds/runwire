import type {
  EventAction,
  EventKind,
  EventSortField,
  EventStatus,
  MergedEventsQuery,
  ProfileSpawnsQuery,
  Scope,
  SignalsQuery,
  SortDirection,
  TimelineQuery,
  TokenField,
} from '@runwire/core';

const SCOPES = new Set<Scope>(['own', 'tree']);
const TOKEN_FIELDS = new Set<TokenField>([
  'uncachedInput',
  'cachedInput',
  'cacheWrite',
  'output',
  'reasoningOutput',
]);
const EVENT_SORTS = new Set<EventSortField>([
  'time',
  'agent',
  'kind',
  'action',
  'subject',
  'model',
  'status',
]);
const SORT_DIRECTIONS = new Set<SortDirection>(['asc', 'desc']);
const EVENT_STATUSES = new Set<EventStatus>(['ok', 'error']);
const EVENT_KINDS = new Set<EventKind>([
  'call',
  'tool',
  'turn',
  'harness',
  'compaction',
  'model-change',
  'mode-change',
]);
const EVENT_ACTIONS = new Set<EventAction>([
  'call',
  'tool',
  'turn',
  'harness',
  'compaction',
  'model-change',
  'mode-change',
  'read',
  'write',
  'exec',
  'search',
  'plan',
  'agent',
  'web',
  'mcp',
  'skill',
  'other',
]);

export type ParsedProfileQuery =
  | { view: 'spawns'; query: ProfileSpawnsQuery }
  | { view: 'signals'; query: SignalsQuery }
  | { view: 'timeline'; field: TokenField; query: TimelineQuery }
  | { view: 'merged'; query: MergedEventsQuery }
  | { view: 'lanes'; query: { scope: Scope } }
  | { view: 'models' }
  | { view: 'context' };

export type ProfileQueryParseResult =
  | { ok: true; value: ParsedProfileQuery }
  | { ok: false; parameter: string };

const VIEW_KEYS = {
  spawns: new Set(['scope', 'limit', 'offset']),
  signals: new Set(['scope']),
  timeline: new Set(['scope', 'field']),
  merged: new Set([
    'scope',
    'limit',
    'offset',
    'sort',
    'dir',
    'kind',
    'action',
    'status',
    'model',
    'q',
  ]),
  lanes: new Set(['scope']),
  models: new Set<string>(),
  context: new Set<string>(),
} as const;

function integer(value: string, min: number, max: number): number | null {
  if (value === '' || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function invalid(parameter: string): ProfileQueryParseResult {
  return { ok: false, parameter };
}

function csvAllowList<T extends string>(raw: string, allowed: ReadonlySet<T>): readonly T[] | null {
  const seen = new Set<T>();
  for (const segment of raw.split(',')) {
    const value = segment.trim();
    if (value === '' || !allowed.has(value as T)) return null;
    seen.add(value as T);
  }
  return [...seen];
}

export function parseProfileQuery(
  params: URLSearchParams,
  viewRaw: ParsedProfileQuery['view'],
): ProfileQueryParseResult {
  for (const key of params.keys()) {
    if (params.getAll(key).length !== 1) return invalid(key);
  }

  if (params.has('view')) return invalid('view');
  for (const key of params.keys()) {
    if (!VIEW_KEYS[viewRaw].has(key)) return invalid(key);
  }

  if (viewRaw === 'models') return { ok: true, value: { view: 'models' } };
  if (viewRaw === 'context') return { ok: true, value: { view: 'context' } };

  const scopeRaw = params.get('scope') ?? 'tree';
  if (!SCOPES.has(scopeRaw as Scope)) return invalid('scope');
  const scope = scopeRaw as Scope;

  if (viewRaw === 'spawns') {
    const query: ProfileSpawnsQuery = { scope };
    const limitRaw = params.get('limit');
    if (limitRaw !== null) {
      const limit = integer(limitRaw, 1, 200);
      if (limit === null) return invalid('limit');
      query.limit = limit;
    }
    const offsetRaw = params.get('offset');
    if (offsetRaw !== null) {
      const offset = integer(offsetRaw, 0, Number.MAX_SAFE_INTEGER);
      if (offset === null) return invalid('offset');
      query.offset = offset;
    }
    return { ok: true, value: { view: 'spawns', query } };
  }

  if (viewRaw === 'signals' || viewRaw === 'lanes') {
    return { ok: true, value: { view: viewRaw, query: { scope } } };
  }

  if (viewRaw === 'timeline') {
    const fieldRaw = params.get('field') ?? 'output';
    if (!TOKEN_FIELDS.has(fieldRaw as TokenField)) return invalid('field');
    return {
      ok: true,
      value: {
        view: 'timeline',
        field: fieldRaw as TokenField,
        query: { scope, field: fieldRaw as TokenField },
      },
    };
  }

  const query: MergedEventsQuery = { scope };

  const sortRaw = params.get('sort') ?? 'time';
  if (!EVENT_SORTS.has(sortRaw as EventSortField)) return invalid('sort');
  query.sort = sortRaw as EventSortField;

  const dirRaw = params.get('dir') ?? 'asc';
  if (!SORT_DIRECTIONS.has(dirRaw as SortDirection)) return invalid('dir');
  query.dir = dirRaw as SortDirection;

  const kindRaw = params.get('kind');
  if (kindRaw !== null) {
    const kinds = csvAllowList(kindRaw, EVENT_KINDS);
    if (kinds === null) return invalid('kind');
    query.kind = kinds;
  }
  const actionRaw = params.get('action');
  if (actionRaw !== null) {
    const actions = csvAllowList(actionRaw, EVENT_ACTIONS);
    if (actions === null) return invalid('action');
    query.action = actions;
  }
  const statusRaw = params.get('status');
  if (statusRaw !== null) {
    if (!EVENT_STATUSES.has(statusRaw as EventStatus)) return invalid('status');
    query.status = statusRaw as EventStatus;
  }
  const modelRaw = params.get('model');
  if (modelRaw !== null) {
    if (modelRaw.trim() === '') return invalid('model');
    query.model = modelRaw;
  }
  const qRaw = params.get('q');
  if (qRaw !== null) {
    if (qRaw.trim() === '') return invalid('q');
    query.q = qRaw;
  }

  const limitRaw = params.get('limit');
  if (limitRaw !== null) {
    const limit = integer(limitRaw, 1, 200);
    if (limit === null) return invalid('limit');
    query.limit = limit;
  }
  const offsetRaw = params.get('offset');
  if (offsetRaw !== null) {
    const offset = integer(offsetRaw, 0, Number.MAX_SAFE_INTEGER);
    if (offset === null) return invalid('offset');
    query.offset = offset;
  }
  return { ok: true, value: { view: 'merged', query } };
}
