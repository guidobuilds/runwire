import type { Capability, HarnessAdapter } from '@scout/core';
import { claudeCodeAllowlist } from './allowlist';
import { discover, probe } from './discover';

// Re-exported: apps/scout/src/fixture.ts (the dev-only redaction tool) needs
// this adapter's own allowlist to know what to redact (docs/ARCHITECTURE.md §1).
export { claudeCodeAllowlist } from './allowlist';

import { parse } from './parse';
import { claudeCodeHarnessEventNames, claudeCodeToolCategory } from './tool-category';

const CAPABILITIES: readonly Capability[] = [
  'usage.perCall',
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
  'trace.blocks',
  'trace.errors',
  'trace.harnessEvents',
];

const EXPLAIN: Partial<Record<string, string>> = {
  uncachedInput:
    'usage.input_tokens (Anthropic semantics: excludes cached-read and cache-write tokens)',
  cachedInput: 'usage.cache_read_input_tokens',
  cacheWrite: 'usage.cache_creation_input_tokens',
  output: 'usage.output_tokens (includes reasoning/thinking tokens)',
  reasoningOutput: 'usage.output_tokens_details.thinking_tokens (subset of output)',
  turns:
    'human prompts inferred from non-meta user records with no tool_result block (or system turn_duration records, in newer CLI versions)',
  apiCalls: 'distinct requestId values across assistant records',
  toolCalls: 'tool_use content blocks on assistant records',
  compactions: 'system records with subtype compact_boundary',
  cost: 'the harness-reported totalCostUSD from the last cost-state record; may include subagent usage (unverified)',
};

export function createClaudeCodeAdapter(): HarnessAdapter {
  return {
    id: 'claude-code',
    displayName: 'Claude Code',
    adapterVersion: '1.0.0',
    capabilities: CAPABILITIES,
    allowlist: claudeCodeAllowlist,
    probe,
    discover,
    parse,
    explain: (field) => EXPLAIN[field as string],
    toolCategory: claudeCodeToolCategory,
    harnessEventNames: claudeCodeHarnessEventNames,
  };
}
