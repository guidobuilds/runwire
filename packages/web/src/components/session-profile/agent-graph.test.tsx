import type { Event, ProfileNode, ProfileSpawnsResponse, SpawnItem } from '@scout/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionProfileMergedEvents } from '@/lib/api/session-profile';
import { server } from '@/mocks/node';
import { AgentGraph, type AgentGraphRootSession } from './agent-graph';

// Exercises the real, composed MSW `handlers` array (registered globally in
// src/test/setup.ts via `@/mocks/node`) — see verification.md#f3 finding F-5.

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {children}
    </QueryClientProvider>
  );
}

afterEach(() => vi.restoreAllMocks());

const ROOT: AgentGraphRootSession = {
  id: 'root-1',
  startedAt: '2026-09-01T10:00:00.000Z',
  endedAt: '2026-09-01T10:30:00.000Z',
  agentType: 'main',
};

function node(
  id: string,
  parentId: string | null,
  agentType: string,
  startedAt: string | null,
  endedAt: string | null,
): ProfileNode {
  return { id, parentId, relation: parentId ? 'subagent' : null, agentType, startedAt, endedAt };
}

const ROOT_NODE = node(ROOT.id, null, 'main', ROOT.startedAt, ROOT.endedAt);
const CHILD_A = node(
  'root-1/child-a',
  ROOT.id,
  'worker',
  '2026-09-01T10:05:00.000Z',
  '2026-09-01T10:15:00.000Z',
);
const CHILD_B = node('root-1/child-b', ROOT.id, 'reviewer', '2026-09-01T10:20:00.000Z', null);

function spawnItem(
  child: ProfileNode | null,
  causalStatus: SpawnItem['causalStatus'],
  callAt: string | null,
): SpawnItem {
  return {
    parent: ROOT_NODE,
    child,
    childInScope: true,
    callId: callAt ? 'call-1' : null,
    causalStatus,
    callAt,
  };
}

const ITEM_A = spawnItem(CHILD_A, 'linked', '2026-09-01T10:04:30.000Z');
const ITEM_B = spawnItem(CHILD_B, 'missing-call-id', null);

/** A SpawnItem edge with an explicit (not-hardcoded-to-root) parent — used
 * by the depth-2/scale fixtures below (f4-t2 repair, verification.md#f4
 * F-10). */
function spawnEdge(
  parent: ProfileNode,
  child: ProfileNode | null,
  causalStatus: SpawnItem['causalStatus'],
  callAt: string | null,
): SpawnItem {
  return {
    parent,
    child,
    childInScope: true,
    callId: callAt ? 'call-x' : null,
    causalStatus,
    callAt,
  };
}

function spawnsPage(offset: number): ProfileSpawnsResponse & { view: 'spawns' } {
  const items = offset === 0 ? [ITEM_A] : [ITEM_B];
  return {
    view: 'spawns',
    sessionId: ROOT.id,
    scope: 'tree',
    nodes: [ROOT_NODE, CHILD_A, CHILD_B],
    items,
    total: 2,
    limit: 1,
    offset,
    counts: {
      linked: offset === 0 ? 1 : 0,
      'missing-call-id': offset === 0 ? 0 : 1,
      'call-not-found': 0,
      ambiguous: 0,
      inconsistent: 0,
      unresolved: 0,
    },
    orphanSessionCount: 0,
    spawns: items,
  };
}

function singleNodeSpawnsPage(): ProfileSpawnsResponse & { view: 'spawns' } {
  return {
    view: 'spawns',
    sessionId: ROOT.id,
    scope: 'tree',
    nodes: [ROOT_NODE],
    items: [],
    total: 0,
    limit: 50,
    offset: 0,
    counts: {
      linked: 0,
      'missing-call-id': 0,
      'call-not-found': 0,
      ambiguous: 0,
      inconsistent: 0,
      unresolved: 0,
    },
    orphanSessionCount: 0,
    spawns: [],
  };
}

const SIGNAL_EVENTS: readonly Event[] = [
  {
    streamId: ROOT.id,
    sessionId: ROOT.id,
    seq: 1,
    at: '2026-09-01T10:02:00.000Z',
    error: null,
    kind: 'compaction',
    trigger: 'auto',
  },
  {
    streamId: CHILD_A.id,
    sessionId: CHILD_A.id,
    seq: 1,
    at: '2026-09-01T10:06:00.000Z',
    error: null,
    kind: 'tool',
    category: 'mcp',
    toolName: 'mcp__plugin_engram_engram__mem_save',
  },
  {
    streamId: ROOT.id,
    sessionId: ROOT.id,
    seq: 2,
    at: '2026-09-01T10:25:00.000Z',
    error: true,
    kind: 'tool',
    category: 'exec',
    toolName: 'bash',
  },
];

function mergedEventsResponse(total = SIGNAL_EVENTS.length): SessionProfileMergedEvents {
  return {
    view: 'merged',
    sessionId: ROOT.id,
    scope: 'tree',
    filter: 'signals',
    items: SIGNAL_EVENTS,
    total,
    limit: 200,
    offset: 0,
    excludedNullAtCount: 1,
  };
}

function installHandlers(
  options: {
    spawns?: (offset: number) => ProfileSpawnsResponse & { view: 'spawns' };
    merged?: SessionProfileMergedEvents;
    spawnsError?: boolean;
  } = {},
) {
  const spawnsFor = options.spawns ?? spawnsPage;
  server.use(
    http.get('/api/session-profiles/:id', ({ request }) => {
      const url = new URL(request.url);
      const view = url.searchParams.get('view');
      if (view === 'spawns') {
        if (options.spawnsError) return HttpResponse.json({ error: 'boom' }, { status: 500 });
        const offset = Number(url.searchParams.get('offset') ?? '0');
        return HttpResponse.json(spawnsFor(offset));
      }
      if (view === 'merged') {
        return HttpResponse.json(options.merged ?? mergedEventsResponse());
      }
      return undefined;
    }),
  );
}

describe('AgentGraph — rows and connectors', () => {
  it('renders one row per node, root first, exhausting every spawns page', async () => {
    installHandlers();
    const { container } = render(
      <AgentGraph onOpenNode={() => {}} rootSession={ROOT} sessionId={ROOT.id} />,
      { wrapper },
    );
    await waitFor(() => {
      expect(container.querySelectorAll('rect[data-row-id]').length).toBe(3);
    });
    const rects = container.querySelectorAll('rect[data-row-id]');
    expect(rects[0]?.getAttribute('data-row-id')).toBe(ROOT.id);
  });

  it('draws a connector only for the linked child, and none for the unlinked one', async () => {
    installHandlers();
    const { container } = render(
      <AgentGraph onOpenNode={() => {}} rootSession={ROOT} sessionId={ROOT.id} />,
      { wrapper },
    );
    await waitFor(() => {
      expect(container.querySelectorAll('rect[data-row-id]').length).toBe(3);
    });
    const connectors = container.querySelectorAll('.agent-graph-connector');
    expect(connectors.length).toBe(1);
    expect(connectors[0]?.getAttribute('data-child-id')).toBe(CHILD_A.id);
    expect(
      container.querySelector(`.agent-graph-connector[data-child-id="${CHILD_B.id}"]`),
    ).toBeNull();
    // the unlinked child still gets its own row
    expect(container.querySelector(`rect[data-row-id="${CHILD_B.id}"]`)).not.toBeNull();
  });

  it('renders an open-ended bar for a row with a null endedAt', async () => {
    installHandlers();
    const { container } = render(
      <AgentGraph onOpenNode={() => {}} rootSession={ROOT} sessionId={ROOT.id} />,
      { wrapper },
    );
    await waitFor(() => {
      const bar = container.querySelector(`rect[data-row-id="${CHILD_B.id}"]`);
      expect(bar?.getAttribute('data-open-ended')).toBe('true');
    });
    const rootBar = container.querySelector(`rect[data-row-id="${ROOT.id}"]`);
    expect(rootBar?.getAttribute('data-open-ended')).toBe('false');
  });

  it('calls onOpenNode when a row bar is clicked', async () => {
    installHandlers();
    const onOpenNode = vi.fn();
    const { container } = render(
      <AgentGraph onOpenNode={onOpenNode} rootSession={ROOT} sessionId={ROOT.id} />,
      { wrapper },
    );
    await waitFor(() => {
      expect(container.querySelector(`rect[data-row-id="${CHILD_A.id}"]`)).not.toBeNull();
    });
    const bar = container.querySelector(`rect[data-row-id="${CHILD_A.id}"]`) as SVGRectElement;
    fireEvent.click(bar);
    expect(onOpenNode).toHaveBeenCalledWith(CHILD_A.id);
  });
});

describe('AgentGraph — signal markers', () => {
  it('renders one marker per signal event with a non-null at', async () => {
    installHandlers();
    const { container } = render(
      <AgentGraph onOpenNode={() => {}} rootSession={ROOT} sessionId={ROOT.id} />,
      { wrapper },
    );
    await waitFor(() => {
      expect(container.querySelectorAll('.agent-graph-marker').length).toBe(SIGNAL_EVENTS.length);
    });
  });

  it('shows metadata-only marker titles (kind, detail, timestamp — never free text)', async () => {
    installHandlers();
    const { container } = render(
      <AgentGraph onOpenNode={() => {}} rootSession={ROOT} sessionId={ROOT.id} />,
      { wrapper },
    );
    await waitFor(() => {
      expect(container.querySelectorAll('.agent-graph-marker').length).toBe(SIGNAL_EVENTS.length);
    });
    const titles = Array.from(container.querySelectorAll('.agent-graph-marker title')).map(
      (title) => title.textContent,
    );
    expect(titles).toContain('Compaction — trigger: auto — 2026-09-01T10:02:00.000Z');
    expect(titles).toContain(
      'MCP call — mcp__plugin_engram_engram__mem_save — 2026-09-01T10:06:00.000Z',
    );
    expect(titles).toContain('Error — bash — 2026-09-01T10:25:00.000Z');
  });

  it('notes when only the first page of signals is shown', async () => {
    installHandlers({ merged: mergedEventsResponse(500) });
    render(<AgentGraph onOpenNode={() => {}} rootSession={ROOT} sessionId={ROOT.id} />, {
      wrapper,
    });
    await waitFor(() => {
      expect(screen.getByText('Showing the first 200 signals of 500.')).toBeInTheDocument();
    });
  });
});

describe('AgentGraph — states', () => {
  it('renders a single row and no connectors for a single-node tree', async () => {
    installHandlers({ spawns: () => singleNodeSpawnsPage() });
    const { container } = render(
      <AgentGraph onOpenNode={() => {}} rootSession={ROOT} sessionId={ROOT.id} />,
      { wrapper },
    );
    await waitFor(() => {
      expect(container.querySelectorAll('rect[data-row-id]').length).toBe(1);
    });
    expect(container.querySelectorAll('.agent-graph-connector').length).toBe(0);
  });

  it('shows a Skeleton while loading', () => {
    installHandlers();
    const { container } = render(
      <AgentGraph onOpenNode={() => {}} rootSession={ROOT} sessionId={ROOT.id} />,
      { wrapper },
    );
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  });

  it('shows Retry on error and recovers after a successful refetch', async () => {
    installHandlers({ spawnsError: true });
    render(<AgentGraph onOpenNode={() => {}} rootSession={ROOT} sessionId={ROOT.id} />, {
      wrapper,
    });
    const retry = await screen.findByRole('button', { name: 'Retry' });
    installHandlers();
    retry.click();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    });
  });
});

// f4-t2 repair (verification.md#f4, CONFIRMED break): buildRows previously
// hardcoded `item.parent.id !== rootSession.id`, silently dropping any node
// not a direct child of the root. These fixtures cover a genuine depth-2
// (grandchild) tree — the "OpenCode-style nested spawn" shape the adversary
// used to reproduce the break — plus orphan nodes and a malformed cycle.
describe('AgentGraph — depth-2 and orphan rows (f4-t2 repair)', () => {
  const D_ROOT: AgentGraphRootSession = {
    id: 'd-root',
    startedAt: '2026-09-01T10:00:00.000Z',
    endedAt: '2026-09-01T10:30:00.000Z',
    agentType: 'main',
  };
  const D_ROOT_NODE = node(D_ROOT.id, null, 'main', D_ROOT.startedAt, D_ROOT.endedAt);
  const D_CHILD = node(
    'd-root/child',
    D_ROOT.id,
    'worker',
    '2026-09-01T10:05:00.000Z',
    '2026-09-01T10:20:00.000Z',
  );
  // Linked nested spawn: parent.id is the CHILD's id, not the root's.
  const D_GRANDCHILD_LINKED = node(
    'd-root/child/grandchild-linked',
    D_CHILD.id,
    'nested-worker',
    '2026-09-01T10:08:00.000Z',
    '2026-09-01T10:12:00.000Z',
  );
  // A depth-2 node whose own SpawnItem has callAt: null — still gets a row,
  // never a connector (same causal rule as a direct unlinked child).
  const D_GRANDCHILD_UNLINKED = node(
    'd-root/child/grandchild-unlinked',
    D_CHILD.id,
    'nested-unresolved',
    '2026-09-01T10:09:00.000Z',
    '2026-09-01T10:11:00.000Z',
  );
  // In `nodes` but reachable through no SpawnItem at all.
  const D_ORPHAN = node(
    'd-root/orphan',
    'some-missing-parent',
    'orphan',
    '2026-09-01T10:02:00.000Z',
    '2026-09-01T10:03:00.000Z',
  );

  const ITEM_ROOT_CHILD = spawnEdge(D_ROOT_NODE, D_CHILD, 'linked', '2026-09-01T10:04:30.000Z');
  const ITEM_LINKED_GRANDCHILD = spawnEdge(
    D_CHILD,
    D_GRANDCHILD_LINKED,
    'linked',
    '2026-09-01T10:07:30.000Z',
  );
  const ITEM_UNLINKED_GRANDCHILD = spawnEdge(D_CHILD, D_GRANDCHILD_UNLINKED, 'ambiguous', null);

  function depthSpawnsPage(): ProfileSpawnsResponse & { view: 'spawns' } {
    const items = [ITEM_ROOT_CHILD, ITEM_LINKED_GRANDCHILD, ITEM_UNLINKED_GRANDCHILD];
    return {
      view: 'spawns',
      sessionId: D_ROOT.id,
      scope: 'tree',
      nodes: [D_ROOT_NODE, D_CHILD, D_GRANDCHILD_LINKED, D_GRANDCHILD_UNLINKED, D_ORPHAN],
      items,
      total: items.length,
      limit: 50,
      offset: 0,
      counts: {
        linked: 2,
        'missing-call-id': 0,
        'call-not-found': 0,
        ambiguous: 1,
        inconsistent: 0,
        unresolved: 0,
      },
      orphanSessionCount: 1,
      spawns: items,
    };
  }

  function emptyMerged(sessionId: string): SessionProfileMergedEvents {
    return {
      view: 'merged',
      sessionId,
      scope: 'tree',
      filter: 'signals',
      items: [],
      total: 0,
      limit: 200,
      offset: 0,
      excludedNullAtCount: 0,
    };
  }

  function installDepthHandlers() {
    server.use(
      http.get('/api/session-profiles/:id', ({ request }) => {
        const url = new URL(request.url);
        const view = url.searchParams.get('view');
        if (view === 'spawns') return HttpResponse.json(depthSpawnsPage());
        if (view === 'merged') return HttpResponse.json(emptyMerged(D_ROOT.id));
        return undefined;
      }),
    );
  }

  it('gives a linked depth-2 grandchild its own row and a connector from its parent (the child) row', async () => {
    installDepthHandlers();
    const { container } = render(
      <AgentGraph onOpenNode={() => {}} rootSession={D_ROOT} sessionId={D_ROOT.id} />,
      { wrapper },
    );
    await waitFor(() => {
      expect(
        container.querySelector(`rect[data-row-id="${D_GRANDCHILD_LINKED.id}"]`),
      ).not.toBeNull();
    });
    const connector = container.querySelector(
      `.agent-graph-connector[data-parent-id="${D_CHILD.id}"][data-child-id="${D_GRANDCHILD_LINKED.id}"]`,
    );
    expect(connector).not.toBeNull();
  });

  it('gives an unlinked (callAt: null) depth-2 grandchild its own row and no connector', async () => {
    installDepthHandlers();
    const { container } = render(
      <AgentGraph onOpenNode={() => {}} rootSession={D_ROOT} sessionId={D_ROOT.id} />,
      { wrapper },
    );
    await waitFor(() => {
      expect(
        container.querySelector(`rect[data-row-id="${D_GRANDCHILD_UNLINKED.id}"]`),
      ).not.toBeNull();
    });
    expect(
      container.querySelector(
        `.agent-graph-connector[data-child-id="${D_GRANDCHILD_UNLINKED.id}"]`,
      ),
    ).toBeNull();
  });

  it('gives an orphan node (no SpawnItem at all) its own row and no connector', async () => {
    installDepthHandlers();
    const { container } = render(
      <AgentGraph onOpenNode={() => {}} rootSession={D_ROOT} sessionId={D_ROOT.id} />,
      { wrapper },
    );
    await waitFor(() => {
      expect(container.querySelector(`rect[data-row-id="${D_ORPHAN.id}"]`)).not.toBeNull();
    });
    expect(
      container.querySelector(`.agent-graph-connector[data-child-id="${D_ORPHAN.id}"]`),
    ).toBeNull();
  });

  it('gives every in-scope node exactly one row (rows.length === nodes.length)', async () => {
    installDepthHandlers();
    const { container } = render(
      <AgentGraph onOpenNode={() => {}} rootSession={D_ROOT} sessionId={D_ROOT.id} />,
      { wrapper },
    );
    await waitFor(() => {
      expect(container.querySelectorAll('rect[data-row-id]').length).toBe(5);
    });
  });

  it('terminates on a malformed parent cycle instead of recursing forever', async () => {
    const CYCLE_A = node(
      'cycle-a',
      D_ROOT.id,
      'a',
      '2026-09-01T10:01:00.000Z',
      '2026-09-01T10:02:00.000Z',
    );
    const CYCLE_B = node(
      'cycle-b',
      'cycle-a',
      'b',
      '2026-09-01T10:02:00.000Z',
      '2026-09-01T10:03:00.000Z',
    );
    const rootToA = spawnEdge(D_ROOT_NODE, CYCLE_A, 'linked', '2026-09-01T10:00:30.000Z');
    const aToB = spawnEdge(CYCLE_A, CYCLE_B, 'linked', '2026-09-01T10:01:30.000Z');
    // Malformed: B's SpawnItem also declares A as its own child, forming a
    // cycle. Real data should never do this, but the walk must not hang.
    const bToA = spawnEdge(CYCLE_B, CYCLE_A, 'linked', '2026-09-01T10:02:30.000Z');
    const items = [rootToA, aToB, bToA];
    server.use(
      http.get('/api/session-profiles/:id', ({ request }) => {
        const url = new URL(request.url);
        const view = url.searchParams.get('view');
        if (view === 'spawns') {
          return HttpResponse.json({
            view: 'spawns',
            sessionId: D_ROOT.id,
            scope: 'tree',
            nodes: [D_ROOT_NODE, CYCLE_A, CYCLE_B],
            items,
            total: items.length,
            limit: 50,
            offset: 0,
            counts: {
              linked: 3,
              'missing-call-id': 0,
              'call-not-found': 0,
              ambiguous: 0,
              inconsistent: 0,
              unresolved: 0,
            },
            orphanSessionCount: 0,
            spawns: items,
          });
        }
        if (view === 'merged') return HttpResponse.json(emptyMerged(D_ROOT.id));
        return undefined;
      }),
    );
    const { container } = render(
      <AgentGraph onOpenNode={() => {}} rootSession={D_ROOT} sessionId={D_ROOT.id} />,
      { wrapper },
    );
    await waitFor(() => {
      expect(container.querySelectorAll('rect[data-row-id]').length).toBe(3);
    });
  });
});

// f5-t1 repair (verification.md#f5, CONFIRMED break): the signals
// accordion's "Subagents" count previously came from
// `session.data.children.length` (root's DIRECT children only), undercounting
// any tree with depth >= 2. design.md's fix is for AgentGraph to report the
// whole-tree node count (`nodes.length - 1`, root excluded) once its own
// already-fetched `spawns` pages are complete, via `onNodeCount`.
describe('AgentGraph — onNodeCount (f5-t1 repair)', () => {
  it('calls onNodeCount exactly once with nodes.length - 1 once the full depth-2 tree is loaded', async () => {
    const D_ROOT: AgentGraphRootSession = {
      id: 'n-root',
      startedAt: '2026-09-01T10:00:00.000Z',
      endedAt: '2026-09-01T10:30:00.000Z',
      agentType: 'main',
    };
    const D_ROOT_NODE = node(D_ROOT.id, null, 'main', D_ROOT.startedAt, D_ROOT.endedAt);
    const D_CHILD = node(
      'n-root/child',
      D_ROOT.id,
      'worker',
      '2026-09-01T10:05:00.000Z',
      '2026-09-01T10:20:00.000Z',
    );
    const D_GRANDCHILD = node(
      'n-root/child/grandchild',
      D_CHILD.id,
      'nested-worker',
      '2026-09-01T10:08:00.000Z',
      '2026-09-01T10:12:00.000Z',
    );
    const items = [
      spawnEdge(D_ROOT_NODE, D_CHILD, 'linked', '2026-09-01T10:04:30.000Z'),
      spawnEdge(D_CHILD, D_GRANDCHILD, 'linked', '2026-09-01T10:07:30.000Z'),
    ];
    server.use(
      http.get('/api/session-profiles/:id', ({ request }) => {
        const url = new URL(request.url);
        const view = url.searchParams.get('view');
        if (view === 'spawns') {
          return HttpResponse.json({
            view: 'spawns',
            sessionId: D_ROOT.id,
            scope: 'tree',
            nodes: [D_ROOT_NODE, D_CHILD, D_GRANDCHILD],
            items,
            total: items.length,
            limit: 50,
            offset: 0,
            counts: {
              linked: 2,
              'missing-call-id': 0,
              'call-not-found': 0,
              ambiguous: 0,
              inconsistent: 0,
              unresolved: 0,
            },
            orphanSessionCount: 0,
            spawns: items,
          });
        }
        if (view === 'merged') {
          return HttpResponse.json({
            view: 'merged',
            sessionId: D_ROOT.id,
            scope: 'tree',
            filter: 'signals',
            items: [],
            total: 0,
            limit: 200,
            offset: 0,
            excludedNullAtCount: 0,
          });
        }
        return undefined;
      }),
    );

    const onNodeCount = vi.fn();
    const { container } = render(
      <AgentGraph
        onNodeCount={onNodeCount}
        onOpenNode={() => {}}
        rootSession={D_ROOT}
        sessionId={D_ROOT.id}
      />,
      { wrapper },
    );

    await waitFor(() => {
      expect(container.querySelectorAll('rect[data-row-id]').length).toBe(3);
    });
    await waitFor(() => {
      expect(onNodeCount).toHaveBeenCalledTimes(1);
    });
    // nodes.length (3) - 1 (root) = 2, the whole-tree subagent count — not
    // session.children.length (which would only see 1, the direct child).
    expect(onNodeCount).toHaveBeenCalledWith(2);
  });

  it('does not call onNodeCount while still loading or on error', async () => {
    installHandlers({ spawnsError: true });
    const onNodeCount = vi.fn();
    render(
      <AgentGraph
        onNodeCount={onNodeCount}
        onOpenNode={() => {}}
        rootSession={ROOT}
        sessionId={ROOT.id}
      />,
      { wrapper },
    );

    const retry = await screen.findByRole('button', { name: 'Retry' });
    // Errored: onNodeCount must never fire with a wrong (e.g. 0) count.
    expect(onNodeCount).not.toHaveBeenCalled();

    installHandlers();
    retry.click();
    await waitFor(() => {
      expect(onNodeCount).toHaveBeenCalledTimes(1);
    });
    expect(onNodeCount).toHaveBeenCalledWith(2);
  });
});

// F-11 (verification.md#f4, non-blocking legibility finding): no fixture in
// the committed or adversary suites previously exercised more than 3 rows.
describe('AgentGraph — scale (F-11)', () => {
  const S_ROOT: AgentGraphRootSession = {
    id: 's-root',
    startedAt: '2026-09-01T09:00:00.000Z',
    endedAt: '2026-09-01T11:00:00.000Z',
    agentType: 'main',
  };
  const S_ROOT_NODE = node(S_ROOT.id, null, 'main', S_ROOT.startedAt, S_ROOT.endedAt);
  const S_CHILDREN = Array.from({ length: 24 }, (_, i) =>
    node(
      `s-root/child-${i}`,
      S_ROOT.id,
      `worker-${i}`,
      `2026-09-01T09:${String(i + 1).padStart(2, '0')}:00.000Z`,
      `2026-09-01T09:${String(i + 2).padStart(2, '0')}:00.000Z`,
    ),
  );
  const S_ITEMS = S_CHILDREN.map((child, i) =>
    spawnEdge(S_ROOT_NODE, child, 'linked', `2026-09-01T09:${String(i).padStart(2, '0')}:30.000Z`),
  );

  function scaleSpawnsPage(): ProfileSpawnsResponse & { view: 'spawns' } {
    return {
      view: 'spawns',
      sessionId: S_ROOT.id,
      scope: 'tree',
      nodes: [S_ROOT_NODE, ...S_CHILDREN],
      items: S_ITEMS,
      total: S_ITEMS.length,
      limit: 50,
      offset: 0,
      counts: {
        linked: S_ITEMS.length,
        'missing-call-id': 0,
        'call-not-found': 0,
        ambiguous: 0,
        inconsistent: 0,
        unresolved: 0,
      },
      orphanSessionCount: 0,
      spawns: S_ITEMS,
    };
  }

  it('renders 25 rows with no NaN in the SVG and a bounded, scrollable height', async () => {
    server.use(
      http.get('/api/session-profiles/:id', ({ request }) => {
        const url = new URL(request.url);
        const view = url.searchParams.get('view');
        if (view === 'spawns') return HttpResponse.json(scaleSpawnsPage());
        if (view === 'merged') {
          return HttpResponse.json({
            view: 'merged',
            sessionId: S_ROOT.id,
            scope: 'tree',
            filter: 'signals',
            items: [],
            total: 0,
            limit: 200,
            offset: 0,
            excludedNullAtCount: 0,
          });
        }
        return undefined;
      }),
    );
    const { container } = render(
      <AgentGraph onOpenNode={() => {}} rootSession={S_ROOT} sessionId={S_ROOT.id} />,
      { wrapper },
    );
    await waitFor(() => {
      expect(container.querySelectorAll('rect[data-row-id]').length).toBe(25);
    });
    expect(container.innerHTML).not.toMatch(/NaN/);
    // Bounded height via a capped className (h-[600px] at 20+ rows, the
    // 6-step lookup table's ceiling) inside the scrollable wrapper — never
    // an unbounded chart, never inline style.
    const scrollWrap = container.querySelector('.overflow-y-auto');
    expect(scrollWrap).not.toBeNull();
    expect(scrollWrap?.querySelector('[class*="h-[600px]"]')).not.toBeNull();
  });
});
