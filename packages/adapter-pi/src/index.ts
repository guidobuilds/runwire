import type { Capability, HarnessAdapter } from '@scout/core';
import { piAllowlist } from './allowlist';
import { discover, probe } from './discover';

/**
 * Exactly the 14 capabilities Pi can report (docs/adapters/pi.md §6). The six
 * unavailable ones (`mode`, `version`, `subagents`, `title`, `git`, `initiator`)
 * stay undeclared: three because Pi does not have the feature, three because it
 * does not persist data it computes. The contract kit fails a declared-but-
 * never-observed capability, so each of these must be observable on
 * `fixtures/pi/all`.
 */
const CAPABILITIES: readonly Capability[] = [
  'usage.perCall',
  'usage.cumulative',
  'usage.cacheWrite',
  'usage.reasoning',
  'timing',
  'model',
  'effort',
  'turns',
  'toolCalls',
  'compactions',
  'cost',
  'steps.errors',
  'steps.harness',
  'steps.toolDurations',
];

export function createPiAdapter(): HarnessAdapter {
  return {
    id: 'pi',
    displayName: 'Pi',
    adapterVersion: '1.0.0',
    capabilities: CAPABILITIES,
    allowlist: piAllowlist,
    probe,
    discover,
  };
}
