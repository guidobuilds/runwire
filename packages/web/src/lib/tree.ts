import type { SessionSummary } from '../api/types';

/**
 * One node of the agent hierarchy rebuilt from the flat DFS subtree the API
 * returns (`GET /api/sessions/:id` → `subtree.summaries`). Shape per
 * design.md §7, plus `orphan` for a node whose parent is not in the subtree.
 */
export type TreeNode = {
  id: string;
  summary: SessionSummary;
  children: TreeNode[];
  /**
   * True when the node was re-attached under the root because its `parentId`
   * is not in this subtree, or because it sat in a parent cycle. Rendered as a
   * on-screen marker so a re-parented row is never silently presented as a real
   * child of the root.
   */
  orphan: boolean;
};

/**
 * Rebuilds the tree rooted at `rootId` from a flat list of summaries.
 *
 * - Attaches each summary to its `parentId` when that parent is in the subtree,
 *   otherwise under the root with `orphan: true`.
 * - Breaks parent cycles: any node the root cannot reach is re-attached under
 *   the root as an orphan, so a cyclic `parentId` can neither hang the walk nor
 *   drop a session from the rendered tree.
 * - Children are ordered by `timing.startedAt.value`, absent timings last, ties
 *   broken by id.
 *
 * Returns `undefined` when `rootId` is not present in `summaries`.
 */
export function buildAgentTree(
  rootId: string,
  summaries: readonly SessionSummary[],
): TreeNode | undefined {
  const byId = new Map<string, SessionSummary>();
  for (const summary of summaries) {
    if (!byId.has(summary.id)) byId.set(summary.id, summary);
  }

  const nodes = new Map<string, TreeNode>();
  for (const [id, summary] of byId) {
    nodes.set(id, { id, summary, children: [], orphan: false });
  }

  const root = nodes.get(rootId);
  if (!root) return undefined;

  /** id → id of the node it is currently attached to (root has no entry). */
  const attachedTo = new Map<string, string>();

  for (const [id, summary] of byId) {
    if (id === rootId) continue;
    const node = nodes.get(id);
    if (!node) continue;
    const parentId = summary.parentId;
    const parent = parentId !== undefined ? nodes.get(parentId) : undefined;
    if (parent) {
      parent.children.push(node);
      attachedTo.set(id, parent.id);
    } else {
      node.orphan = true;
      root.children.push(node);
      attachedTo.set(id, root.id);
    }
  }

  // Cycle guard. A node the root cannot reach is inside a parent cycle (a node
  // that is its own ancestor). Re-attaching the first such node under the root
  // makes it — and everything hanging off it — reachable, so each pass strictly
  // shrinks the stranded set and the loop terminates.
  let stranded = strandedIds(root, nodes);
  while (stranded.length > 0) {
    const id = stranded[0];
    const node = id === undefined ? undefined : nodes.get(id);
    if (!node || id === undefined) break;
    const currentParentId = attachedTo.get(id);
    const currentParent = currentParentId === undefined ? undefined : nodes.get(currentParentId);
    if (currentParent) {
      currentParent.children = currentParent.children.filter((child) => child.id !== id);
    }
    node.orphan = true;
    root.children.push(node);
    attachedTo.set(id, root.id);
    stranded = strandedIds(root, nodes);
  }

  sortSubtree(root);
  return root;
}

/** Ids no walk from `root` reaches. The visited set makes the walk finite under a cycle. */
function strandedIds(root: TreeNode, nodes: Map<string, TreeNode>): string[] {
  const visited = new Set<string>();
  const pending: TreeNode[] = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || visited.has(node.id)) continue;
    visited.add(node.id);
    for (const child of node.children) pending.push(child);
  }
  return [...nodes.keys()].filter((id) => !visited.has(id));
}

function startedAt(node: TreeNode): string | undefined {
  return node.summary.timing.startedAt?.value;
}

function compareNodes(a: TreeNode, b: TreeNode): number {
  const aStarted = startedAt(a);
  const bStarted = startedAt(b);
  if (aStarted !== bStarted) {
    if (aStarted === undefined) return 1;
    if (bStarted === undefined) return -1;
    return aStarted < bStarted ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Safe to recurse without a visited set: the cycle guard above ran first. */
function sortSubtree(node: TreeNode): void {
  node.children.sort(compareNodes);
  for (const child of node.children) sortSubtree(child);
}
