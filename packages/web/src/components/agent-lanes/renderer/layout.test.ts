import { describe, expect, it } from 'vitest';
import type { LaneModelData } from '../model';
import { fitView } from '../viewport';
import { layout } from './layout';

function sampleModel(count = 18): LaneModelData {
  const agents = Array.from({ length: count }, (_, i) => ({
    id: `a${i}`,
    parentId: i ? 'a0' : null,
    depth: i ? 1 : 0,
    agentType: 'agent',
    label: i ? `agent #${i}` : 'main',
    detail: 'agent · 0 calls',
    spawnCallId: null,
    cols: [],
  }));
  return {
    sessionId: 'test',
    agents,
    cols: [],
    byId: new Map(agents.map((a) => [a.id, a])),
    children: new Map(),
    callCount: 100,
    excludedNullAtCount: 0,
  };
}

describe('layout', () => {
  it('keeps fixed zones, caps inline lanes, and synchronizes labels with lane scroll', () => {
    const result = layout(800, 800, fitView(100), 45, sampleModel());
    expect(result.labels).toEqual({ x: 0, y: 26, width: 168, height: 300 });
    expect(result.axis).toEqual({ x: 168, y: 0, width: 620, height: 26 });
    expect(result.context).toEqual({ x: 168, y: 326, width: 620, height: 92 });
    expect(result.navigator).toEqual({ x: 168, y: 418, width: 620, height: 30 });
    expect(result.scrollbar).toEqual({ x: 788, y: 26, width: 12, height: 300 });
    expect(result.lanes[0]?.y).toBe(-19);
    expect(result.lanes[1]?.y).toBe(11);
    expect(result.scrollY).toBe(45);
    expect(result.maxScrollY).toBe(240);
    expect(result.height).toBe(448);
  });

  it('fits fullscreen lanes, clamps scroll, hides descendants and handles tiny sizes', () => {
    const result = layout(800, 800, fitView(100), 999, sampleModel(), { fullscreen: true });
    expect(result.lanesArea.height).toBe(652);
    expect(result.height).toBe(800);
    expect(result.navigator.y + result.navigator.height).toBe(800);
    expect(result.contextLabels).toEqual({ x: 0, y: result.context.y, width: 168, height: 92 });
    expect(result.scrollbar).toBeNull();
    expect(result.scrollY).toBe(0);
    const collapsed = layout(800, 800, fitView(100), 50, sampleModel(), {
      collapsed: new Set(['a0']),
    });
    expect(collapsed.lanes).toHaveLength(1);
    expect(collapsed.lanes[0]?.hidden).toBe(17);
    expect(collapsed.scrollY).toBe(0);
    const small = layout(100, 100, fitView(0), -10, sampleModel());
    expect(small.lanesArea.width).toBe(0);
    expect(small.lanesArea.height).toBe(0);
    expect(small.scrollY).toBe(0);
  });
});
