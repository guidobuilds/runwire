import type { Capability, HarnessAdapter } from '@runwire/core';
import { gentleShellAllowlist } from './allowlist';
import { discover, probe } from './discover';

/**
 * Exactly the 16 capabilities Gentle Shell can report
 * (docs/adapters/gentle-shell.md §4.1): the 14 Pi declares plus `subagents`
 * and `initiator`. `mode`, `version`, `title` and `git` stay undeclared: the
 * header carries the format version, not a CLI version; there is no persisted
 * permission mode, title or git state. The contract kit fails a declared-but-
 * never-observed capability, so each of these must be observable on the
 * `fixtures/gentle-shell/all` union; `initiator` is only ever
 * non-NULL on child sessions — the fixture check that all-NULL parents pass
 * is part of .
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
  'subagents',
  'cost',
  'initiator',
  'steps.errors',
  'steps.harness',
  'steps.toolDurations',
];

/**
 * Factory ( epic): Gentle Shell identity, capabilities and allowlist.
 * `probe`/`discover` implement the §2/§9 discovery; the compute-side
 * linkage (`spawnCallId`/`depth`/`initiator`) lands with  and the CLI
 * registry with , so nothing imports this adapter at runtime yet.
 */
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
