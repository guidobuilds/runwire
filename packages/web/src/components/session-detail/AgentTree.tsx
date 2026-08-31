import { useState } from 'react';
import type { Capability, SessionRollup, Usage } from '../../api/types';
import type { TreeNode } from '../../lib/tree';
import { MetricCell } from '../MetricCell';
import { Badge } from '../ui/Badge';
import { Table, Tbody, Td, Th, Thead, Tr } from '../ui/Table';

export type AgentTreeProps = {
  root: TreeNode;
  /** `subtree.rollups` from `GET /api/sessions/:id`, keyed by session id. */
  rollups: Record<string, SessionRollup>;
  capabilities: readonly Capability[] | undefined;
  displayName: string;
  /** Called with a descendant's id when its row is activated. */
  onOpen?: (id: string) => void;
};

const USAGE_COLUMNS = [
  { field: 'uncachedInput', label: 'Input' },
  { field: 'cachedInput', label: 'Cached' },
  { field: 'output', label: 'Output' },
] as const satisfies readonly { field: keyof Usage; label: string }[];

function nodeLabel(node: TreeNode): string {
  return node.summary.agentType ?? node.summary.relation ?? 'root';
}

type Row = { node: TreeNode; depth: number };

function flatten(node: TreeNode, depth: number, expanded: ReadonlySet<string>, out: Row[]): void {
  out.push({ node, depth });
  if (!expanded.has(node.id)) return;
  for (const child of node.children) flatten(child, depth + 1, expanded, out);
}

/**
 * The agent hierarchy with exclusive and inclusive totals per node (design.md
 * §7). Both are always shown: the point of the view is the difference between
 * them, so the shell toggle does not hide either one.
 *
 * Rows are opened from a real `button` on the node label rather than a click
 * handler on the row: a `tr` with `onClick` is unreachable by keyboard and
 * fails Biome's recommended a11y rules.
 */
export function AgentTree({ root, rollups, capabilities, displayName, onOpen }: AgentTreeProps) {
  // Depth 1 open by default: the root's children are on screen, deeper ones are not.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([root.id]));

  const toggle = (id: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  const rows: Row[] = [];
  flatten(root, 0, expanded, rows);

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Agents</h2>
      <Table>
        <Thead>
          <Tr>
            <Th>Agent</Th>
            <Th>Model</Th>
            {USAGE_COLUMNS.map((column) => (
              <Th key={`excl-${column.field}`}>{`${column.label} (excl.)`}</Th>
            ))}
            {USAGE_COLUMNS.map((column) => (
              <Th key={`incl-${column.field}`}>{`${column.label} (incl.)`}</Th>
            ))}
            <Th>Descendants</Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map(({ node, depth }) => {
            const rollup = rollups[node.id];
            const exclusive = rollup?.exclusive.usage ?? node.summary.usage;
            const inclusive = rollup?.inclusive.usage;
            const label = nodeLabel(node);
            const isOpen = expanded.has(node.id);
            const shared = {
              harness: node.summary.harness,
              capabilities,
              displayName,
              align: 'right',
            } as const;

            return (
              <Tr key={node.id}>
                <Td>
                  <span
                    className="flex items-center gap-1"
                    style={{ paddingLeft: `${depth * 16}px` }}
                  >
                    {node.children.length > 0 ? (
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? 'Hide' : 'Show'} children of ${label}`}
                        onClick={() => toggle(node.id)}
                        className="w-4 select-none text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
                      >
                        {isOpen ? '▾' : '▸'}
                      </button>
                    ) : (
                      <span className="w-4" />
                    )}
                    {depth === 0 || !onOpen ? (
                      <span>{label}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onOpen(node.id)}
                        className="underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-500 dark:decoration-zinc-600"
                      >
                        {label}
                      </button>
                    )}
                    {node.orphan ? <Badge tone="warn">orphan</Badge> : null}
                  </span>
                </Td>
                <Td>
                  <MetricCell field="model" metric={node.summary.model.primary} {...shared} />
                </Td>
                {USAGE_COLUMNS.map((column) => (
                  <Td key={`excl-${column.field}`} numeric>
                    <MetricCell field={column.field} metric={exclusive[column.field]} {...shared} />
                  </Td>
                ))}
                {USAGE_COLUMNS.map((column) => (
                  <Td key={`incl-${column.field}`} numeric>
                    <MetricCell
                      field={column.field}
                      metric={inclusive?.[column.field]}
                      {...shared}
                    />
                  </Td>
                ))}
                <Td numeric>{rollup ? rollup.descendants : 0}</Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>
    </section>
  );
}
