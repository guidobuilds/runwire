import { Button } from '@/components/ui/button';
import type { LaneColumn, LaneModelData } from './model';

export type LaneTooltipProps = {
  model: LaneModelData;
  agentId: string;
  column: number;
  endColumn?: number;
  x: number;
  y: number;
  onOpenNode: (id: string) => void;
};

export function LaneTooltip({
  model,
  agentId,
  column,
  endColumn = column,
  x,
  y,
  onOpenNode,
}: LaneTooltipProps) {
  const agent = model.byId.get(agentId);
  if (!agent) return null;
  const calls = agent.cols.filter((col) => col.index >= column && col.index <= endColumn);
  const first = calls[0];
  const last = calls.at(-1);
  const previous = agent.cols.filter((col) => col.index < column).at(-1);
  const active =
    (agent.cols[0]?.index ?? Infinity) <= column && (agent.cols.at(-1)?.index ?? -1) >= column;
  const sum = (read: (col: LaneColumn) => number) => calls.reduce((n, col) => n + read(col), 0);
  // The frozen lanes contract has no per-category histogram. Show its primary kind,
  // MCP/skill/subagent counters and failures instead of inventing category totals.
  const contexts = calls.flatMap((col) =>
    col.contextPercent === null ? [] : [col.contextPercent],
  );
  return (
    <div
      role="tooltip"
      className="absolute z-20 max-h-80 w-72 overflow-auto rounded-md border bg-popover p-3 text-xs text-popover-foreground shadow-md"
      style={{ left: x, top: y }}
    >
      <p className="font-medium">
        {agent.id} · {agent.agentType ?? 'Agent'}
      </p>
      {first ? (
        <>
          <p>
            Calls {column + 1}–{endColumn + 1} (agent {first.seq}–{last?.seq})
          </p>
          <p>Model: {[...new Set(calls.map((col) => col.model ?? 'Unknown'))].join(', ')}</p>
          <p>
            Context: {contexts.length ? `${Math.max(...contexts).toFixed(1)}%` : 'Unknown'} ·{' '}
            {first.promptInput ?? 'Unknown'} input tokens · {sum((col) => col.output ?? 0)} output
            tokens
          </p>
          <p>
            Tools: {sum((col) => col.tools)} total · {sum((col) => col.marks.mcp)} MCP ·{' '}
            {sum((col) => col.marks.skills)} skills · {sum((col) => col.marks.subagents)} subagent
            calls
          </p>
          <p>Primary categories: {[...new Set(calls.map((col) => col.kind))].join(', ')}</p>
          <p>Failures: {sum((col) => col.fails)}</p>
          <ul aria-label="Events">
            {calls.flatMap((col) =>
              col.events.map((event, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: Events retain immutable source order within a call and have no identity field.
                <li key={`${col.index}:${index}`}>
                  {event.kind === 'compaction'
                    ? `Compaction (${event.trigger ?? 'unknown'}): ${event.preTokens ?? 'Unknown'} pre-tokens → ${event.postTokens ?? 'Unknown'} post-tokens`
                    : `Model change: ${event.from ?? 'Unknown'} → ${event.to ?? 'Unknown'}`}
                  {event.after ? ' (after)' : ''}
                </li>
              )),
            )}
          </ul>
          <p>
            Previous idle: {previous ? `${Math.round((first.at - previous.at) / 1000)}s` : 'None'}
          </p>
        </>
      ) : (
        <p>{active ? 'waiting, another agent is running' : 'not running'}</p>
      )}
      <Button size="sm" variant="link" onClick={() => onOpenNode(agentId)}>
        Open
      </Button>
    </div>
  );
}
