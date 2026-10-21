import type { LanesResponse } from '@runwire/core';
import { expect, it, vi } from 'vitest';
import long from '../fixtures/long.json';
import { buildModel, type LaneColumn, type LaneModelData } from '../model';
import {
  axisTicks,
  compactionPositions,
  drawFrame,
  idleCuts,
  idleLabels,
  prepareOverview,
  truncateLabel,
  visibleColumns,
} from './draw';
import { type LaneTheme, laneTokens } from './theme';

it('bounds truncation by characters even when an ellipsis never fits', () => {
  let calls = 0;
  expect(
    truncateLabel('agent name', 1, () => {
      calls++;
      return 100;
    }),
  ).toBe('');
  expect(calls).toBeLessThanOrEqual(11);
  expect(truncateLabel('abc', 3, (text) => text.length)).toBe('abc');
  expect(truncateLabel('abcdef', 4, (text) => text.length)).toBe('abc…');
});

it('derives adaptive one-based ticks and strict thirty-minute idle cuts without width', () => {
  expect(axisTicks({ start: 0, span: 100 }, 500)).toEqual([
    { index: 0, label: '1' },
    { index: 20, label: '21' },
    { index: 40, label: '41' },
    { index: 60, label: '61' },
    { index: 80, label: '81' },
  ]);
  const cols = [0, 1800000, 7200000].map((at, index) => ({ at, index })) as LaneColumn[];
  expect(idleCuts(cols)).toEqual([{ index: 2, duration: 5400000, label: '1h 30m' }]);
});

it('binary searches ordered lane columns with inclusive lower and exclusive upper bounds', () => {
  const cols = [1, 5, 9, 20].map((index) => ({ index })) as LaneColumn[];
  expect(visibleColumns(cols, 5, 20).map((c) => c.index)).toEqual([5, 9]);
  expect(visibleColumns(cols, 21, 25)).toEqual([]);
  expect(visibleColumns([], 0, 1)).toEqual([]);
});

it('precomputes peak context per CSS pixel, not density, including unknown and empty context', () => {
  const model = {
    callCount: 100,
    cols: [0, 1, 49, 99].map((index, i) => ({
      index,
      contextPercent: [12, 92, null, 30][i],
    })),
  } as LaneModelData;
  expect(prepareOverview(model, 2)).toEqual([92, 30]);
  expect(prepareOverview(model, 0)).toEqual([]);
  expect(prepareOverview({ ...model, callCount: 0, cols: [] }, 2)).toEqual([0, 0]);
});

it('places all eight Pi compactions at the context drop call centers independently of buckets', () => {
  const model = buildModel(long as LanesResponse);
  const view = { start: 0, span: model.callCount };
  const positions = compactionPositions(model, view, model.callCount * 2);
  expect(positions).toHaveLength(8);
  for (const { index, x } of positions) {
    const current = model.cols[index];
    const previous = model.cols[index - 1];
    expect(current?.events.some((event) => event.kind === 'compaction')).toBe(true);
    expect(current?.contextPercent ?? Infinity).toBeLessThan(previous?.contextPercent ?? 0);
    expect(x).toBe(index * 2 + 1);
  }
  const first = model.cols[0];
  if (!first) throw new Error('fixture requires calls');
  const after = {
    ...model,
    cols: [
      {
        ...first,
        events: [
          {
            kind: 'compaction' as const,
            preTokens: 100,
            postTokens: 10,
            trigger: null,
            after: true as const,
          },
        ],
      },
    ],
  };
  expect(compactionPositions(after, { start: 0, span: 12 }, 120)).toEqual([{ index: 1, x: 10 }]);
});

it('leaves eight pixels between idle labels and keeps their row clear of call ticks', () => {
  const cuts = [0, 30, 58, 90].map((index) => ({ index, duration: 3600000, label: '1h' }));
  expect(
    idleLabels(
      cuts,
      (index) => index,
      () => 50,
      140,
    ),
  ).toEqual([
    { index: 0, duration: 3600000, label: '1h', x: 0 },
    { index: 58, duration: 3600000, label: '1h', x: 58 },
  ]);
  expect(
    idleLabels(
      cuts,
      (index) => index - 100,
      () => 50,
      140,
    ),
  ).toEqual([]);
});

it('draws pane labels, axis corner, separated idle row, total, and cross-pane compactions', () => {
  const model = buildModel(long as LanesResponse);
  const ctx = {
    canvas: { width: 0, height: 0, style: {} },
    measureText: (text: string) => ({ width: text.length * 6 }),
  } as unknown as CanvasRenderingContext2D;
  for (const method of [
    'save',
    'restore',
    'beginPath',
    'rect',
    'clip',
    'setTransform',
    'setLineDash',
    'fillRect',
    'strokeRect',
    'fillText',
    'moveTo',
    'lineTo',
    'stroke',
    'closePath',
    'fill',
  ] as const)
    ctx[method] = vi.fn();
  const theme = Object.fromEntries(laneTokens.map((token) => [token, token])) as LaneTheme;
  const zones = drawFrame(
    ctx,
    model,
    {
      width: 900,
      height: 600,
      view: { start: 0, span: model.callCount },
      scrollY: 0,
    },
    { selectedAgentId: 'main', overview: prepareOverview(model, 732) },
    theme,
  );
  expect(ctx.fillText).toHaveBeenCalledWith('model call', 8, 7);
  expect(ctx.fillText).toHaveBeenCalledWith('Context %', 8, zones.context.y + 12);
  expect(ctx.fillText).toHaveBeenCalledWith('main highlighted', 8, zones.context.y + 27);
  for (const label of ['100', '50', '0']) {
    expect(vi.mocked(ctx.fillText).mock.calls.some(([text]) => text === label)).toBe(true);
  }
  expect(vi.mocked(ctx.fillText).mock.calls.some(([text]) => text === '1,192 calls')).toBe(true);
  const positions = compactionPositions(model, zones.view, zones.axis.width);
  for (const position of positions) {
    expect(ctx.lineTo).toHaveBeenCalledWith(zones.axis.x + position.x, zones.navigator.y);
  }
  expect(ctx.fill).toHaveBeenCalledTimes(8);
  const texts = vi.mocked(ctx.fillText).mock.calls;
  expect(texts.filter(([text]) => text.startsWith('// ')).every(([, , y]) => y === 20)).toBe(true);
  expect(texts.filter(([text]) => /^\d+$/.test(text)).some(([, , y]) => y === 7)).toBe(true);
});
