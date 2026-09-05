// Paths built here are handed to ScoutFs (createBunFs or createMemoryFs), not
// used as opaque OS file paths directly — createMemoryFs's virtual layout is
// always '/'-joined regardless of host OS, and a real filesystem on Windows
// accepts '/' as a path separator just as readily as '\', so path.posix.join
// keeps both backends correct on every platform. (Same convention as the
// Claude Code adapter's paths.ts.)
import { join } from 'node:path/posix';
import type { AdapterContext, SqliteReader } from '@scout/core';

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

/**
 * Opaque, stable, namespaced identity (design §2.1): `opencode:<origin>:<id>`.
 * Not a filesystem path. `opencode:current:ses_x` and `opencode:legacy:ses_x`
 * are distinct even if the same session id ever appeared in both stores.
 */
export function sourceIdFor(origin: DbOrigin, id: string): string {
  return `opencode:${origin}:${id}`;
}

/** The physical DB file path (the `sourceLocator`). Many sessions share one. */
export function sourceLocatorFor(ctx: AdapterContext, origin: DbOrigin): string {
  return opencodeDbPath(ctx, origin);
}

export type DbKind = 'current' | 'legacy' | 'not-opencode';

/**
 * Schema/version discriminator: `PRAGMA user_version` is 0 for both stores, so
 * table presence in `sqlite_master` decides. `session_v2` present -> current;
 * `session` present and no `session_v2` -> legacy; neither -> not-opencode.
 * Never throws: a missing/unreadable DB returns 'not-opencode'.
 */
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
    return 'not-opencode';
  } finally {
    reader?.close();
  }
}

/** Parses the origin out of an `opencode:<origin>:<id>` sourceId. */
export function parseOriginFromSourceId(sourceId: string): DbOrigin | undefined {
  const m = /^opencode:(current|legacy):/.exec(sourceId);
  return m ? (m[1] as DbOrigin) : undefined;
}

/** Parses the harness session id out of an `opencode:<origin>:<id>` sourceId. */
export function parseIdFromSourceId(sourceId: string): string | undefined {
  const m = /^opencode:(?:current|legacy):(.*)$/.exec(sourceId);
  return m ? m[1] : undefined;
}
