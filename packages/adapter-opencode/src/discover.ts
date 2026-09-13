import type { AdapterContext, Diagnostic, Known, SessionBundle, SqliteReader } from '@scout/core';
import { makeDiagnostic } from '@scout/core';
import type { ComputeSessionInput } from './compute';
import { computeBundle, computeDepth } from './compute';
import {
  OPENCODE_ORIGINS,
  opencodeDataDir,
  opencodeDbPath,
  parseIdFromSourceId,
  parseOriginFromSourceId,
  sourceIdFor,
  sourceLocatorFor,
} from './paths';
import { readOrigin } from './records';

const HARNESS_ID = 'opencode';

function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const oneLine = raw.replace(/\s*\n\s*/g, ' ').trim();
  return oneLine.length > 180 ? `${oneLine.slice(0, 177)}...` : oneLine;
}

/**
 * Computes one session, converting any throw inside `computeBundle` (e.g. a
 * project resolve failure) into a `source-read-failed` stub. Matches the JSONL
 * adapters' `computeSourceBundle` (M3): `discover` must not abort the whole
 * origin because one session's fold threw.
 */
async function computeSessionBundle(input: ComputeSessionInput): Promise<SessionBundle> {
  try {
    return await computeBundle(input);
  } catch (err) {
    const { harnessId, origin, session, messages, sessionsById, ctx } = input;
    const sourceId = sourceIdFor(origin, session.id);
    const projectKey = session.directory ?? session.id;
    const diagnostic: Diagnostic = makeDiagnostic(
      'error',
      'source-read-failed',
      sanitizeErrorMessage(err),
    );
    return {
      project: { key: projectKey, name: projectKey, identity: 'cwd' },
      session: {
        id: sourceId,
        harnessId,
        projectKey,
        parentId: session.parentId ? sourceIdFor(origin, session.parentId) : undefined,
        relation: session.parentId ? 'subagent' : session.forkSessionId ? 'fork' : undefined,
        depth: computeDepth(session, sessionsById),
        agentType: session.agent,
        spawnCallId: session.spawnCallId,
        sourceId,
        sourceLocator: sourceLocatorFor(ctx, origin),
        sourcePath: sourceId,
        sourceSize: messages.length,
        sourceMtime: session.timeUpdated ?? session.timeCreated ?? 0,
      },
      steps: [],
      diagnostics: [diagnostic],
    };
  }
}

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
 * is carried as a content-free diagnostic; a session whose fold throws yields
 * a `source-read-failed` stub so the rest of the origin still streams; a
 * DB-level read failure yields nothing for that origin (the `sourceExists`
 * path retains its known sessions).
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

      yield await computeSessionBundle({
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
 * only when the session id is confirmed absent in a successfully-read DB;
 * returns `true` (retain) otherwise.
 *
 * Adapter-only hardening for M1: `fs.stat` collapses "missing" and "I/O error"
 * (EACCES/EIO) into `undefined`, so it is never consulted here. Opening a
 * missing/unreadable/corrupt/locked DB throws, and any open/read error retains
 * — a transient error never mass-deletes. Consequence: a truly deleted
 * `opencode.db` retains its rows until core `stat` can distinguish ENOENT
 * (ARCHITECTURE §6 priority). This delete path is only ever reached after a
 * full successful discovery (importAll skips removal on a mid-stream
 * `discover` throw).
 */
export async function sourceExists(
  ctx: AdapterContext,
  source: { sourceId: string; sourceLocator?: string },
): Promise<boolean> {
  const locator = source.sourceLocator;
  if (!locator) return true;

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
    // Missing file, permission, corrupt, lock: retain. Vanished-origin
    // deletion requires a positive ENOENT signal (core `stat`, follow-up).
    return true;
  } finally {
    reader?.close();
  }
}
