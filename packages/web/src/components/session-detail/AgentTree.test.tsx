import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { SessionRollup } from '../../api/types';
import { buildAgentTree, type TreeNode } from '../../lib/tree';
import { AgentTree } from './AgentTree';
import { FULL_CAPS, makeRollup, makeSummary, metric } from './fixtures';

const SUMMARIES = [
  makeSummary({ id: 'fake:root', timing: { startedAt: metric('2026-08-31T09:00:00.000Z') } }),
  makeSummary({
    id: 'fake:explore',
    parentId: 'fake:root',
    depth: 1,
    relation: 'subagent',
    agentType: 'Explore',
    timing: { startedAt: metric('2026-08-31T09:01:00.000Z') },
  }),
  makeSummary({
    id: 'fake:plan',
    parentId: 'fake:root',
    depth: 1,
    relation: 'subagent',
    agentType: 'Plan',
    timing: { startedAt: metric('2026-08-31T09:02:00.000Z') },
  }),
  makeSummary({
    id: 'fake:deep',
    parentId: 'fake:explore',
    depth: 2,
    relation: 'subagent',
    agentType: 'Deep',
    timing: { startedAt: metric('2026-08-31T09:03:00.000Z') },
  }),
  makeSummary({
    id: 'fake:stray',
    parentId: 'fake:not-in-this-subtree',
    depth: 1,
    relation: 'subagent',
    agentType: 'Stray',
    timing: { startedAt: metric('2026-08-31T09:04:00.000Z') },
  }),
];

function rollupFor(id: string, exclusiveOutput: number, inclusiveOutput: number): SessionRollup {
  return makeRollup({
    id,
    exclusive: { usage: { output: metric(exclusiveOutput) }, counts: {} },
    inclusive: { usage: { output: metric(inclusiveOutput) }, counts: { subagents: metric(0) } },
    descendants: 0,
  });
}

const ROLLUPS: Record<string, SessionRollup> = {
  'fake:root': rollupFor('fake:root', 1000, 9000),
  'fake:explore': rollupFor('fake:explore', 2000, 3000),
  'fake:plan': rollupFor('fake:plan', 4000, 5000),
  'fake:deep': rollupFor('fake:deep', 6000, 7000),
  'fake:stray': rollupFor('fake:stray', 8000, 8100),
};

function tree(): TreeNode {
  const built = buildAgentTree('fake:root', SUMMARIES);
  if (!built) throw new Error('fixture root missing');
  return built;
}

function renderTree(onOpen?: (id: string) => void) {
  return render(
    <AgentTree
      root={tree()}
      rollups={ROLLUPS}
      capabilities={FULL_CAPS}
      displayName="Fake Harness"
      onOpen={onOpen}
    />,
  );
}

function rowOf(label: string): HTMLElement {
  const row = screen.getByText(label).closest('tr');
  if (!row) throw new Error(`no row for ${label}`);
  return row;
}

describe('AgentTree', () => {
  afterEach(() => {
    cleanup();
  });

  test('each node shows its own exclusive and inclusive output from the rollups map', () => {
    renderTree();
    expect(within(rowOf('root')).getByText('1.0k')).not.toBeNull();
    expect(within(rowOf('root')).getByText('9.0k')).not.toBeNull();
    expect(within(rowOf('Explore')).getByText('2.0k')).not.toBeNull();
    expect(within(rowOf('Explore')).getByText('3.0k')).not.toBeNull();
    expect(within(rowOf('Plan')).getByText('4.0k')).not.toBeNull();
    expect(within(rowOf('Plan')).getByText('5.0k')).not.toBeNull();
  });

  test('a grandchild is not rendered until its parent row is opened', () => {
    renderTree();
    expect(screen.queryByText('Deep')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show children of Explore' }));
    expect(within(rowOf('Deep')).getByText('6.0k')).not.toBeNull();
    expect(within(rowOf('Deep')).getByText('7.0k')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hide children of Explore' }));
    expect(screen.queryByText('Deep')).toBeNull();
  });

  test('a node re-parented under the root is marked orphan, and real children are not', () => {
    renderTree();
    expect(within(rowOf('Stray')).getByText('orphan')).not.toBeNull();
    expect(within(rowOf('Explore')).queryByText('orphan')).toBeNull();
    expect(screen.getAllByText('orphan')).toHaveLength(1);
  });

  test('activating a descendant asks the caller to open that session', () => {
    const onOpen = vi.fn();
    renderTree(onOpen);
    fireEvent.click(screen.getByRole('button', { name: 'Explore' }));
    expect(onOpen).toHaveBeenCalledWith('fake:explore');
  });

  test('renders with no QueryClientProvider mounted, so no cell can fetch for itself', () => {
    // The capability lookup is hoisted into the route and handed down as props
    // (design.md §5/§6/§7). A `ConnectedMetricCell` anywhere below would open 2
    // query observers per cell and throw "No QueryClient set" right here, which
    // is what makes this assertion the pin rather than the doc comment.
    expect(() => renderTree()).not.toThrow();
    expect(screen.getByText('Explore')).not.toBeNull();
  });

  test('the root row is not activatable — it is the session already on screen', () => {
    renderTree(vi.fn());
    expect(screen.queryByRole('button', { name: 'root' })).toBeNull();
  });
});
