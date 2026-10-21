import type { LaneColumn, LaneModelData } from '../model';
import type { Finding } from './index';

export function runs(
  model: LaneModelData,
  matches: (col: LaneColumn) => boolean,
  minimum: number,
  text: (cols: LaneColumn[]) => string,
): Finding[] {
  const found: Finding[] = [];
  for (const agent of model.agents) {
    let run: LaneColumn[] = [];
    const flush = () => {
      const first = run[0];
      const last = run.at(-1);
      if (first && last && run.length >= minimum) {
        found.push({ agentId: agent.id, from: first.index, to: last.index, text: text(run) });
      }
      run = [];
    };
    for (const col of agent.cols) {
      if (matches(col)) run.push(col);
      else flush();
    }
    flush();
  }
  return found;
}
