import type { AdapterContext, Diagnostic, Known, SessionBundle, SqliteReader } from '@runwire/core';
import { makeDiagnostic } from '@runwire/core';
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

export async function* discover(ctx: AdapterContext, known: Known): AsyncIterable<SessionBundle> {
  for (const origin of OPENCODE_ORIGINS) {
    const records = await readOrigin(ctx, origin);
    if (records.diagnostics.some((d) => d.code === 'source-read-failed' && d.level === 'error')) {
      ctx.log.error(`opencode: origin ${origin} read failed (source-read-failed)`);
      const error = new Error(`opencode ${origin} source-read-failed`) as Error & { code: string };
      error.code = 'source-read-failed';
      throw error;
    }
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
    if (!table) return true;
    const rows = reader.all(`SELECT id FROM ${table} WHERE id = ?`, [id]);
    return rows.length > 0;
  } catch {
    return true;
  } finally {
    reader?.close();
  }
}
