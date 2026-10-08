import type { Capability, HarnessAdapter } from '@runwire/core';
import { claudeCodeAllowlist } from './allowlist';
import { discover, probe } from './discover';

// Re-exported: apps/runwire/src/fixture.ts (the dev-only redaction tool) needs
// this adapter's own allowlist to know what to redact (docs/ARCHITECTURE.md §1).
export { claudeCodeAllowlist } from './allowlist';
// Re-exported for the same reason: the redactor keeps `entrypoint`/`promptSource`
// literal values, so it needs this adapter's vocabularies to bound what it keeps.
export {
  CLAUDE_CODE_ENTRYPOINTS,
  CLAUDE_CODE_PROMPT_SOURCES,
  classifyInitiator,
} from './initiator';

const CAPABILITIES: readonly Capability[] = [
  'usage.perCall',
  // Not in plan.md's own capability list, but required: session.output/
  // uncachedInput/cachedInput are always set whenever any usage is observed
  // (CAPABILITY_FIELDS['usage.cumulative']'s gate), so it is always
  // "observed" once real usage exists and an observed-but-undeclared
  // capability fails the contract kit. Same gap f1-t10 found and fixed on
  // the fake adapter (build-log-f1.md).
  'usage.cumulative',
  'usage.cacheWrite',
  'usage.reasoning',
  'timing',
  'model',
  'mode',
  'effort',
  'version',
  'turns',
  'toolCalls',
  'compactions',
  'subagents',
  'cost',
  'title',
  'git',
  'initiator',
  'steps.errors',
  'steps.harness',
  'steps.toolDurations',
];

export function createClaudeCodeAdapter(): HarnessAdapter {
  return {
    id: 'claude-code',
    displayName: 'Claude Code',
    adapterVersion: '2.1.0',
    capabilities: CAPABILITIES,
    allowlist: claudeCodeAllowlist,
    probe,
    discover,
  };
}
