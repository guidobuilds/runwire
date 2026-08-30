import { join } from 'node:path';
import type { AdapterContext } from '@scout/core';

export function projectsRoot(ctx: AdapterContext): string {
  return join(ctx.home, '.claude', 'projects');
}

const JSONL_EXT = '.jsonl';
const AGENT_PREFIX = 'agent-';
const IGNORED_ENTRIES = new Set(['memory', 'sessions-index.json']);

export function isRootSessionFile(entry: string): boolean {
  return entry.endsWith(JSONL_EXT) && !IGNORED_ENTRIES.has(entry);
}

export function sessionIdFromRootFile(entry: string): string {
  return entry.slice(0, -JSONL_EXT.length);
}

export function isIgnoredEntry(entry: string): boolean {
  return IGNORED_ENTRIES.has(entry);
}

export function isAgentFile(entry: string): boolean {
  return entry.startsWith(AGENT_PREFIX) && entry.endsWith(JSONL_EXT);
}

export function agentIdFromFile(entry: string): string {
  return entry.slice(AGENT_PREFIX.length, -JSONL_EXT.length);
}

export function agentMetaFilePath(projectDir: string, sessionId: string, agentId: string): string {
  return join(projectDir, sessionId, 'subagents', `${AGENT_PREFIX}${agentId}.meta.json`);
}
