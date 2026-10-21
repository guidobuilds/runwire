export const laneTokens = [
  '--lane-kind-agent',
  '--lane-kind-mcp',
  '--lane-kind-write',
  '--lane-kind-exec',
  '--lane-kind-look',
  '--lane-kind-other',
  '--lane-kind-reply',
  '--lane-tier-high',
  '--lane-tier-mid',
  '--lane-tier-low',
  '--lane-detection',
  '--lane-background',
  '--lane-foreground',
  '--lane-muted',
  '--lane-grid',
  '--lane-surface',
  '--lane-context',
  '--lane-skill',
  '--lane-compaction',
  '--lane-failure',
  '--lane-idle',
] as const;
export type LaneToken = (typeof laneTokens)[number];
export type LaneTheme = Record<LaneToken, string>;

/** Call on mount and on theme changes, not from the frame loop. */
export function readLaneTheme(element: Element): LaneTheme {
  const style = getComputedStyle(element);
  return Object.fromEntries(
    laneTokens.map((token) => [token, style.getPropertyValue(token).trim()]),
  ) as LaneTheme;
}
