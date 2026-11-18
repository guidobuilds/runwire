import type { Capability, HarnessAdapter } from '@runwire/core';
import { claudeCodeAllowlist } from './allowlist';
import { discover, probe } from './discover';

export { claudeCodeAllowlist } from './allowlist';
export {
  CLAUDE_CODE_ENTRYPOINTS,
  CLAUDE_CODE_PROMPT_SOURCES,
  classifyInitiator,
} from './initiator';

const CAPABILITIES: readonly Capability[] = [
  'usage.perCall',
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
