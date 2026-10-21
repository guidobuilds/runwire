import { expect, it } from 'vitest';
import type { LaneColumn, LaneModelData } from '../model';
import { axisTicks, idleCuts, prepareOverview, truncateLabel, visibleColumns } from './draw';

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

it('precomputes one navigator density value per CSS pixel including empty sessions', () => {
  const model = {
    callCount: 100,
    cols: [0, 1, 49, 99].map((index) => ({ index })),
  } as LaneModelData;
  expect(prepareOverview(model, 2)).toEqual([3, 1]);
  expect(prepareOverview(model, 0)).toEqual([]);
  expect(prepareOverview({ ...model, callCount: 0, cols: [] }, 2)).toEqual([0, 0]);
});
