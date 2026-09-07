import type { ApiSessionSummary } from '@scout/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataTable } from '@/components/data-table';

// Regression test for the f4 verify-time break: DataTable seeded its own
// `data` state via `useState(() => initialData)` -- a lazy initializer that
// only runs on first mount. When the `data` prop changed on a re-render (e.g.
// a TanStack Query refetch swapping in a fresh ApiSessionSummary[]),
// DataTable silently kept rendering the stale first-render rows instead of
// picking up the new prop. Fixed via a useEffect that re-syncs local state
// whenever the `data` prop's reference changes.

const sessionA: ApiSessionSummary = {
  id: 'a',
  name: 'Session A',
  title: 'Session A',
  parentId: null,
  harness: { id: 'h', displayName: 'H', adapterVersion: '1' },
  project: null,
  depth: 0,
  relation: null,
  agentType: null,
  startedAt: null,
  endedAt: null,
  durationMs: null,
  modelPrimary: null,
  modelsOwn: [],
  modelsDescendants: [],
  tokensOwn: { uncachedInput: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoningOutput: 0 },
  tokensInclusive: {
    uncachedInput: 0,
    cachedInput: 0,
    cacheWrite: 0,
    output: 0,
    reasoningOutput: 0,
  },
  turnsOwn: 0,
  apiCallsOwn: 0,
  apiCallsInclusive: 0,
  toolCallsOwn: 0,
  toolCallsInclusive: 0,
  compactionsOwn: 0,
  compactionsInclusive: 0,
  costUsd: null,
  childCount: 0,
  descendantCount: 0,
};

const sessionB: ApiSessionSummary = { ...sessionA, id: 'b', name: 'Session B', title: 'Session B' };

describe('DataTable prop-sync', () => {
  it('updates its rendered rows when the `data` prop changes after a refetch', () => {
    const { rerender } = render(<DataTable data={[sessionA]} />);
    expect(screen.getByText('Session A')).toBeInTheDocument();

    // Simulate a TanStack Query refetch replacing the whole items array (new
    // object identity, as a real refetch would produce).
    rerender(<DataTable data={[sessionB]} />);

    expect(screen.queryByText('Session B')).toBeInTheDocument();
    expect(screen.queryByText('Session A')).not.toBeInTheDocument();
  });
});
