import type {
  CausalStatus,
  Event,
  EventAction,
  EventKind,
  EventSortField,
  EventStatus,
  ProfileNode,
  ProfileSpawnsResponse,
  Scope,
  SortDirection,
  TokenField,
  UsageSeries,
} from '@runwire/core';
import { HttpResponse, http } from 'msw';
import type {
  SessionProfileContext,
  SessionProfileMergedEvents,
  SessionProfileModels,
  SessionProfileSignals,
  SessionProfileSpawns,
  SessionProfileTimeline,
} from '@/lib/api/session-profile';

/** Shared metadata-only profile fixtures for `/api/sessions/{id}/profile/*`. The ids
 * deliberately match `mockSessionSummary`/`mockChildSummary` in `handlers.ts`
 * so the composed route renders one coherent session. */

export const PROFILE_ROOT_ID = 'sess-1';
export const PROFILE_CHILD_ID = 'sess-1-child';
export const PROFILE_GRANDCHILD_ID = 'sess-1-child/grand';

function node(
  id: string,
  parentId: string | null,
  relation: ProfileNode['relation'],
  agentType: string | null,
  startedAt: string | null,
  endedAt: string | null,
): ProfileNode {
  return { id, parentId, relation, agentType, startedAt, endedAt };
}

export const mockRootNode = node(
  PROFILE_ROOT_ID,
  null,
  null,
  'main',
  '2026-09-01T10:00:00.000Z',
  '2026-09-01T10:30:00.000Z',
);
export const mockChildNode = node(
  PROFILE_CHILD_ID,
  PROFILE_ROOT_ID,
  'subagent',
  'worker',
  '2026-09-01T10:05:00.000Z',
  '2026-09-01T10:15:00.000Z',
);

const CAUSAL_COUNTS: Record<CausalStatus, number> = {
  linked: 1,
  'missing-call-id': 0,
  'call-not-found': 0,
  ambiguous: 0,
  inconsistent: 0,
  unresolved: 0,
};

function spawnsResponse(scope: Scope): SessionProfileSpawns {
  const nodes = scope === 'own' ? [mockRootNode] : [mockRootNode, mockChildNode];
  const items: SessionProfileSpawns['items'] = [
    {
      parent: mockRootNode,
      child: mockChildNode,
      childInScope: scope === 'tree',
      callId: 'call-1',
      causalStatus: 'linked',
      callAt: '2026-09-01T10:05:00.000Z',
    },
  ];
  const response: ProfileSpawnsResponse & { view: 'spawns' } = {
    view: 'spawns',
    sessionId: PROFILE_ROOT_ID,
    scope,
    nodes,
    items,
    total: items.length,
    limit: 50,
    offset: 0,
    counts: { ...CAUSAL_COUNTS },
    orphanSessionCount: 0,
    spawns: items,
  };
  return response;
}

function signalsResponse(scope: Scope): SessionProfileSignals {
  return {
    view: 'signals',
    sessionId: PROFILE_ROOT_ID,
    scope,
    compactions: { auto: 2, manual: 1, unknown: 1 },
    modelChanges: 1,
    toolCalls: { total: 6, mcp: 2 },
    mcpServers: ['plugin_engram_engram'],
    skillCalls: 1,
    skillNames: ['skill-doctor'],
  };
}

const TIMELINE_SERIES: readonly UsageSeries[] = [
  {
    model: 'claude-sonnet-5',
    totals: {
      uncachedInput: 900,
      cachedInput: 200,
      cacheWrite: 40,
      output: 700,
      reasoningOutput: 80,
    },
    callsWithField: {
      uncachedInput: 2,
      cachedInput: 2,
      cacheWrite: 2,
      output: 2,
      reasoningOutput: 2,
    },
    callCount: 2,
  },
  {
    model: 'unknown',
    totals: { uncachedInput: 100, cachedInput: 0, cacheWrite: 0, output: 50, reasoningOutput: 0 },
    callsWithField: {
      uncachedInput: 1,
      cachedInput: 0,
      cacheWrite: 0,
      output: 1,
      reasoningOutput: 0,
    },
    callCount: 1,
  },
];

function timelineResponse(scope: Scope, field: TokenField): SessionProfileTimeline {
  return {
    view: 'timeline',
    sessionId: PROFILE_ROOT_ID,
    scope,
    field,
    series: TIMELINE_SERIES,
    points: [
      {
        at: '2026-09-01T10:01:00.000Z',
        delta: [400, 50],
        cumulative: [400, 50],
        totalDelta: 450,
        totalCumulative: 450,
      },
      {
        at: '2026-09-01T10:10:00.000Z',
        delta: [300, null],
        cumulative: [700, 50],
        totalDelta: 300,
        totalCumulative: 750,
      },
    ],
    spawns: [
      { at: '2026-09-01T10:05:00.000Z', parentId: PROFILE_ROOT_ID, childId: PROFILE_CHILD_ID },
    ],
    excludedNullAtCount: 3,
    timeDomain: { start: '2026-09-01T10:01:00.000Z', end: '2026-09-01T10:10:00.000Z' },
  };
}

const MERGED_ITEMS: readonly Event[] = [
  {
    streamId: PROFILE_ROOT_ID,
    sessionId: PROFILE_ROOT_ID,
    seq: 1,
    at: '2026-09-01T10:00:00.000Z',
    error: null,
    kind: 'compaction',
    trigger: 'auto',
    action: 'compaction',
    subject: 'auto',
  },
  {
    streamId: PROFILE_CHILD_ID,
    sessionId: PROFILE_CHILD_ID,
    seq: 1,
    at: '2026-09-01T10:06:00.000Z',
    error: null,
    kind: 'tool',
    category: 'mcp',
    toolName: 'mcp__plugin_engram_engram__mem_save',
    model: 'claude-sonnet-5',
    action: 'mcp',
    subject: 'mcp__plugin_engram_engram__mem_save',
  },
  {
    streamId: PROFILE_ROOT_ID,
    sessionId: PROFILE_ROOT_ID,
    seq: 2,
    at: '2026-09-01T10:12:00.000Z',
    error: true,
    kind: 'tool',
    category: 'exec',
    toolName: 'bash',
    model: null,
    action: 'exec',
    subject: 'bash',
  },
];

export type MergedEventsParams = {
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
};

function eventModel(item: Event): string | null {
  return item.kind === 'call' || item.kind === 'tool' ? item.model : null;
}

function compareNullable(a: string | number | null, b: string | number | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

/** In-memory mirror of the server's SQL filter/sort, for MSW only. */
function mergedEventsResponse(params: MergedEventsParams): SessionProfileMergedEvents {
  const { scope, sort = 'time', dir = 'asc', limit = 50, offset = 0 } = params;
  let items =
    scope === 'own'
      ? MERGED_ITEMS.filter((item) => item.sessionId === PROFILE_ROOT_ID)
      : [...MERGED_ITEMS];

  if (params.kind && params.kind.length > 0) {
    items = items.filter((item) => params.kind?.includes(item.kind));
  }
  if (params.action && params.action.length > 0) {
    items = items.filter((item) => params.action?.includes(item.action));
  }
  if (params.status === 'error') items = items.filter((item) => item.error === true);
  else if (params.status === 'ok') items = items.filter((item) => item.error !== true);
  if (params.model !== undefined) {
    items = items.filter((item) => eventModel(item) === params.model);
  }
  if (params.q !== undefined) {
    const needle = params.q.toLowerCase();
    items = items.filter(
      (item) =>
        item.action.toLowerCase().includes(needle) ||
        (item.subject ?? '').toLowerCase().includes(needle) ||
        (eventModel(item) ?? '').toLowerCase().includes(needle),
    );
  }

  const direction = dir === 'desc' ? -1 : 1;
  const key = (item: Event): string | number | null => {
    switch (sort) {
      case 'time':
        return item.at;
      case 'agent':
        return item.streamId;
      case 'kind':
        return item.kind;
      case 'action':
        return item.action;
      case 'subject':
        return item.subject;
      case 'model':
        return eventModel(item);
      case 'status':
        return item.error === true ? 1 : 0;
    }
  };
  items.sort((a, b) => {
    const primary = compareNullable(key(a), key(b)) * direction;
    if (primary !== 0) return primary;
    return (
      compareNullable(a.at, b.at) * direction ||
      a.streamId.localeCompare(b.streamId) ||
      a.seq - b.seq
    );
  });

  const total = items.length;
  const page = items.slice(offset, offset + limit);
  const nodes =
    scope === 'own'
      ? [{ id: mockRootNode.id, agentType: mockRootNode.agentType }]
      : [
          { id: mockRootNode.id, agentType: mockRootNode.agentType },
          { id: mockChildNode.id, agentType: mockChildNode.agentType },
        ];
  return {
    view: 'merged',
    sessionId: PROFILE_ROOT_ID,
    scope,
    sort,
    dir,
    nodes,
    items: page,
    total,
    limit,
    offset,
    excludedNullAtCount: 2,
  };
}

/** Own group = the root session's own call steps (dominant model + one
 * share-0 entry); descendants group = the child session's different mix. */
function modelsResponse(): SessionProfileModels {
  return {
    view: 'models',
    sessionId: PROFILE_ROOT_ID,
    session: {
      outputTokens: 1000,
      models: [
        { model: 'claude-sonnet-5', outputTokens: 900, share: 0.9 },
        { model: 'claude-haiku-4', outputTokens: 0, share: 0 },
      ],
    },
    descendants: {
      outputTokens: 400,
      models: [
        { model: 'claude-opus-4', outputTokens: 300, share: 0.75 },
        { model: 'claude-haiku-4', outputTokens: 100, share: 0.25 },
      ],
    },
  };
}

/**
 * Context pressure fixture: the root keeps 4 observable calls, its direct child
 * 3, and a depth-2 grandchild 2 (an own-only row, with absent metadata rendered
 * as null so the table's em-dash/fallback paths are exercised).
 */
function contextResponse(): SessionProfileContext {
  return {
    view: 'context',
    sessionId: PROFILE_ROOT_ID,
    own: {
      observedCalls: 4,
      promptInput: 4000,
      avgPromptInput: 1000,
      p95PromptInput: 1200,
      peakPromptInput: 1500,
      cacheReadShare: 0.25,
    },
    tree: {
      observedCalls: 9,
      promptInput: 9000,
      avgPromptInput: 1000,
      p95PromptInput: 1500,
      peakPromptInput: 2000,
      cacheReadShare: 0.3,
    },
    descendants: [
      {
        id: PROFILE_CHILD_ID,
        parentId: PROFILE_ROOT_ID,
        relativeDepth: 1,
        agentType: 'worker',
        startedAt: '2026-09-01T10:05:00.000Z',
        durationMs: 600000,
        modelPrimary: 'claude-sonnet-5',
        costUsd: 0.12,
        metrics: {
          observedCalls: 3,
          promptInput: 3000,
          avgPromptInput: 1000,
          p95PromptInput: 1200,
          peakPromptInput: 1400,
          cacheReadShare: 0.2,
        },
      },
      {
        id: PROFILE_GRANDCHILD_ID,
        parentId: PROFILE_CHILD_ID,
        relativeDepth: 2,
        agentType: null,
        startedAt: '2026-09-01T10:07:00.000Z',
        durationMs: 120000,
        modelPrimary: null,
        costUsd: null,
        metrics: {
          observedCalls: 2,
          promptInput: 2000,
          avgPromptInput: 1000,
          p95PromptInput: 1100,
          peakPromptInput: 1100,
          cacheReadShare: 0.4,
        },
      },
    ],
  };
}

function isTokenField(value: string | null): value is TokenField {
  return (
    value === 'uncachedInput' ||
    value === 'cachedInput' ||
    value === 'cacheWrite' ||
    value === 'output' ||
    value === 'reasoningOutput'
  );
}

function csvParam(value: string | null): string[] | undefined {
  if (value === null || value.trim() === '') return undefined;
  return value.split(',').map((segment) => segment.trim());
}

function isEventSortField(value: string | null): value is EventSortField {
  return (
    value === 'time' ||
    value === 'agent' ||
    value === 'kind' ||
    value === 'action' ||
    value === 'subject' ||
    value === 'model' ||
    value === 'status'
  );
}

/** MSW handlers for the distinct session-scoped profile endpoints. */
export const sessionProfileHandlers = [
  http.get('/api/sessions/:id/profile/spawns', ({ request }) => {
    try {
      const scope: Scope =
        new URL(request.url).searchParams.get('scope') === 'own' ? 'own' : 'tree';
      return HttpResponse.json(spawnsResponse(scope));
    } catch {
      return HttpResponse.json({ error: 'invalid request' }, { status: 400 });
    }
  }),
  http.get('/api/sessions/:id/profile/signals', ({ request }) => {
    try {
      const scope: Scope =
        new URL(request.url).searchParams.get('scope') === 'own' ? 'own' : 'tree';
      return HttpResponse.json(signalsResponse(scope));
    } catch {
      return HttpResponse.json({ error: 'invalid request' }, { status: 400 });
    }
  }),
  http.get('/api/sessions/:id/profile/timeline', ({ request }) => {
    try {
      const url = new URL(request.url);
      const scope: Scope = url.searchParams.get('scope') === 'own' ? 'own' : 'tree';
      const fieldParam = url.searchParams.get('field');
      const field: TokenField = isTokenField(fieldParam) ? fieldParam : 'output';
      return HttpResponse.json(timelineResponse(scope, field));
    } catch {
      return HttpResponse.json({ error: 'invalid request' }, { status: 400 });
    }
  }),
  http.get('/api/sessions/:id/profile/events', ({ request }) => {
    try {
      const url = new URL(request.url);
      const scope: Scope = url.searchParams.get('scope') === 'own' ? 'own' : 'tree';
      const sortParam = url.searchParams.get('sort');
      const sort: EventSortField = isEventSortField(sortParam) ? sortParam : 'time';
      const dir: SortDirection = url.searchParams.get('dir') === 'desc' ? 'desc' : 'asc';
      const statusParam = url.searchParams.get('status');
      const status: EventStatus | undefined =
        statusParam === 'ok' || statusParam === 'error' ? statusParam : undefined;
      const limit = Number(url.searchParams.get('limit') ?? '50');
      const offset = Number(url.searchParams.get('offset') ?? '0');
      return HttpResponse.json(
        mergedEventsResponse({
          scope,
          sort,
          dir,
          kind: csvParam(url.searchParams.get('kind')) as EventKind[] | undefined,
          action: csvParam(url.searchParams.get('action')) as EventAction[] | undefined,
          status,
          model: url.searchParams.get('model') ?? undefined,
          q: url.searchParams.get('q') ?? undefined,
          limit,
          offset,
        }),
      );
    } catch {
      return HttpResponse.json({ error: 'invalid request' }, { status: 400 });
    }
  }),
  http.get('/api/sessions/:id/profile/models', () => {
    try {
      return HttpResponse.json(modelsResponse());
    } catch {
      return HttpResponse.json({ error: 'invalid request' }, { status: 400 });
    }
  }),
  http.get('/api/sessions/:id/profile/context', () => {
    try {
      return HttpResponse.json(contextResponse());
    } catch {
      return HttpResponse.json({ error: 'invalid request' }, { status: 400 });
    }
  }),
];

/** Convenience accessors used by the route and the leaf components in tests. */
export const mockProfileSpawnsTree = spawnsResponse('tree');
export const mockProfileSpawnsOwn = spawnsResponse('own');
export const mockProfileSignalsTree = signalsResponse('tree');
export const mockProfileTimelineTree = timelineResponse('tree', 'output');
export const mockProfileMergedEventsTree = mergedEventsResponse({ scope: 'tree' });
export const mockProfileModelsTree = modelsResponse();
export const mockProfileContextTree = contextResponse();
