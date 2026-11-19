import type { Database } from 'bun:sqlite';
import { profileScopeCte, profileScopeParams, readProfileScopeNodes } from './profile-scope';
import { readProfileSpawns } from './profile-spawns';
import {
  type FieldCounts,
  type NullableTokens,
  PROFILE_TOKEN_FIELDS,
  type SpawnMarker,
  type TimeDomain,
  type TimelinePoint,
  type TimelineQuery,
  type TimelineResponse,
  type TokenField,
  type UsageSeries,
} from './profile-types';

type TokenRow = Record<
  'uncached_input' | 'cached_input' | 'cache_write' | 'output' | 'reasoning_output',
  number | null
>;
type CallRow = TokenRow & {
  session_id: string;
  seq: number;
  at: string | null;
  model: string | null;
};
type TimedCallRow = CallRow & { at: string };

const columns: Record<TokenField, keyof TokenRow> = {
  uncachedInput: 'uncached_input',
  cachedInput: 'cached_input',
  cacheWrite: 'cache_write',
  output: 'output',
  reasoningOutput: 'reasoning_output',
};
function emptyTokens(): NullableTokens {
  return {
    uncachedInput: null,
    cachedInput: null,
    cacheWrite: null,
    output: null,
    reasoningOutput: null,
  };
}
function emptyCounts(): FieldCounts {
  return {
    uncachedInput: 0,
    cachedInput: 0,
    cacheWrite: 0,
    output: 0,
    reasoningOutput: 0,
  };
}

function add(totals: NullableTokens, counts: FieldCounts, row: TokenRow): void {
  for (const field of PROFILE_TOKEN_FIELDS) {
    const value = row[columns[field]];
    if (value !== null) {
      totals[field] = (totals[field] ?? 0) + value;
      counts[field] += 1;
    }
  }
}

function aggregate(rows: readonly TokenRow[]): { totals: NullableTokens; counts: FieldCounts } {
  const totals = emptyTokens();
  const counts = emptyCounts();
  for (const row of rows) add(totals, counts, row);
  return { totals, counts };
}

function buildModelSeries<T extends TokenRow & { model: string | null }>(
  rows: readonly T[],
): { series: UsageSeries[]; visible: ReadonlySet<string> } {
  const modelCalls = new Map<string, T[]>();
  for (const row of rows) {
    const name =
      row.model === null
        ? 'unknown'
        : row.model === 'unknown' || row.model === 'other'
          ? 'other'
          : row.model;
    let bucket = modelCalls.get(name);
    if (bucket === undefined) {
      bucket = [];
      modelCalls.set(name, bucket);
    }
    bucket.push(row);
  }
  const named = [...modelCalls.entries()]
    .filter(([name]) => name !== 'unknown' && name !== 'other')
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const visible = new Set(named.slice(0, 7).map(([name]) => name));
  const seriesCalls = new Map<string, T[]>();
  for (const [name, values] of modelCalls) {
    const bucket =
      name === 'unknown' ? 'unknown' : name === 'other' || !visible.has(name) ? 'other' : name;
    seriesCalls.set(bucket, [...(seriesCalls.get(bucket) ?? []), ...values]);
  }
  const series: UsageSeries[] = [...seriesCalls.entries()]
    .map(([model, values]) => {
      const result = aggregate(values);
      return {
        model,
        totals: result.totals,
        callsWithField: result.counts,
        callCount: values.length,
      };
    })
    .sort((a, b) => b.callCount - a.callCount || a.model.localeCompare(b.model));
  return { series, visible };
}

function responseModel(model: string | null, visible: ReadonlySet<string>): string {
  if (model === null) return 'unknown';
  if (model === 'unknown' || model === 'other' || !visible.has(model)) return 'other';
  return model;
}

function domain(calls: readonly TimedCallRow[]): TimeDomain {
  if (calls.length === 0) return { start: null, end: null };
  let previous = -Infinity;
  for (const call of calls) {
    const current = Date.parse(call.at);
    if (!Number.isFinite(current) || current < previous) return { start: null, end: null };
    previous = current;
  }
  const first = calls[0];
  const last = calls[calls.length - 1];
  if (!first || !last) return { start: null, end: null };
  return { start: first.at, end: last.at };
}

function points(
  calls: readonly TimedCallRow[],
  field: TokenField,
  series: readonly UsageSeries[],
  visible: ReadonlySet<string>,
): readonly TimelinePoint[] {
  if (calls.length === 0) return [];
  const bucketCount = Math.min(400, calls.length);
  const result: TimelinePoint[] = [];
  const cumulative: (number | null)[] = series.map(() => 0);
  const appeared = series.map(() => false);
  const observed = series.map(() => false);
  let totalCumulative: number | null = null;
  const indexByModel = new Map(series.map((item, index) => [item.model, index]));
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.floor((bucket * calls.length) / bucketCount);
    const end = Math.floor(((bucket + 1) * calls.length) / bucketCount);
    const delta: (number | null)[] = series.map(() => 0);
    const bucketCalls = series.map(() => 0);
    const bucketObserved = series.map(() => false);
    let totalDelta: number | null = null;
    for (const call of calls.slice(start, end)) {
      const index = indexByModel.get(responseModel(call.model, visible));
      if (index === undefined) continue;
      appeared[index] = true;
      bucketCalls[index] = (bucketCalls[index] ?? 0) + 1;
      const value = call[columns[field]];
      if (value !== null) {
        bucketObserved[index] = true;
        delta[index] = (delta[index] ?? 0) + value;
        cumulative[index] = (observed[index] ? (cumulative[index] ?? 0) : 0) + value;
        observed[index] = true;
        totalDelta = (totalDelta ?? 0) + value;
        totalCumulative = (totalCumulative ?? 0) + value;
      }
    }
    for (let index = 0; index < series.length; index += 1) {
      if ((bucketCalls[index] ?? 0) > 0 && !bucketObserved[index]) delta[index] = null;
      if (appeared[index] && !observed[index]) cumulative[index] = null;
    }
    const last = calls[end - 1];
    if (!last) break;
    result.push({
      at: last.at,
      delta,
      cumulative: [...cumulative],
      totalDelta,
      totalCumulative,
    });
  }
  return result;
}

export function readProfileTimeline(
  db: Database,
  sessionId: string,
  query: TimelineQuery = {},
): TimelineResponse | null {
  const scope = query.scope ?? 'tree';
  const field = query.field ?? 'output';
  const nodes = readProfileScopeNodes(db, sessionId, scope);
  if (nodes === null) return null;

  const prefix = profileScopeCte(scope);
  const params = profileScopeParams(sessionId);
  const calls = db
    .query(
      `${prefix} SELECT st.session_id, st.seq, st.at, mn.name AS model, st.uncached_input, st.cached_input, st.cache_write, st.output, st.reasoning_output FROM steps st JOIN profile_scope ps ON ps.id = st.session_id LEFT JOIN models mn ON mn.id = st.model_id WHERE st.kind = 'call'`,
    )
    .all(...params) as CallRow[];

  const { series, visible } = buildModelSeries(calls);

  const timed = calls.filter((call): call is TimedCallRow => call.at !== null);
  timed.sort((a, b) => {
    const diff = Date.parse(a.at) - Date.parse(b.at);
    if (diff !== 0 && !Number.isNaN(diff)) return diff;
    return a.session_id === b.session_id ? a.seq - b.seq : a.session_id.localeCompare(b.session_id);
  });
  const excludedNullAtCount = calls.length - timed.length;

  const spawnsResult = readProfileSpawns(db, sessionId, {
    scope,
    limit: Number.MAX_SAFE_INTEGER,
    offset: 0,
  });
  const spawns: SpawnMarker[] = (spawnsResult?.items ?? [])
    .filter((item) => item.causalStatus === 'linked' && item.child !== null && item.callAt !== null)
    .map((item) => ({
      at: item.callAt as string,
      parentId: item.parent.id,
      childId: (item.child as NonNullable<typeof item.child>).id,
    }));

  return {
    sessionId,
    scope,
    field,
    series,
    points: points(timed, field, series, visible),
    spawns,
    excludedNullAtCount,
    timeDomain: domain(timed),
  };
}
