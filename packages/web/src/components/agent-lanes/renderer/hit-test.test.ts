import { expect, it } from 'vitest';
import type { LaneModelData } from '../model';
import { hitTest } from './hit-test';
import { layout } from './layout';

it('maps fixed zones and scrolled lanes to global columns using half-open bounds', () => {
  const model = {
    agents: Array.from({ length: 18 }, (_, i) => ({ id: `a${i}`, depth: 0, cols: [] })),
  } as unknown as LaneModelData;
  const zones = layout(800, 800, { start: 20, span: 100 }, 30, model);
  expect(hitTest(20, 30, zones)).toEqual({ zone: 'label', lane: 'a1', column: null });
  expect(hitTest(230, 30, zones)).toEqual({ zone: 'lane', lane: 'a1', column: 30 });
  expect(hitTest(168, 0, zones)).toEqual({ zone: 'axis', lane: null, column: 20 });
  expect(hitTest(168, 326, zones)).toEqual({ zone: 'context', lane: null, column: 20 });
  expect(hitTest(478, 418, zones)).toEqual({ zone: 'navigator', lane: null, column: null });
  expect(hitTest(790, 30, zones)).toEqual({ zone: 'scrollbar', lane: null, column: null });
  expect(hitTest(800, 30, zones)).toEqual({ zone: 'outside', lane: null, column: null });
  expect(hitTest(-1, 30, zones).zone).toBe('outside');
  expect(hitTest(8, 340, zones)).toEqual({ zone: 'context', lane: null, column: null });
});
