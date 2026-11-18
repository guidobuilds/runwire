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
  let stat: Awaited<ReturnType<AdapterContext['fs']['stat']>>;
  try {
    stat = await ctx.fs.stat(path);
  } catch (e) {
    console.error(
      'DEBUG-DETECT-THROW',
      JSON.stringify({ path, code: (e as { code?: string }).code, message: String(e) }),
    );
    throw e;
  }
  if (process.env.RUNWIRE_DEBUG === '1') {
    console.error('DEBUG-DETECT', JSON.stringify({ path, stat: stat ?? null }));
  }
  if (!stat) return 'not-opencode';
  let reader: SqliteReader | undefined;
  try {
    reader = ctx.fs.openSqliteReadonly(path);
    const tables = reader.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    );
    const names = new Set(tables.map((t) => t.name));
    if (process.env.RUNWIRE_DEBUG === '1') {
      console.error('DEBUG-TABLES', JSON.stringify({ path, names: [...names] }));
    }
    if (names.has('session_v2')) return 'current';
    if (names.has('session') && !names.has('session_v2')) return 'legacy';
    return 'not-opencode';
  } catch (e) {
    console.error(
      'DEBUG-OPEN-THROW',
      JSON.stringify({ path, code: (e as { code?: string }).code, message: String(e) }),
    );
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
