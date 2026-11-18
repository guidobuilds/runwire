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
  const previous = agent.cols.filter((col) => col.index < column).at(-1);
  const active =
    (agent.cols[0]?.index ?? Infinity) <= column && (agent.cols.at(-1)?.index ?? -1) >= column;
  const sum = (read: (col: LaneColumn) => number) => calls.reduce((n, col) => n + read(col), 0);
  const contexts = calls.flatMap((col) =>
    col.contextPercent === null ? [] : [col.contextPercent],
  );
  const compact = (value: number | null) =>
    value === null
      ? 'Unknown'
      : value >= 1000
        ? `${Number((value / 1000).toFixed(1))}k`
        : String(value);
  const idle = first && previous ? first.at - previous.at : 0;
  const categories = new Map<string, number>();
  for (const col of calls) {
    const kind = col.kind === 'look' ? 'read/search' : col.kind;
    const primary = Math.max(0, col.tools - col.marks.mcp - col.marks.skills);
    if (primary && kind !== 'reply') categories.set(kind, (categories.get(kind) ?? 0) + primary);
    if (col.marks.mcp) categories.set('MCP', (categories.get('MCP') ?? 0) + col.marks.mcp);
    if (col.marks.skills)
      categories.set('skills', (categories.get('skills') ?? 0) + col.marks.skills);
  }
  return (
    <div
      role="tooltip"
      className="absolute z-20 max-h-80 w-72 overflow-auto rounded-md border bg-popover p-3 text-xs text-popover-foreground shadow-md"
      style={{ left: x, top: y, pointerEvents: 'auto' }}
    >
      <p className="font-medium">
        {agent.label} · {agent.agentType ?? 'Agent'}
      </p>
      {first ? (
        <>
          <p>
            Calls #{column + 1}–#{endColumn + 1}
          </p>
          <p>Model: {[...new Set(calls.map((col) => col.model ?? 'Unknown'))].join(', ')}</p>
          <p>
            Context: {contexts.length ? `${Number(Math.max(...contexts).toFixed(1))}%` : 'Unknown'}{' '}
            · {compact(Math.max(...calls.map((col) => col.promptInput ?? 0)))}
            {' · '}window {compact(first.contextWindow)}
          </p>
          {categories.size ? (
            <p>
              Tools (primary categories):{' '}
              {[...categories].map(([kind, count]) => `${kind} ${count}`).join(', ')}
            </p>
          ) : null}
          {sum((col) => col.fails) > 0 ? <p>Failures: {sum((col) => col.fails)}</p> : null}
          <ul aria-label="Events">
            {calls.flatMap((col) =>
              col.events.map((event, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: Events retain immutable source order within a call and have no identity field.
                <li key={`${col.index}:${index}`}>
                  {event.kind === 'compaction'
                    ? `Compaction (${event.trigger ?? 'unknown'}): ${compact(event.preTokens)} pre-tokens → ${compact(event.postTokens)} post-tokens`
                    : `Model change: ${event.from ?? 'Unknown'} → ${event.to ?? 'Unknown'}`}
                  {event.after ? ' (after)' : ''}
                </li>
              )),
            )}
          </ul>
          {idle > 30 * 60_000 ? (
            <p>
              Previous idle:{' '}
              {idle >= 3_600_000
                ? `${Math.floor(idle / 3_600_000)}h`
                : `${Math.floor(idle / 60_000)}m`}
            </p>
          ) : null}
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
