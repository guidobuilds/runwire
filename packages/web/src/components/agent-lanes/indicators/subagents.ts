import type { LaneModelData } from '../model';

export function subagents(model: LaneModelData) {
  return model.cols
    .filter((col) => col.marks.subagents > 0)
    .map((col) => ({
      agentId: col.agentId,
      index: col.index,
      count: col.marks.subagents,
      connectors: col.spawns.map((childId) => ({
        childId,
        index: model.byId.get(childId)?.cols[0]?.index ?? null,
      })),
    }));
}
