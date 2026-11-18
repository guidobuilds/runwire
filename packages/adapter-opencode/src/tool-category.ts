import type { ToolCategory } from '@runwire/core';

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
