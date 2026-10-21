import type { LaneModelData } from '../model';
import { runs } from './runs';

export const highTierIndicators = ['model-changes'] as const;

export function highTierMechanical(model: LaneModelData) {
  return runs(
    model,
    (col) => col.tier === 'high' && col.mechanical,
    5,
    (cols) => `${cols.length} calls in a row on ${cols[0]?.model}, only mechanical tools`,
  );
}
