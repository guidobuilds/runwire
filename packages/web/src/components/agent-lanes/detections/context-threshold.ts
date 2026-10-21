import type { LaneModelData } from '../model';
import { runs } from './runs';

export const contextIndicators = ['context'] as const;

export function contextThreshold(model: LaneModelData, threshold = 85) {
  return runs(
    model,
    (col) => col.contextPercent !== null && col.contextPercent >= threshold,
    3,
    (cols) => {
      const peak = Math.max(...cols.map((col) => col.contextPercent ?? 0));
      const tokens = Math.max(...cols.map((col) => col.promptInput ?? 0));
      const formatted = tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens);
      return `${cols.length} calls above ${threshold}%, peak ${Math.round(peak)}% (${formatted} tokens)`;
    },
  );
}
