import type { ApiSessionDetail, ApiSessionSummary, PagedSessions } from '@scout/core';
import { HttpResponse, http } from 'msw';
import { sessionProfileHandlers } from './session-profile';

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
  project: { key: 'scout', name: 'Scout' },
  depth: 0,
  relation: null,
  agentType: null,
  startedAt: '2026-09-01T10:00:00.000Z',
  endedAt: '2026-09-01T10:30:00.000Z',
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
};

export const mockPagedSessions: PagedSessions = {
  items: [mockSessionSummary],
  total: 1,
  limit: 50,
  offset: 0,
};

/** A second root session, used only by dashboard-composition tests (f4) that
 * need more than one row to exercise aggregate metrics/columns meaningfully.
 * Kept separate from `mockPagedSessions` so f3's exact-shape contract tests
 * (which assert on the single-item list) are unaffected. */
export const mockSessionSummary2: ApiSessionSummary = {
  ...mockSessionSummary,
  id: 'sess-2',
  name: 'Fix flaky test',
  title: 'Fix flaky test',
  startedAt: '2026-09-02T08:00:00.000Z',
  endedAt: '2026-09-02T08:15:00.000Z',
  durationMs: 900_000,
  costUsd: 0.18,
  childCount: 0,
  descendantCount: 0,
};

export const mockPagedSessionsMulti: PagedSessions = {
  items: [mockSessionSummary, mockSessionSummary2],
  total: 2,
  limit: 50,
  offset: 0,
};

export const mockSessionDetail: ApiSessionDetail = {
  ...mockSessionSummary,
  parent: null,
  children: [mockChildSummary],
};

export const handlers = [
  http.get('/sessions', () => HttpResponse.json(mockPagedSessions)),
  http.get('/sessions/:id', ({ params }) => {
    if (params.id !== mockSessionDetail.id) {
      return HttpResponse.json({ error: 'session not found' }, { status: 404 });
    }
    return HttpResponse.json({ session: mockSessionDetail });
  }),
  ...sessionProfileHandlers,
];
