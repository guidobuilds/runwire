import type { AdapterContext, Diagnostic, SqliteReader } from '@runwire/core';
import { makeDiagnostic, project } from '@runwire/core';
import { opencodeAllowlist, sessionRowAllowlist } from './allowlist';
import { type DbKind, type DbOrigin, detectDbKind, opencodeDbPath } from './paths';
import {
  type OpenCodeMessageData,
  type OpenCodeSessionRow,
  parseMessageData,
  parseSessionRow,
} from './schema';

export type OpenCodeMessage = {
  /** The `session_message.type` column ('user' | 'assistant' | ...). */
  type: string;
  /** The original `session_message.seq` (used only to order; reindexed later). */
  seq: number;
  data: OpenCodeMessageData;
};

export type OpenCodeSession = {
  id: string;
  projectId: string;
  parentId?: string;
  /** Explicit parent tool call whose metadata names this child session. */
  spawnCallId?: string;
  forkSessionId?: string;
  directory?: string;
  title?: string;
  agent?: string;
  /** The `model` JSON string from the session row (parsed in compute). */
  model?: string;
  version?: string;
  cost?: number;
  timeCreated?: number;
  timeUpdated?: number;
  timeSuspended?: number;
  tokensInput?: number;
  tokensOutput?: number;
  tokensReasoning?: number;
  tokensCacheRead?: number;
  tokensCacheWrite?: number;
};

export type OpenCodeProject = { worktree?: string; vcs?: string };

export type OriginRecords = {
  origin: DbOrigin;
  kind: DbKind;
  sessions: OpenCodeSession[];
  messagesBySession: Map<string, OpenCodeMessage[]>;
  projects: Map<string, OpenCodeProject>;
  diagnostics: Diagnostic[];
};

function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const oneLine = raw.replace(/\s*\n\s*/g, ' ').trim();
  return oneLine.length > 180 ? `${oneLine.slice(0, 177)}...` : oneLine;
}

/**
 * Reads one OpenCode origin DB read-only, WAL-aware (never `immutable=1`),
 * projecting + schema-checking every session and message row. It never throws:
 * a bad row is skipped with a content-free diagnostic; a DB-level failure
 * yields an empty read plus a `source-read-failed` diagnostic (which the
 * `sourceExists` path treats as retain). Message `seq` is left in source order
 * here (the caller reindexes to 0..n-1).
 */
export async function readOrigin(ctx: AdapterContext, origin: DbOrigin): Promise<OriginRecords> {
  const diagnostics: Diagnostic[] = [];
  const kind = await detectDbKind(ctx, origin);
  if (kind === 'not-opencode') {
    return {
      origin,
      kind,
      sessions: [],
      messagesBySession: new Map(),
      projects: new Map(),
      diagnostics,
    };
  }
  const sessionTable = kind === 'current' ? 'session_v2' : 'session';
  const path = opencodeDbPath(ctx, origin);

  let reader: SqliteReader | undefined;
  try {
    reader = ctx.fs.openSqliteReadonly(path);

    const projectRows = reader.all<Record<string, unknown>>(
      'SELECT id, worktree, vcs FROM project',
    );
    const projects = new Map<string, OpenCodeProject>();
    for (const raw of projectRows) {
      const id = raw.id as string | undefined;
      if (!id) continue;
      projects.set(id, {
        worktree: typeof raw.worktree === 'string' ? raw.worktree : undefined,
        vcs: typeof raw.vcs === 'string' ? raw.vcs : undefined,
      });
    }

    const sessionRows = reader.all<Record<string, unknown>>(`SELECT * FROM ${sessionTable}`);
    const sessions: OpenCodeSession[] = [];
    for (const raw of sessionRows) {
      const parsed = parseSessionRow(project(raw, sessionRowAllowlist));
      if (!parsed || !parsed.id) {
        diagnostics.push(
          makeDiagnostic(
            'warn',
            'invalid-record',
            'A session row did not match the expected shape',
          ),
        );
        continue;
      }
      sessions.push(mapSessionRow(parsed));
    }

    const messageRows = reader.all<Record<string, unknown>>(
      'SELECT session_id, seq, type, data FROM session_message',
    );
    const messagesBySession = new Map<string, OpenCodeMessage[]>();
    for (const raw of messageRows) {
      const sessionId = raw.session_id as string | undefined;
      const type = raw.type as string | undefined;
      const seq = raw.seq as number | undefined;
      if (!sessionId || !type || seq === undefined) continue;
      const dataRaw = raw.data;
      let data: OpenCodeMessageData | undefined;
      if (typeof dataRaw === 'string') {
        try {
          const parsedJson: unknown = JSON.parse(dataRaw);
          data = parseMessageData(project(parsedJson, opencodeAllowlist));
        } catch {
          data = undefined;
        }
      }
      if (!data) {
        diagnostics.push(
          makeDiagnostic('warn', 'invalid-record', 'A message did not match the expected shape'),
        );
        continue;
      }
      const list = messagesBySession.get(sessionId) ?? [];
      list.push({ type, seq, data });
      messagesBySession.set(sessionId, list);
    }

    for (const list of messagesBySession.values()) list.sort((a, b) => a.seq - b.seq);
    attachSpawnCallIds(sessions, messagesBySession);

    return { origin, kind, sessions, messagesBySession, projects, diagnostics };
  } catch (err) {
    diagnostics.push(makeDiagnostic('error', 'source-read-failed', sanitizeErrorMessage(err)));
    return {
      origin,
      kind,
      sessions: [],
      messagesBySession: new Map(),
      projects: new Map(),
      diagnostics,
    };
  } finally {
    reader?.close();
  }
}

/**
 * Links only explicit OpenCode evidence: the child must declare the message's
 * owner as its parent and a `subagent` tool part must name that exact child in
 * `state.metadata.sessionID`. No timestamps, titles, agent names, or other
 * heuristics are used. CORE has one `spawnCallId` per child, so the first
 * explicit match in source order is retained; later matches remain ordinary
 * agent tool steps.
 */
export function attachSpawnCallIds(
  sessions: OpenCodeSession[],
  messagesBySession: Map<string, OpenCodeMessage[]>,
): void {
  const firstCallByParentAndChild = new Map<string, Map<string, string>>();
  for (const [parentId, messages] of messagesBySession) {
    const firstCallByChild = new Map<string, string>();
    for (const message of messages) {
      if (message.type !== 'assistant') continue;
      for (const part of message.data.content ?? []) {
        const toolName = part.name ?? part.tool;
        const childId = part.state?.metadata?.sessionID;
        if (
          part.type === 'tool' &&
          toolName === 'subagent' &&
          part.id &&
          childId &&
          !firstCallByChild.has(childId)
        ) {
          firstCallByChild.set(childId, part.id);
        }
      }
    }
    if (firstCallByChild.size > 0) firstCallByParentAndChild.set(parentId, firstCallByChild);
  }

  for (const child of sessions) {
    if (!child.parentId) continue;
    const callId = firstCallByParentAndChild.get(child.parentId)?.get(child.id);
    if (callId) child.spawnCallId = callId;
  }
}

function mapSessionRow(row: OpenCodeSessionRow): OpenCodeSession {
  return {
    id: row.id!,
    projectId: row.project_id ?? '',
    parentId: row.parent_id ?? undefined,
    forkSessionId: row.fork_session_id ?? undefined,
    directory: row.directory ?? undefined,
    title: row.title ?? undefined,
    agent: row.agent ?? undefined,
    model: row.model ?? undefined,
    version: row.version ?? undefined,
    cost: row.cost ?? undefined,
    timeCreated: row.time_created ?? undefined,
    timeUpdated: row.time_updated ?? undefined,
    timeSuspended: row.time_suspended ?? undefined,
    tokensInput: row.tokens_input ?? undefined,
    tokensOutput: row.tokens_output ?? undefined,
    tokensReasoning: row.tokens_reasoning ?? undefined,
    tokensCacheRead: row.tokens_cache_read ?? undefined,
    tokensCacheWrite: row.tokens_cache_write ?? undefined,
  };
}
