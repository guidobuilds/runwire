import type { ReactNode } from 'react';
import type { Capability, SessionRollup, SessionSummary } from '../../api/types';
import { MetricCell } from '../MetricCell';
import { Table, Tbody, Td, Th, Thead, Tr } from '../ui/Table';

export type CountsPanelProps = {
  summary: SessionSummary;
  rollup: SessionRollup | undefined;
  capabilities: readonly Capability[] | undefined;
  displayName: string;
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
export function CountsPanel({ summary, rollup, capabilities, displayName }: CountsPanelProps) {
  const harness = summary.harness;
  const shared = { harness, capabilities, displayName, align: 'right' } as const;
  const rows = (['apiCalls', 'toolCalls', 'compactions'] as const).map((field) => ({
    field,
    label:
      field === 'apiCalls' ? 'API calls' : field === 'toolCalls' ? 'Tool calls' : 'Compactions',
  }));

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Counts</h2>
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
