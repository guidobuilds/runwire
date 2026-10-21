import type { LaneModelData } from '../model';

export function failures(model: LaneModelData) {
  return model.cols
    .filter((col) => col.fails > 0)
    .map((col) => ({
      agentId: col.agentId,
      index: col.index,
      count: col.fails,
    }));
}
