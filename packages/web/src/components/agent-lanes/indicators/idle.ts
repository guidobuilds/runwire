import type { LaneModelData } from '../model';

export const IDLE_MS = 30 * 60_000;

export function idle(model: LaneModelData) {
  return model.cols.flatMap((col, index) => {
    const previous = model.cols[index - 1];
    return previous && col.at - previous.at > IDLE_MS
      ? [{ from: previous.index, to: col.index, duration: col.at - previous.at }]
      : [];
  });
}
