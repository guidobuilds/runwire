import type { LaneModelData } from '../model';

export function context(model: LaneModelData) {
  return model.cols.map((col) => ({
    agentId: col.agentId,
    index: col.index,
    value: col.contextPercent,
  }));
}
