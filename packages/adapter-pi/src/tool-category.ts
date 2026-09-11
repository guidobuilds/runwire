import type { ToolCategory } from '@scout/core';

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

/**
 * docs/adapters/pi.md §4, D31. Total: unknown names fall back to `other`,
 * which is a normal outcome and never a diagnostic. Pi's built-in tool set is
 * closed (read|bash|powershell|edit|write|grep|find|ls, docs/adapters/pi.md
 * §2.3); every other name comes from a `pi.registerTool()` extension, so the
 * vocabulary is open and no extension name may ever be required by a test.
 * Names are already lowercase. `mcp` is unreachable (Pi ships no built-in MCP)
 * and `skill` is unreachable (a skill is not a tool — D79).
 */
export function piToolCategory(name: string): ToolCategory {
  return EXACT[name] ?? 'other';
}
