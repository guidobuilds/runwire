import type { Capability, HarnessAdapter } from '@runwire/core';
import { opencodeAllowlist } from './allowlist';
import { discover, probe, sourceExists } from './discover';

// Metadata-only capabilities, observed on the `all` fixture. OpenCode stores
// no per-session `mode`/`effort`/`git`/`initiator`, so those are NOT declared.
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
    adapterVersion: '1.1.0',
    capabilities: CAPABILITIES,
    allowlist: opencodeAllowlist,
    probe,
    discover,
    sourceExists,
  };
}
