import type { AdapterContext, FsStat, Known, SessionBundle, SqliteReader } from '@scout/core';
import { computeBundle } from './compute';
import {
  OPENCODE_ORIGINS,
  opencodeDataDir,
  opencodeDbPath,
  parseIdFromSourceId,
  parseOriginFromSourceId,
  sourceIdFor,
} from './paths';
import { readOrigin } from './records';

const HARNESS_ID = 'opencode';

export async function probe(
  ctx: AdapterContext,
): Promise<{ installed: boolean; roots: string[]; notes: string[] }> {
  const dataDir = opencodeDataDir(ctx);
  const notes: string[] = [];
  let installed = false;
  for (const origin of OPENCODE_ORIGINS) {
    const path = opencodeDbPath(ctx, origin);
    const stat = await ctx.fs.stat(path);
    if (!stat) {
      notes.push(`${origin}: ${path} not found`);
      continue;
    }
    installed = true;
    const count = await countSessions(ctx, path);
    notes.push(`${origin}: ${path} (${count} sessions)`);
  }
  if (!installed) return { installed: false, roots: [], notes: [`${dataDir} not found`] };
  return { installed: true, roots: [dataDir], notes };
}

async function countSessions(ctx: AdapterContext, path: string): Promise<number> {
  let reader: SqliteReader | undefined;
  try {
    reader = ctx.fs.openSqliteReadonly(path);
    const tables = reader.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    );
    const names = new Set(tables.map((t) => t.name));
    const table = names.has('session_v2')
      ? 'session_v2'
      : names.has('session')
        ? 'session'
        : undefined;
    if (!table) return 0;
    const rows = reader.all<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`);
    return rows[0]?.c ?? 0;
  } catch {
    return 0;
  } finally {
    reader?.close();
  }
}

/**
 * Streams one metadata-only `SessionBundle` per session across BOTH origins
 * (current then legacy), sorted by id within each origin, skipping a source
 * whose `sourceId` matches `known` at `{size,mtime}`. Never throws: a bad row
 * is carried as a content-free diagnostic; a DB-level read failure yields
 * nothing for that origin (the `sourceExists` path retains its known sessions).
 */
export async function* discover(ctx: AdapterContext, known: Known): AsyncIterable<SessionBundle> {
  for (const origin of OPENCODE_ORIGINS) {
    const records = await readOrigin(ctx, origin);
    const sessionsById = new Map(records.sessions.map((s) => [s.id, s]));
    const sorted = [...records.sessions].sort((a, b) => a.id.localeCompare(b.id));

    for (const session of sorted) {
      const sourceId = sourceIdFor(origin, session.id);
      const messages = records.messagesBySession.get(session.id) ?? [];
      const sourceSize = messages.length;
      const sourceMtime = session.timeUpdated ?? session.timeCreated ?? 0;
      const k = known.get(sourceId);
      if (k !== undefined && k.size === sourceSize && k.mtime === sourceMtime) continue;

      yield await computeBundle({
        harnessId: HARNESS_ID,
        origin,
        session,
        messages,
        sessionsById,
        projects: records.projects,
        recordDiagnostics: records.diagnostics,
        ctx,
      });
    }
  }
}

/**
 * Explicit per-source existence check (design §2.6). Returns `false` (delete)
 * ONLY when the origin DB file is confirmed absent (`fs.stat(sourceLocator)`
 * is undefined) or when the session id is confirmed absent in a successfully
 * read DB; returns `true` (retain) on any DB open/read/stat error so a
 * transient error or an unreadable store never mass-deletes. This delete path
 * is only ever reached after a full successful discovery (importAll skips
 * removal on a mid-stream `discover` throw).
 */
export async function sourceExists(
  ctx: AdapterContext,
  source: { sourceId: string; sourceLocator?: string },
): Promise<boolean> {
  const locator = source.sourceLocator;
  if (!locator) return true;

  let stat: FsStat | undefined;
  try {
    stat = await ctx.fs.stat(locator);
  } catch {
    return true; // stat error -> retain (transient/permission)
  }
  if (stat === undefined) return false; // origin DB file confirmed absent -> delete that origin's sessions

  const origin = parseOriginFromSourceId(source.sourceId);
  const id = parseIdFromSourceId(source.sourceId);
  if (!origin || !id) return true;

  let reader: SqliteReader | undefined;
  try {
    reader = ctx.fs.openSqliteReadonly(locator);
    const tables = reader.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    );
    const names = new Set(tables.map((t) => t.name));
    const table = names.has('session_v2')
      ? 'session_v2'
      : names.has('session')
        ? 'session'
        : undefined;
    if (!table) return true; // not an OpenCode DB -> retain
    const rows = reader.all(`SELECT id FROM ${table} WHERE id = ?`, [id]);
    return rows.length > 0; // present -> keep; confirmed absent -> delete
  } catch {
    return true; // DB open/read error -> retain (never mass-delete)
  } finally {
    reader?.close();
  }
}
