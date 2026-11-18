import type { LaneModelData } from '../model';
import { contextIndicators, contextThreshold } from './context-threshold';
import { failureGroup, failureIndicators } from './failure-group';
import { highTierIndicators, highTierMechanical } from './high-tier-mechanical';

export type Finding = { agentId: string; from: number; to: number; text: string };

export const rules = [
  { id: 'high-tier-mechanical', indicators: highTierIndicators, detect: highTierMechanical },
  { id: 'context-threshold', indicators: contextIndicators, detect: contextThreshold },
  { id: 'failure-group', indicators: failureIndicators, detect: failureGroup },
] as const;
export type RuleId = (typeof rules)[number]['id'];

export function detect(
  model: LaneModelData,
  enabled: readonly RuleId[] = rules.map((rule) => rule.id),
  threshold = 85,
): Finding[] {
  const found: Finding[] = [];
  for (const agent of model.agents) {
    const singleAgent = { ...model, agents: [agent] };
    for (const rule of rules) {
      if (enabled.includes(rule.id)) found.push(...rule.detect(singleAgent, threshold));
    }
  }
  return found.sort((a, b) => a.from - b.from);
}
