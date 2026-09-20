import type {
  ContextMetrics,
  Event,
  EventFilter,
  MergedEventsQuery,
  MergedEventsResponse,
  ModelsResponse,
  ModelUsageEntry,
  ModelUsageGroup,
  ProfileContextDescendant,
  ProfileContextResponse,
  ProfileSpawnsQuery,
  ProfileSpawnsResponse,
  Scope,
  SignalsQuery,
  SignalsResponse,
  TimelinePoint,
  TimelineQuery,
  TimelineResponse,
  TokenField,
  UsageSeries,
} from '@runwire/core';
import { apiFetch } from './client';

export type SessionProfileSpawns = ProfileSpawnsResponse & { view: 'spawns' };
export type SessionProfileSignals = SignalsResponse & { view: 'signals' };
export type SessionProfileTimeline = TimelineResponse & { view: 'timeline' };
export type SessionProfileMergedEvents = MergedEventsResponse & { view: 'merged' };
export type SessionProfileModels = ModelsResponse & { view: 'models' };
export type SessionProfileContext = ProfileContextResponse & { view: 'context' };

export type SpawnsRequest = ProfileSpawnsQuery;
export type SignalsRequest = SignalsQuery;
export type TimelineRequest = TimelineQuery;
export type MergedEventsRequest = MergedEventsQuery;

function path(
  id: string,
  endpoint: 'spawns' | 'signals' | 'timeline' | 'events' | 'models' | 'context',
): string {
  return `/api/sessions/${encodeURIComponent(id)}/profile/${endpoint}`;
}

function search(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isScope(value: unknown): value is Scope {
  return value === 'own' || value === 'tree';
}

function isTokenField(value: unknown): value is TokenField {
  return (
    value === 'uncachedInput' ||
    value === 'cachedInput' ||
    value === 'cacheWrite' ||
    value === 'output' ||
    value === 'reasoningOutput'
  );
}

function isEventFilter(value: unknown): value is EventFilter {
  switch (value) {
    case 'relevant':
    case 'signals':
    case 'all':
    case 'mcp':
    case 'skill':
    case 'hook':
    case 'read':
    case 'write':
    case 'exec':
    case 'agent':
    case 'error':
      return true;
    default:
      return false;
  }
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function normalizeSignals(value: unknown): SessionProfileSignals {
  if (
    !isRecord(value) ||
    typeof value.sessionId !== 'string' ||
    !isScope(value.scope) ||
    !isRecord(value.compactions) ||
    typeof value.compactions.auto !== 'number' ||
    typeof value.compactions.manual !== 'number' ||
    typeof value.compactions.unknown !== 'number' ||
    typeof value.modelChanges !== 'number' ||
    !isRecord(value.toolCalls) ||
    typeof value.toolCalls.total !== 'number' ||
    typeof value.toolCalls.mcp !== 'number' ||
    !isStringArray(value.mcpServers) ||
    typeof value.skillCalls !== 'number' ||
    !isStringArray(value.skillNames)
  ) {
    throw new TypeError('invalid session profile signals response');
  }
  return {
    view: 'signals',
    sessionId: value.sessionId,
    scope: value.scope,
    compactions: {
      auto: value.compactions.auto,
      manual: value.compactions.manual,
      unknown: value.compactions.unknown,
    },
    modelChanges: value.modelChanges,
    toolCalls: { total: value.toolCalls.total, mcp: value.toolCalls.mcp },
    mcpServers: value.mcpServers,
    skillCalls: value.skillCalls,
    skillNames: value.skillNames,
  };
}

function isNullableNumberArray(value: unknown): value is readonly (number | null)[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number' || item === null);
}

function normalizeUsageSeries(value: unknown): UsageSeries {
  if (
    !isRecord(value) ||
    typeof value.model !== 'string' ||
    !isRecord(value.totals) ||
    !isRecord(value.callsWithField) ||
    typeof value.callCount !== 'number'
  ) {
    throw new TypeError('invalid session profile series entry');
  }
  const totals = value.totals;
  const callsWithField = value.callsWithField;
  for (const field of [
    'uncachedInput',
    'cachedInput',
    'cacheWrite',
    'output',
    'reasoningOutput',
  ] as const) {
    if (typeof totals[field] !== 'number' && totals[field] !== null) {
      throw new TypeError('invalid session profile series totals');
    }
    if (typeof callsWithField[field] !== 'number') {
      throw new TypeError('invalid session profile series callsWithField');
    }
  }
  return {
    model: value.model as UsageSeries['model'],
    totals: totals as UsageSeries['totals'],
    callsWithField: callsWithField as UsageSeries['callsWithField'],
    callCount: value.callCount,
  };
}

function normalizeTimelinePoint(value: unknown): TimelinePoint {
  if (
    !isRecord(value) ||
    typeof value.at !== 'string' ||
    !isNullableNumberArray(value.delta) ||
    !isNullableNumberArray(value.cumulative) ||
    (typeof value.totalDelta !== 'number' && value.totalDelta !== null) ||
    (typeof value.totalCumulative !== 'number' && value.totalCumulative !== null)
  ) {
    throw new TypeError('invalid session profile timeline point');
  }
  return {
    at: value.at,
    delta: value.delta,
    cumulative: value.cumulative,
    totalDelta: value.totalDelta,
    totalCumulative: value.totalCumulative,
  };
}

function normalizeSpawnMarker(value: unknown): TimelineResponse['spawns'][number] {
  if (
    !isRecord(value) ||
    typeof value.at !== 'string' ||
    typeof value.parentId !== 'string' ||
    typeof value.childId !== 'string'
  ) {
    throw new TypeError('invalid session profile spawn marker');
  }
  return { at: value.at, parentId: value.parentId, childId: value.childId };
}

function normalizeTimeDomain(value: unknown): TimelineResponse['timeDomain'] {
  if (
    !isRecord(value) ||
    (typeof value.start !== 'string' && value.start !== null) ||
    (typeof value.end !== 'string' && value.end !== null)
  ) {
    throw new TypeError('invalid session profile time domain');
  }
  return { start: value.start, end: value.end };
}

function normalizeTimeline(value: unknown): SessionProfileTimeline {
  if (
    !isRecord(value) ||
    typeof value.sessionId !== 'string' ||
    !isScope(value.scope) ||
    !isTokenField(value.field) ||
    !Array.isArray(value.series) ||
    !Array.isArray(value.points) ||
    !Array.isArray(value.spawns) ||
    typeof value.excludedNullAtCount !== 'number'
  ) {
    throw new TypeError('invalid session profile timeline response');
  }
  return {
    view: 'timeline',
    sessionId: value.sessionId,
    scope: value.scope,
    field: value.field,
    series: value.series.map(normalizeUsageSeries),
    points: value.points.map(normalizeTimelinePoint),
    spawns: value.spawns.map(normalizeSpawnMarker),
    excludedNullAtCount: value.excludedNullAtCount,
    timeDomain: normalizeTimeDomain(value.timeDomain),
  };
}

function normalizeMergedEvent(value: unknown): Event {
  if (
    !isRecord(value) ||
    typeof value.streamId !== 'string' ||
    typeof value.sessionId !== 'string' ||
    typeof value.seq !== 'number' ||
    (typeof value.at !== 'string' && value.at !== null) ||
    (typeof value.error !== 'boolean' && value.error !== null)
  ) {
    throw new TypeError('invalid session profile merged event');
  }
  const base = {
    streamId: value.streamId,
    sessionId: value.sessionId,
    seq: value.seq,
    at: value.at,
    error: value.error,
  };
  switch (value.kind) {
    case 'call':
      if (typeof value.model !== 'string' && value.model !== null) break;
      return { ...base, kind: 'call', model: value.model };
    case 'tool':
      if (
        (typeof value.category !== 'string' && value.category !== null) ||
        (typeof value.toolName !== 'string' && value.toolName !== null)
      )
        break;
      return {
        ...base,
        kind: 'tool',
        category: value.category,
        toolName: value.toolName,
        // Additive-with-default: responses predating the `model` field (or a
        // null model) normalize to null rather than throwing (see merged-events-nodes-normalizer).
        model: typeof value.model === 'string' ? value.model : null,
      };
    case 'turn':
      if (typeof value.durationMs !== 'number' && value.durationMs !== null) break;
      return { ...base, kind: 'turn', durationMs: value.durationMs };
    case 'harness':
      if (typeof value.toolName !== 'string' && value.toolName !== null) break;
      return { ...base, kind: 'harness', toolName: value.toolName };
    case 'compaction':
      if (typeof value.trigger !== 'string' && value.trigger !== null) break;
      return { ...base, kind: 'compaction', trigger: value.trigger };
    case 'model-change':
    case 'mode-change':
      if (
        (typeof value.from !== 'string' && value.from !== null) ||
        (typeof value.to !== 'string' && value.to !== null)
      )
        break;
      return { ...base, kind: value.kind, from: value.from, to: value.to };
  }
  throw new TypeError('invalid session profile merged event');
}

function normalizeMergedEventNode(value: unknown): { id: string; agentType: string | null } {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    (typeof value.agentType !== 'string' && value.agentType !== null)
  ) {
    throw new TypeError('invalid session profile merged event node');
  }
  return { id: value.id, agentType: value.agentType };
}

function normalizeMergedEvents(value: unknown): SessionProfileMergedEvents {
  if (
    !isRecord(value) ||
    typeof value.sessionId !== 'string' ||
    !isScope(value.scope) ||
    !isEventFilter(value.filter) ||
    !Array.isArray(value.items) ||
    typeof value.total !== 'number' ||
    typeof value.limit !== 'number' ||
    typeof value.offset !== 'number' ||
    typeof value.excludedNullAtCount !== 'number'
  ) {
    throw new TypeError('invalid session profile merged events response');
  }
  return {
    view: 'merged',
    sessionId: value.sessionId,
    scope: value.scope,
    filter: value.filter,
    nodes: Array.isArray(value.nodes) ? value.nodes.map(normalizeMergedEventNode) : [],
    items: value.items.map(normalizeMergedEvent),
    total: value.total,
    limit: value.limit,
    offset: value.offset,
    excludedNullAtCount: value.excludedNullAtCount,
  };
}

function normalizeModelUsageEntry(value: unknown): ModelUsageEntry {
  if (
    !isRecord(value) ||
    typeof value.model !== 'string' ||
    typeof value.outputTokens !== 'number' ||
    typeof value.share !== 'number'
  ) {
    throw new TypeError('invalid session profile model usage entry');
  }
  return { model: value.model, outputTokens: value.outputTokens, share: value.share };
}

function normalizeModelUsageGroup(value: unknown): ModelUsageGroup {
  if (!isRecord(value) || typeof value.outputTokens !== 'number' || !Array.isArray(value.models)) {
    throw new TypeError('invalid session profile model usage group');
  }
  return {
    outputTokens: value.outputTokens,
    models: value.models.map(normalizeModelUsageEntry),
  };
}

function normalizeModelsResponse(value: unknown): SessionProfileModels {
  if (
    !isRecord(value) ||
    typeof value.sessionId !== 'string' ||
    !isRecord(value.session) ||
    !isRecord(value.descendants)
  ) {
    throw new TypeError('invalid session profile models response');
  }
  return {
    view: 'models',
    sessionId: value.sessionId,
    session: normalizeModelUsageGroup(value.session),
    descendants: normalizeModelUsageGroup(value.descendants),
  };
}

function isNullableNumber(value: unknown): value is number | null {
  return typeof value === 'number' || value === null;
}

function normalizeContextMetrics(value: unknown): ContextMetrics {
  if (
    !isRecord(value) ||
    typeof value.observedCalls !== 'number' ||
    !isNullableNumber(value.promptInput) ||
    !isNullableNumber(value.avgPromptInput) ||
    !isNullableNumber(value.p95PromptInput) ||
    !isNullableNumber(value.peakPromptInput) ||
    !isNullableNumber(value.cacheReadShare)
  ) {
    throw new TypeError('invalid session profile context metrics');
  }
  return {
    observedCalls: value.observedCalls,
    promptInput: value.promptInput,
    avgPromptInput: value.avgPromptInput,
    p95PromptInput: value.p95PromptInput,
    peakPromptInput: value.peakPromptInput,
    cacheReadShare: value.cacheReadShare,
  };
}

function normalizeContextDescendant(value: unknown): ProfileContextDescendant {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    (typeof value.parentId !== 'string' && value.parentId !== null) ||
    typeof value.relativeDepth !== 'number' ||
    (typeof value.agentType !== 'string' && value.agentType !== null) ||
    (typeof value.startedAt !== 'string' && value.startedAt !== null) ||
    !isNullableNumber(value.durationMs) ||
    (typeof value.modelPrimary !== 'string' && value.modelPrimary !== null) ||
    !isNullableNumber(value.costUsd)
  ) {
    throw new TypeError('invalid session profile context descendant');
  }
  return {
    id: value.id,
    parentId: value.parentId,
    relativeDepth: value.relativeDepth,
    agentType: value.agentType,
    startedAt: value.startedAt,
    durationMs: value.durationMs,
    modelPrimary: value.modelPrimary,
    costUsd: value.costUsd,
    metrics: normalizeContextMetrics(value.metrics),
  };
}

function normalizeContext(value: unknown): SessionProfileContext {
  if (
    !isRecord(value) ||
    typeof value.sessionId !== 'string' ||
    !Array.isArray(value.descendants)
  ) {
    throw new TypeError('invalid session profile context response');
  }
  return {
    view: 'context',
    sessionId: value.sessionId,
    own: normalizeContextMetrics(value.own),
    tree: normalizeContextMetrics(value.tree),
    descendants: value.descendants.map(normalizeContextDescendant),
  };
}

export function fetchSessionProfileSpawns(
  id: string,
  request: SpawnsRequest = {},
  signal?: AbortSignal,
): Promise<SessionProfileSpawns> {
  return apiFetch<SessionProfileSpawns>(
    `${path(id, 'spawns')}${search({ scope: request.scope, limit: request.limit, offset: request.offset })}`,
    { signal },
  );
}

export async function fetchSessionProfileSignals(
  id: string,
  request: SignalsRequest = {},
  signal?: AbortSignal,
): Promise<SessionProfileSignals> {
  const response = await apiFetch<unknown>(
    `${path(id, 'signals')}${search({ scope: request.scope })}`,
    { signal },
  );
  return normalizeSignals(response);
}

export async function fetchSessionProfileTimeline(
  id: string,
  request: TimelineRequest = {},
  signal?: AbortSignal,
): Promise<SessionProfileTimeline> {
  const response = await apiFetch<unknown>(
    `${path(id, 'timeline')}${search({ scope: request.scope, field: request.field })}`,
    { signal },
  );
  return normalizeTimeline(response);
}

export async function fetchSessionProfileMergedEvents(
  id: string,
  request: MergedEventsRequest = {},
  signal?: AbortSignal,
): Promise<SessionProfileMergedEvents> {
  const response = await apiFetch<unknown>(
    `${path(id, 'events')}${search({
      scope: request.scope,
      filter: request.filter,
      limit: request.limit,
      offset: request.offset,
    })}`,
    { signal },
  );
  return normalizeMergedEvents(response);
}

// `/profile/models` takes no query parameters at all: the path must carry no
// `?` (the server 400s on any parameter, see f2-t2).
export async function fetchSessionProfileModels(
  id: string,
  signal?: AbortSignal,
): Promise<SessionProfileModels> {
  const response = await apiFetch<unknown>(path(id, 'models'), { signal });
  return normalizeModelsResponse(response);
}

// `/profile/context` likewise accepts no query parameters: the path must carry
// no `?` (the server 400s on any parameter, including `scope`).
export async function fetchSessionProfileContext(
  id: string,
  signal?: AbortSignal,
): Promise<SessionProfileContext> {
  const response = await apiFetch<unknown>(path(id, 'context'), { signal });
  return normalizeContext(response);
}
