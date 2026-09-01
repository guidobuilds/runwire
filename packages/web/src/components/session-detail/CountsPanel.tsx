import type { ReactNode } from 'react';
import type { Capability, SessionRollup, SessionSummary } from '../../api/types';
import { Sparkline } from '../charts/Sparkline';
import { MetricCell } from '../primitives/MetricCell';
import { Table, Tbody, Td, Th, Thead, Tr } from '../primitives/Table';

export type CountsPanelProps = {
  summary: SessionSummary;
  rollup: SessionRollup | undefined;
  capabilities: readonly Capability[] | undefined;
  displayName: string;
  /**
   * Recent token-volume trend, client-derived by the caller from whatever
   * subtree data is already on hand (design.md §5: "no new endpoint") —
   * `CountsPanel` itself stays props-in/no-fetch. Optional so existing
   * callers that don't have a subtree in scope keep compiling; `Sparkline`
   * renders its own "No activity" state for an empty or omitted series.
   */
  series?: readonly number[];
};

/**
 * A cell that is empty by definition rather than by absence. Deliberately not
 * `n/a` or `—`: those two glyphs mean "the harness cannot report this" and
 * "missing from this session", and a count that is never rolled up is neither.
 */
function ByDefinition({ children }: { children: ReactNode }) {
  return <span className="text-xs text-zinc-500 dark:text-zinc-400">{children}</span>;
}

/** Counts, exclusive beside inclusive (design.md §7). */
export function CountsPanel({
  summary,
  rollup,
  capabilities,
  displayName,
  series = [],
}: CountsPanelProps) {
  const harness = summary.harness;
  const shared = { harness, capabilities, displayName, align: 'right' } as const;
  const rows = (['apiCalls', 'toolCalls', 'compactions'] as const).map((field) => ({
    field,
    label:
      field === 'apiCalls' ? 'API calls' : field === 'toolCalls' ? 'Tool calls' : 'Compactions',
  }));

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Counts</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Recent activity</span>
          <Sparkline data={series} width={96} height={24} label="Recent token-volume trend" />
        </div>
      </div>
      <Table>
        <Thead>
          <Tr>
            <Th>Count</Th>
            <Th>Exclusive</Th>
            <Th>Inclusive</Th>
          </Tr>
        </Thead>
        <Tbody>
          <Tr>
            <Td>Turns</Td>
            <Td numeric>
              <MetricCell field="turns" metric={summary.counts.turns} {...shared} />
            </Td>
            <Td numeric>
              <ByDefinition>not rolled up</ByDefinition>
            </Td>
          </Tr>
          {rows.map(({ field, label }) => (
            <Tr key={field}>
              <Td>{label}</Td>
              <Td numeric>
                <MetricCell field={field} metric={summary.counts[field]} {...shared} />
              </Td>
              <Td numeric>
                <MetricCell field={field} metric={rollup?.inclusive.counts[field]} {...shared} />
              </Td>
            </Tr>
          ))}
          <Tr>
            <Td>Subagents</Td>
            <Td numeric>
              <ByDefinition>rollup only</ByDefinition>
            </Td>
            <Td numeric>
              <MetricCell
                field="subagents"
                metric={rollup?.inclusive.counts.subagents}
                {...shared}
              />
            </Td>
          </Tr>
          <Tr>
            <Td>Descendants</Td>
            <Td numeric>
              <ByDefinition>tree property</ByDefinition>
            </Td>
            <Td numeric>{rollup ? rollup.descendants : <ByDefinition>unknown</ByDefinition>}</Td>
          </Tr>
        </Tbody>
      </Table>
    </section>
  );
}
