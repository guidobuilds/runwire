import type { LaneColumn } from './model';

export type Viewport = { start: number; span: number };
export const MIN_SPAN = 12;

export function ppc(view: Viewport, width: number): number {
  return width / view.span;
}

export function xOf(view: Viewport, width: number, callIndex: number): number {
  return (callIndex - view.start) * ppc(view, width);
}

export function clamp(view: Viewport, callCount: number): Viewport {
  const total = Math.max(MIN_SPAN, callCount);
  const span = Math.max(MIN_SPAN, Math.min(total, view.span));
  return { start: Math.max(0, Math.min(total - span, view.start)), span };
}

/** factor > 1 zooms in; cursor and width are in lane-area CSS pixels. */
export function zoom(
  view: Viewport,
  factor: number,
  cursor: number,
  width: number,
  callCount: number,
): Viewport {
  const span = clamp({ start: 0, span: view.span / factor }, callCount).span;
  const fraction = width > 0 ? Math.max(0, Math.min(1, cursor / width)) : 0;
  return clamp({ start: view.start + fraction * (view.span - span), span }, callCount);
}

/** delta is measured in global calls, not pixels. */
export function pan(view: Viewport, delta: number, callCount: number): Viewport {
  return clamp({ ...view, start: view.start + delta }, callCount);
}

export function fit(callCount: number): Viewport {
  return { start: 0, span: Math.max(MIN_SPAN, callCount) };
}

export function bucketSize(pixelsPerCall: number): number {
  return pixelsPerCall >= 3 ? 1 : 2 ** Math.ceil(Math.log2(3 / pixelsPerCall));
}

export type LaneBucket = {
  from: number;
  to: number;
  count: number;
  kind: LaneColumn['kind'];
  tier: LaneColumn['tier'];
  maxContextPercent: number | null;
  maxPromptInput: number | null;
};

function dominant<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: T | undefined;
  let max = 0;
  for (const [value, count] of counts) {
    if (count > max) {
      best = value;
      max = count;
    }
  }
  return best;
}

function maximum(values: (number | null)[]): number | null {
  let max: number | null = null;
  for (const value of values) if (value !== null) max = Math.max(max ?? value, value);
  return max;
}

/** Apply per lane; boundaries are aligned to the global axis, including sparse lanes. */
export function bucket(cols: readonly LaneColumn[], size: number): LaneBucket[] {
  const groups = new Map<number, LaneColumn[]>();
  for (const col of cols) {
    const from = Math.floor(col.index / size) * size;
    const group = groups.get(from) ?? [];
    group.push(col);
    groups.set(from, group);
  }
  return [...groups].map(([from, group]) => ({
    from,
    to: from + size - 1,
    count: group.length,
    kind: dominant(group.map((c) => c.kind)) ?? 'reply',
    tier: dominant(group.map((c) => c.tier)) ?? null,
    maxContextPercent: maximum(group.map((c) => c.contextPercent)),
    maxPromptInput: maximum(group.map((c) => c.promptInput)),
  }));
}

/** Smallest 1, 2, 5 × 10ⁿ step at least as large as the requested call spacing. */
export function tickStep(target: number): number {
  if (target <= 0) return 1;
  const scale = 10 ** Math.floor(Math.log10(target));
  const normalized = target / scale;
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * scale;
}
