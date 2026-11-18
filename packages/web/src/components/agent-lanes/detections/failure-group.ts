import type { LaneModelData } from '../model';
import type { Finding } from './index';

export const failureIndicators = ['failures'] as const;

export function failureGroup(model: LaneModelData): Finding[] {
  const found: Finding[] = [];
  for (const agent of model.agents) {
    const failed = agent.cols.filter((col) => col.fails > 0);
    for (let i = 0; i < failed.length; ) {
      let j = i;
      while (j + 1 < failed.length && (failed[j + 1]?.local ?? 0) - (failed[j]?.local ?? 0) <= 10)
        j++;
      const group = failed.slice(i, j + 1);
      const count = group.reduce((n, col) => n + col.fails, 0);
      const first = group[0];
      const last = group.at(-1);
      if (first && last && count >= 3) {
        found.push({
          agentId: agent.id,
          from: first.index,
          to: last.index,
          text: `${count} failed tool steps across ${group.length} calls`,
        });
      }
      i = j + 1;
    }
  }
  return found;
}
