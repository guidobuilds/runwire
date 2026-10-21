import type { LaneModelData } from '../model';

export function mcp(model: LaneModelData) {
  return model.cols
    .filter((col) => col.marks.mcp > 0)
    .map((col) => ({
      agentId: col.agentId,
      index: col.index,
      count: col.marks.mcp,
    }));
}
