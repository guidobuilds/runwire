import type {
  CausalStatus,
  Event,
  EventFilter,
  ProfileNode,
  ProfileSpawnsResponse,
  Scope,
  TokenField,
  UsageSeries,
} from '@scout/core';
import { HttpResponse, http } from 'msw';
import type {
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

const MERGED_EVENT_FILTERS: readonly EventFilter[] = [
  'signals',
  'relevant',
  'all',
  'mcp',
  'skill',
  'hook',
  'read',
  'write',
  'exec',
  'agent',
  'error',
];

const MERGED_ITEMS: readonly Event[] = [
  {
    streamId: PROFILE_ROOT_ID,
    sessionId: PROFILE_ROOT_ID,
    seq: 1,
    at: '2026-09-01T10:00:00.000Z',
    error: null,
    kind: 'compaction',
    trigger: 'auto',
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
  },
];

function mergedEventsResponse(
  scope: Scope,
  filter: EventFilter,
  limit: number,
  offset: number,
): SessionProfileMergedEvents {
  const scoped =
    scope === 'own'
      ? MERGED_ITEMS.filter((item) => item.sessionId === PROFILE_ROOT_ID)
      : MERGED_ITEMS;
  const filtered =
    filter === 'all'
      ? scoped
      : filter === 'signals' || filter === 'relevant'
        ? scoped.filter(
            (item) =>
              item.kind === 'compaction' || (item.kind === 'tool' && item.category === 'mcp'),
          )
        : filter === 'error'
          ? scoped.filter((item) => item.error === true)
          : scoped.filter((item) => item.kind === 'tool' && item.category === filter);
  const page = filtered.slice(offset, offset + limit);
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
    filter,
    nodes,
    items: page,
    total: filtered.length,
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

function isTokenField(value: string | null): value is TokenField {
  return (
    value === 'uncachedInput' ||
    value === 'cachedInput' ||
    value === 'cacheWrite' ||
    value === 'output' ||
    value === 'reasoningOutput'
  );
}

function isEventFilter(value: string | null): value is EventFilter {
  return MERGED_EVENT_FILTERS.includes(value as EventFilter);
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
      const filterParam = url.searchParams.get('filter');
      const filter: EventFilter = isEventFilter(filterParam) ? filterParam : 'signals';
      const limit = Number(url.searchParams.get('limit') ?? '50');
      const offset = Number(url.searchParams.get('offset') ?? '0');
      return HttpResponse.json(mergedEventsResponse(scope, filter, limit, offset));
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
];

/** Convenience accessors used by the route and the leaf components in tests. */
export const mockProfileSpawnsTree = spawnsResponse('tree');
export const mockProfileSpawnsOwn = spawnsResponse('own');
export const mockProfileSignalsTree = signalsResponse('tree');
export const mockProfileTimelineTree = timelineResponse('tree', 'output');
export const mockProfileMergedEventsTree = mergedEventsResponse('tree', 'signals', 50, 0);
export const mockProfileModelsTree = modelsResponse();
