import { LANE_HEIGHT, type Layout, type Rect } from './layout';

export type Hit = {
  zone: 'label' | 'axis' | 'lane' | 'context' | 'navigator' | 'scrollbar' | 'outside';
  lane: string | null;
  column: number | null;
};

export function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

export function hitTest(x: number, y: number, layout: Layout): Hit {
  const hit: Hit = { zone: 'outside', lane: null, column: null };
  const zones = [
    ['scrollbar', layout.scrollbar],
    ['label', layout.labels],
    ['axis', layout.axis],
    ['lane', layout.lanesArea],
    ['context', layout.context],
    ['navigator', layout.navigator],
  ] as const;
  for (const [zone, rect] of zones) {
    if (!rect || !contains(rect, x, y)) continue;
    hit.zone = zone;
    if (zone === 'label' || zone === 'lane') {
      hit.lane =
        layout.lanes.find((lane) => y >= lane.y && y < lane.y + LANE_HEIGHT)?.agent.id ?? null;
    }
    if (zone === 'axis' || zone === 'lane' || zone === 'context') {
      hit.column = Math.floor(layout.view.start + ((x - rect.x) / rect.width) * layout.view.span);
    }
    return hit;
  }
  return hit;
}
