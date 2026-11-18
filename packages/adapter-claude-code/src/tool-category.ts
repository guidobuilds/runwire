import type { ToolCategory } from '@runwire/core';

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

export function claudeCodeToolCategory(name: string): ToolCategory {
  if (name.startsWith('mcp__')) return 'mcp';
  return EXACT[name] ?? 'other';
}

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
