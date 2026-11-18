import type { ToolCategory } from '@runwire/core';

const EXACT: Record<string, ToolCategory> = {
  read: 'read',
  ls: 'read',
  read_symbol: 'read',
  grep: 'search',
  find: 'search',
  edit: 'write',
  write: 'write',
  bash: 'exec',
  powershell: 'exec',
  todo: 'plan',
  subagent_run: 'agent',
  subagent_list_agents: 'agent',
};

export function piToolCategory(name: string): ToolCategory {
  return EXACT[name] ?? 'other';
}
