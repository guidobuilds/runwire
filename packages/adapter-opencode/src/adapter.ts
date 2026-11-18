import type { Capability, HarnessAdapter } from '@runwire/core';
import { opencodeAllowlist } from './allowlist';
import { discover, probe, sourceExists } from './discover';

const CAPABILITIES: readonly Capability[] = [
  'usage.perCall',
  'usage.cumulative',
  'usage.cacheWrite',
  'usage.reasoning',
  'timing',
  'model',
  'version',
  'turns',
  'toolCalls',
  'compactions',
  'subagents',
  'cost',
  'title',
  'steps.errors',
  'steps.harness',
  'steps.toolDurations',
];

export function createOpencodeAdapter(): HarnessAdapter {
  return {
    id: 'opencode',
    displayName: 'OpenCode',
    adapterVersion: '1.2.0',
    capabilities: CAPABILITIES,
    allowlist: opencodeAllowlist,
    probe,
    discover,
    sourceExists,
  };
}
