import type { LanesResponse } from '@runwire/core';
import { expect, it } from 'vitest';
import fixture from './fixtures/short.json';
import { buildModel } from './model';
import {
  bucket,
  bucketSize,
  clamp,
  fitView,
  MIN_SPAN,
  pan,
  ppc,
  tickStep,
  xOf,
  zoom,
} from './viewport';

it('anchors zoom at the cursor; clamps pan, zoom, fit and small/empty sessions', () => {
  expect(MIN_SPAN).toBe(12);
  const view = { start: 20, span: 40 };
  expect(ppc(view, 400)).toBe(10);
  expect(xOf(view, 400, 25)).toBe(50);
  const next = zoom(view, 2, 100, 400, 200);
  expect(next).toEqual({ start: 25, span: 20 });
  expect(xOf(next, 400, 30)).toBe(xOf(view, 400, 30));
  expect(zoom(view, 100, 0, 400, 200)).toEqual({ start: 20, span: 12 });
  expect(pan(view, -100, 200)).toEqual({ start: 0, span: 40 });
  expect(pan(view, 1000, 200)).toEqual({ start: 160, span: 40 });
  expect(clamp({ start: -2, span: 2 }, 100)).toEqual({ start: 0, span: 12 });
  expect(fitView(100)).toEqual({ start: 0, span: 100 });
  expect(fitView(3)).toEqual({ start: 0, span: 12 });
  expect(fitView(0)).toEqual({ start: 0, span: 12 });
  expect(clamp({ start: 10, span: 1000 }, 100)).toEqual(fitView(100));
});

it.each([
  [3, 1],
  [2.99, 2],
  [1.5, 2],
  [1, 4],
  [0.4, 8],
])('selects power-of-two bucket size at %s pixels per call', (pixels, size) => {
  expect(bucketSize(pixels)).toBe(size);
});

it('buckets by global index, dominant kind/tier and maximum context; ties use first call', () => {
  const model = buildModel(fixture as LanesResponse);
  const cols = model.cols.slice(0, 4).map((c, i) => ({
    ...c,
    kind: i < 3 ? ('look' as const) : ('exec' as const),
    tier: i < 2 ? ('mid' as const) : ('high' as const),
    contextPercent: i === 2 ? 90 : null,
    promptInput: i === 2 ? 900 : null,
  }));
  expect(bucket(cols, 4)).toEqual([
    {
      from: 0,
      to: 3,
      count: 4,
      kind: 'look',
      tier: 'mid',
      maxContextPercent: 90,
      maxPromptInput: 900,
    },
  ]);
  expect(bucket(cols.slice(1), 2).map((b) => [b.from, b.to, b.count])).toEqual([
    [0, 1, 1],
    [2, 3, 2],
  ]);
  expect(bucket([], 4)).toEqual([]);
});

it.each([
  [1, 1],
  [1.1, 2],
  [2.1, 5],
  [5.1, 10],
  [11, 20],
  [0.3, 0.5],
])('uses 1/2/5 tick spacing for target %s', (target, expected) => {
  expect(tickStep(target)).toBe(expected);
});
