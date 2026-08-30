import type { Metric } from './metric';
import type { Counts, Usage } from './usage';

export type SessionRollup = {
  id: string;
  exclusive: { usage: Usage; counts: Counts };
  inclusive: { usage: Usage; counts: Counts & { subagents: Metric } };
  descendants: number;
};
