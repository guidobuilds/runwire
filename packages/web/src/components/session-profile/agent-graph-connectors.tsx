import { useXAxisScale, useYAxisScale } from 'recharts';

/** One parent→child branch: `parentXRel`/`childXRel` are relative-ms x values
 * (already offset from the chart's domain start, matching the chart data's
 * `offset`/`callAtRel` fields) and `parentId`/`childId` are row ids used as
 * the categorical y-axis values. */
export type AgentGraphConnector = {
  parentId: string;
  childId: string;
  parentXRel: number;
  childXRel: number;
};

export type AgentGraphConnectorsProps = {
  connectors: readonly AgentGraphConnector[];
};

/** Draws a short vertical-then-horizontal elbow from the parent row (at the
 * spawn call's x) to the child row (at its own start x) — the git-graph
 * branch line. Rendered as a direct child of the chart: Recharts 3.x renders
 * arbitrary children inside chart context (the deprecated `Customized`
 * wrapper and its 2.x `xAxisMap`/`yAxisMap` props are no longer needed —
 * `useXAxisScale`/`useYAxisScale` are the documented 3.8+ replacement). */
export function AgentGraphConnectors({ connectors }: AgentGraphConnectorsProps) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  if (!xScale || !yScale) return null;

  return (
    <g className="agent-graph-connectors">
      {connectors.map((connector) => {
        const x1 = xScale(connector.parentXRel);
        const x2 = xScale(connector.childXRel);
        const parentY = yScale(connector.parentId, { position: 'middle' });
        const childY = yScale(connector.childId, { position: 'middle' });
        if (x1 === undefined || x2 === undefined || parentY === undefined || childY === undefined) {
          return null;
        }
        const d = `M ${x1} ${parentY} L ${x1} ${childY} L ${x2} ${childY}`;
        return (
          <path
            className="agent-graph-connector"
            d={d}
            data-child-id={connector.childId}
            data-parent-id={connector.parentId}
            fill="none"
            key={connector.childId}
            stroke="var(--muted-foreground)"
            strokeWidth={1.5}
          />
        );
      })}
    </g>
  );
}
