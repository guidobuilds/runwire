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

export type LaneSwatch = { label: string; token: LaneToken };

export function laneRoleSwatches(): { kinds: LaneSwatch[]; tiers: LaneSwatch[] } {
  return {
    kinds: [
      { label: 'Subagent', token: '--lane-kind-agent' },
      { label: 'MCP', token: '--lane-kind-mcp' },
      { label: 'Write', token: '--lane-kind-write' },
      { label: 'Exec', token: '--lane-kind-exec' },
      { label: 'Read / search', token: '--lane-kind-look' },
      { label: 'Other', token: '--lane-kind-other' },
      { label: 'Reply', token: '--lane-kind-reply' },
    ],
    tiers: [
      { label: 'High tier', token: '--lane-tier-high' },
      { label: 'Mid tier', token: '--lane-tier-mid' },
      { label: 'Low tier', token: '--lane-tier-low' },
    ],
  };
}

export function readLaneTheme(element: Element): LaneTheme {
  const style = getComputedStyle(element);
  return Object.fromEntries(
    laneTokens.map((token) => [token, style.getPropertyValue(token).trim()]),
  ) as LaneTheme;
}
