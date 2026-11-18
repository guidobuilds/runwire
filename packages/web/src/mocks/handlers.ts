import type {
  ApiHarnessOption,
  ApiSessionDetail,
  ApiSessionSummary,
  ApiSessionsStats,
  ImportReport,
  PagedSessions,
} from '@runwire/core';
import { HttpResponse, http } from 'msw';
import long from '@/components/agent-lanes/fixtures/long.json';
import nested from '@/components/agent-lanes/fixtures/nested.json';
import short from '@/components/agent-lanes/fixtures/short.json';
import tree3 from '@/components/agent-lanes/fixtures/tree3.json';
import tree17 from '@/components/agent-lanes/fixtures/tree17.json';
import { sessionProfileHandlers } from './session-profile';

const lanesFixtures = { short, long, nested, tree3, tree17, 'sess-1': short };

const tokenTotals = {
  uncachedInput: 1200,
  cachedInput: 300,
  cacheWrite: 50,
  output: 800,
  reasoningOutput: 100,
};

export const mockSessionSummary: ApiSessionSummary = {
  id: 'sess-1',
  name: 'Refactor auth module',
  title: 'Refactor auth module',
  parentId: null,
  harness: { id: 'claude-code', displayName: 'Claude Code', adapterVersion: '1.0.0' },
  project: { key: 'runwire', name: 'Runwire' },
  depth: 0,
  relation: null,
  agentType: null,
  startedAt: '2026-09-01T10:00:00.000Z',
  endedAt: '2026-09-01T10:30:00.000Z',
  lastActivity: '2026-09-01T10:30:00.000Z',
  durationMs: 1_800_000,
  modelPrimary: 'claude-sonnet-5',
  modelsOwn: ['claude-sonnet-5'],
  modelsDescendants: [],
  tokensOwn: tokenTotals,
  tokensInclusive: tokenTotals,
  turnsOwn: 12,
  apiCallsOwn: 12,
  apiCallsInclusive: 12,
  toolCallsOwn: 5,
  toolCallsInclusive: 5,
  compactionsOwn: 0,
  compactionsInclusive: 0,
  costUsd: 0.42,
  childCount: 1,
  descendantCount: 1,
  subagentChildCount: 4,
  subagentDescendantCount: 11,
};

export const mockChildSummary: ApiSessionSummary = {
  ...mockSessionSummary,
  id: 'sess-1-child',
  name: 'Subagent: write tests',
  title: 'Subagent: write tests',
  parentId: 'sess-1',
  depth: 1,
  relation: 'subagent',
  childCount: 0,
  descendantCount: 0,
  subagentChildCount: 0,
  subagentDescendantCount: 0,
};

export const mockPagedSessions: PagedSessions = {
  items: [mockSessionSummary],
  total: 1,
  limit: 50,
  offset: 0,
};

export const mockSessionSummary2: ApiSessionSummary = {
  ...mockSessionSummary,
  id: 'sess-2',
  name: 'Fix flaky test',
  title: 'Fix flaky test',
  startedAt: '2026-09-02T08:00:00.000Z',
  endedAt: '2026-09-02T08:15:00.000Z',
  lastActivity: '2026-09-02T08:15:00.000Z',
  durationMs: 900_000,
  costUsd: 0.18,
  childCount: 0,
  descendantCount: 0,
  subagentChildCount: 0,
  subagentDescendantCount: 0,
};

export const mockPagedSessionsMulti: PagedSessions = {
  items: [mockSessionSummary, mockSessionSummary2],
  total: 2,
  limit: 50,
  offset: 0,
};

export const mockSessionsStats: ApiSessionsStats = {
  totalSessions: 1,
  totalCostUsd: 0.42,
  totalTokens: 2450,
  avgDurationMs: 1_800_000,
  series: [{ date: '2026-09-01', sessions: 1 }],
};

export const mockSessionsStatsMulti: ApiSessionsStats = {
  totalSessions: 2,
  totalCostUsd: 0.6,
  totalTokens: 4900,
  avgDurationMs: 1_350_000,
  series: [
    { date: '2026-09-01', sessions: 1 },
    { date: '2026-09-02', sessions: 1 },
  ],
};

export const mockSessionDetail: ApiSessionDetail = {
  ...mockSessionSummary,
  parent: null,
  children: [mockChildSummary],
};

export const mockHarnessOptions: ApiHarnessOption[] = [
  { id: 'claude-code', displayName: 'Claude Code' },
];

export const mockImportReport: ImportReport = {
  perAdapter: {
    'claude-code': { discovered: 3, imported: 2, skipped: 1, removed: 0, failed: 0 },
    opencode: { discovered: 1, imported: 1, skipped: 0, removed: 0, failed: 0 },
  },
  durationMs: 42,
};

export const handlers = [
  http.get('/api/sessions', () => HttpResponse.json(mockPagedSessions)),
  http.get('/api/sessions/stats', () => HttpResponse.json(mockSessionsStats)),
  http.get('/api/harnesses', () => HttpResponse.json(mockHarnessOptions)),
  http.post('/api/scan', () => HttpResponse.json(mockImportReport)),
  http.get('/api/sessions/:id', ({ params }) => {
    if (params.id !== mockSessionDetail.id) {
      return HttpResponse.json({ error: 'session not found' }, { status: 404 });
    }
    return HttpResponse.json({ session: mockSessionDetail });
  }),
  http.get('/api/sessions/:id/profile/lanes', ({ params, request }) => {
    const fixture = lanesFixtures[String(params.id) as keyof typeof lanesFixtures];
    if (!fixture) return HttpResponse.json({ error: 'session not found' }, { status: 404 });
    const scope = new URL(request.url).searchParams.get('scope') ?? 'tree';
    if (scope !== 'own' && scope !== 'tree') {
      return HttpResponse.json({ error: 'invalid scope' }, { status: 400 });
    }
    const agents = scope === 'own' ? fixture.agents.slice(0, 1) : fixture.agents;
    return HttpResponse.json({
      ...fixture,
      sessionId: params.id,
      scope,
      agents,
      callCount: agents.reduce((n, agent) => n + agent.calls.seq.length, 0),
    });
  }),
  ...sessionProfileHandlers,
];
