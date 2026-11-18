import { join } from 'node:path';
import type { AdapterContext, SqliteReader } from '@runwire/core';

export type DbOrigin = 'current' | 'legacy';

export const OPENCODE_ORIGINS: readonly DbOrigin[] = ['current', 'legacy'];

export function opencodeDataDir(ctx: AdapterContext): string {
  return join(ctx.home, '.local', 'share', 'opencode');
}

export function opencodeDbPath(ctx: AdapterContext, origin: DbOrigin): string {
  return origin === 'current'
    ? join(opencodeDataDir(ctx), 'opencode.db')
    : join(opencodeDataDir(ctx), 'opencode-tui-v2.db');
}

export function sourceIdFor(origin: DbOrigin, id: string): string {
  return `opencode:${origin}:${id}`;
}

export function sourceLocatorFor(ctx: AdapterContext, origin: DbOrigin): string {
  return opencodeDbPath(ctx, origin);
}

export type DbKind = 'current' | 'legacy' | 'not-opencode' | 'unreadable';

export async function detectDbKind(ctx: AdapterContext, origin: DbOrigin): Promise<DbKind> {
  const path = opencodeDbPath(ctx, origin);
  const stat = await ctx.fs.stat(path);
  if (!stat) return 'not-opencode';
  let reader: SqliteReader | undefined;
  try {
    reader = ctx.fs.openSqliteReadonly(path);
    const tables = reader.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    );
    const names = new Set(tables.map((t) => t.name));
    if (names.has('session_v2')) return 'current';
    if (names.has('session') && !names.has('session_v2')) return 'legacy';
    return 'not-opencode';
  } catch {
    return 'unreadable';
  } finally {
    reader?.close();
  }
}

export function parseOriginFromSourceId(sourceId: string): DbOrigin | undefined {
  const m = /^opencode:(current|legacy):/.exec(sourceId);
  return m ? (m[1] as DbOrigin) : undefined;
}

export function parseIdFromSourceId(sourceId: string): string | undefined {
  const m = /^opencode:(?:current|legacy):(.*)$/.exec(sourceId);
  return m ? m[1] : undefined;
}
