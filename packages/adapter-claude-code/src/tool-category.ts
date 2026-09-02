import type { ToolCategory } from '@scout/core';

const EXACT: Record<string, ToolCategory> = {
  Read: 'read',
  NotebookRead: 'read',
  LS: 'read',
  Grep: 'search',
  Glob: 'search',
  ToolSearch: 'search',
  Edit: 'write',
  Write: 'write',
  MultiEdit: 'write',
  NotebookEdit: 'write',
  Bash: 'exec',
  TodoWrite: 'plan',
  EnterPlanMode: 'plan',
  ExitPlanMode: 'plan',
  AskUserQuestion: 'plan',
  Agent: 'agent',
  Task: 'agent',
  SendMessage: 'agent',
  ListAgents: 'agent',
  WebFetch: 'web',
  WebSearch: 'web',
  Skill: 'skill',
};

/** docs/adapters/claude-code.md "Tool categories". Total: unknown names fall back to 'other'. */
export function claudeCodeToolCategory(name: string): ToolCategory {
  if (name.startsWith('mcp__')) return 'mcp';
  return EXACT[name] ?? 'other';
}

/**
 * hook:<hookEvent> only (the tool name after the colon is dropped so the
 * vocabulary stays finite), plus the fixed non-hook event names.
 */
export const CLAUDE_CODE_HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'UserPromptSubmit',
  'SessionStart',
  'SessionEnd',
  'Notification',
  'PreCompact',
  'SubagentStart',
  'SubagentStop',
  'TeammateIdle',
] as const;

export const claudeCodeHarnessEventNames: readonly string[] = [
  ...CLAUDE_CODE_HOOK_EVENTS.map((h) => `hook:${h}`),
  'permission',
  'plan-mode',
  'plan-mode-exit',
  'auto-mode',
];

export function hookEventName(hookName: string | undefined): string | undefined {
  if (!hookName) return undefined;
  const event = hookName.split(':')[0];
  return event ? `hook:${event}` : undefined;
}
