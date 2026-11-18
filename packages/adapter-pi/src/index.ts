import type { Capability, HarnessAdapter } from '@runwire/core';
import { createGentleShellAdapter } from './gentle-shell';
import { piAllowlist } from './pi/allowlist';
import { discover, probe } from './pi/discover';

export { createGentleShellAdapter };

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
    adapterVersion: '1.1.0',
    capabilities: CAPABILITIES,
    allowlist: piAllowlist,
    probe,
    discover,
  };
}
