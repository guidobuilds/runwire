import type { ToolCategory } from '@scout/core';

// OpenCode tool names are lowercase (docs/adapters/opencode.md "Tool
// categories"). Total: unknown names fall back to 'other'.
const EXACT: Record<string, ToolCategory> = {
  read: 'read',
  glob: 'search',
  grep: 'search',
  edit: 'write',
  write: 'write',
  patch: 'write',
  shell: 'exec',
  execute: 'exec',
  webfetch: 'web',
  websearch: 'web',
  subagent: 'agent',
  skill: 'skill',
  question: 'plan',
};

export function opencodeToolCategory(name: string): ToolCategory {
  return EXACT[name] ?? 'other';
}
