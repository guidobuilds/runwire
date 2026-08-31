import { describe, expect, test } from 'vitest';
import type { SessionSummary } from '../api/types';
import { buildAgentTree, type TreeNode } from './tree';

function summary(
  id: string,
  extra: { parentId?: string; startedAt?: string; agentType?: string } = {},
): SessionSummary {
  return {
    id,
    harness: 'fake',
    depth: extra.parentId === undefined ? 0 : 1,
    parentId: extra.parentId,
    agentType: extra.agentType,
    project: { key: 'p', name: 'p', identity: 'cwd' },
    cwd: { first: '/w', all: ['/w'] },
    timing:
      extra.startedAt === undefined
        ? {}
        : { startedAt: { value: extra.startedAt, confidence: 'high', source: 'fake' } },
    model: { all: [], changes: 0 },
    flags: {},
    usage: {},
    counts: {},
    children: [],
    source: { path: '/w/a.jsonl', sizeBytes: 1, mtimeMs: 0 },
    diagnostics: [],
  };
}

function ids(nodes: TreeNode[]): string[] {
  return nodes.map((node) => node.id);
}

describe('buildAgentTree', () => {
  test('nests three levels', () => {
    const tree = buildAgentTree('r', [
      summary('r'),
      summary('a', { parentId: 'r' }),
      summary('b', { parentId: 'a' }),
    ]);
    expect(tree?.id).toBe('r');
    expect(ids(tree?.children ?? [])).toEqual(['a']);
    expect(ids(tree?.children[0]?.children ?? [])).toEqual(['b']);
    expect(tree?.children[0]?.children[0]?.children).toEqual([]);
  });

  test('a node whose parent is outside the subtree attaches under the root, marked orphan', () => {
    const tree = buildAgentTree('r', [
      summary('r'),
      summary('a', { parentId: 'r' }),
      summary('lost', { parentId: 'elsewhere' }),
    ]);
    const orphans = (tree?.children ?? []).filter((node) => node.orphan);
    expect(ids(orphans)).toEqual(['lost']);
    expect(tree?.children.find((node) => node.id === 'a')?.orphan).toBe(false);
  });

  test('a self-referential parentId terminates and keeps the session in the tree', () => {
    const tree = buildAgentTree('r', [summary('r'), summary('loop', { parentId: 'loop' })]);
    expect(ids(tree?.children ?? [])).toEqual(['loop']);
    expect(tree?.children[0]?.orphan).toBe(true);
    expect(tree?.children[0]?.children).toEqual([]);
  });

  test('a mutual parent cycle terminates and keeps both sessions reachable', () => {
    const tree = buildAgentTree('r', [
      summary('r'),
      summary('a', { parentId: 'b' }),
      summary('b', { parentId: 'a' }),
    ]);
    const reached = new Set<string>();
    const walk = (node: TreeNode): void => {
      reached.add(node.id);
      for (const child of node.children) walk(child);
    };
    if (tree) walk(tree);
    expect([...reached].sort()).toEqual(['a', 'b', 'r']);
  });

  test('children are ordered by startedAt, absent timings last, ties broken by id', () => {
    const tree = buildAgentTree('r', [
      summary('r'),
      summary('late', { parentId: 'r', startedAt: '2026-08-31T12:00:00.000Z' }),
      summary('undated', { parentId: 'r' }),
      summary('early', { parentId: 'r', startedAt: '2026-08-31T09:00:00.000Z' }),
      summary('also-early', { parentId: 'r', startedAt: '2026-08-31T09:00:00.000Z' }),
    ]);
    expect(ids(tree?.children ?? [])).toEqual(['also-early', 'early', 'late', 'undated']);
  });

  test('returns undefined when the root id is not in the subtree', () => {
    expect(buildAgentTree('missing', [summary('r')])).toBeUndefined();
  });
});
