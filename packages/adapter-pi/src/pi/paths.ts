import { join } from 'node:path/posix';
import type { AdapterContext } from '@runwire/core';

const JSONL_EXT = '.jsonl';

export function agentDir(ctx: AdapterContext): string {
  return ctx.env.PI_CODING_AGENT_DIR ?? join(ctx.home, '.pi', 'agent');
}

export function sessionsRoot(ctx: AdapterContext): string {
  return ctx.env.PI_CODING_AGENT_SESSION_DIR ?? join(agentDir(ctx), 'sessions');
}

export function isSessionFile(entry: string): boolean {
  return entry.endsWith(JSONL_EXT);
}

export function sessionIdFromRootFile(entry: string): string {
  return entry.slice(0, -JSONL_EXT.length).replace(/^.*?_/, '');
}

export function decodeProjectDirname(name: string): string {
  const decoded = name.replace(/^--/, '').replace(/--$/, '').replace(/-/g, '/');
  return `/${decoded}`;
}
