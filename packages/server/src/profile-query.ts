import type {
  EventFilter,
  MergedEventsQuery,
  ProfileSpawnsQuery,
  Scope,
  SignalsQuery,
  TimelineQuery,
  TokenField,
} from '@scout/core';

const SCOPES = new Set<Scope>(['own', 'tree']);
const TOKEN_FIELDS = new Set<TokenField>([
  'uncachedInput',
  'cachedInput',
  'cacheWrite',
  'output',
  'reasoningOutput',
]);
const EVENT_FILTERS = new Set<EventFilter>([
  'relevant',
  'signals',
  'all',
  'mcp',
  'skill',
  'hook',
  'read',
  'write',
  'exec',
  'agent',
  'error',
]);

export type ParsedProfileQuery =
  | { view: 'spawns'; query: ProfileSpawnsQuery }
  | { view: 'signals'; query: SignalsQuery }
  | { view: 'timeline'; field: TokenField; query: TimelineQuery }
  | { view: 'merged'; filter: EventFilter; query: MergedEventsQuery }
  | { view: 'models' };

export type ProfileQueryParseResult =
  | { ok: true; value: ParsedProfileQuery }
  | { ok: false; parameter: string };

const VIEW_KEYS = {
  spawns: new Set(['scope', 'limit', 'offset']),
  signals: new Set(['scope']),
  timeline: new Set(['scope', 'field']),
  merged: new Set(['scope', 'filter', 'limit', 'offset']),
  models: new Set<string>(),
} as const;

function integer(value: string, min: number, max: number): number | null {
  if (value === '' || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function invalid(parameter: string): ProfileQueryParseResult {
  return { ok: false, parameter };
}

/** Strict, view-specific parser. Nothing reaches a core reader before every
 * parameter and cross-parameter constraint has been checked. */
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

  // `models` accepts no query parameters: the empty key set above already
  // rejects every param (including `scope`), so resolve it before the shared
  // scope default would otherwise supply a value.
  if (viewRaw === 'models') return { ok: true, value: { view: 'models' } };

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

  if (viewRaw === 'signals') {
    return { ok: true, value: { view: 'signals', query: { scope } } };
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

  const filterRaw = params.get('filter') ?? 'signals';
  if (!EVENT_FILTERS.has(filterRaw as EventFilter)) return invalid('filter');
  const query: MergedEventsQuery = { scope, filter: filterRaw as EventFilter };
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
  return { ok: true, value: { view: 'merged', filter: filterRaw as EventFilter, query } };
}
