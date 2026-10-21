import type { LaneModelData } from '../model';

export function skills(model: LaneModelData) {
  return model.cols
    .filter((col) => col.marks.skills > 0)
    .map((col) => ({
      agentId: col.agentId,
      index: col.index,
      count: col.marks.skills,
    }));
}
