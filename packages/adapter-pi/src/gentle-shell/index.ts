import type { Capability, HarnessAdapter } from '@runwire/core';
import { gentleShellAllowlist } from './allowlist';
import { discover, probe } from './discover';

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
  'subagents',
  'cost',
  'initiator',
  'steps.errors',
  'steps.harness',
  'steps.toolDurations',
];

export function createGentleShellAdapter(): HarnessAdapter {
  return {
    id: 'gentle-shell',
    displayName: 'Gentle Shell',
    adapterVersion: '1.0.0',
    capabilities: CAPABILITIES,
    allowlist: gentleShellAllowlist,
    probe,
    discover,
  };
}
