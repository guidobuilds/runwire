import type { AdapterContext, Step } from '@runwire/core';
import { computeBundle } from '../compute';
import {
  type DbOrigin,
  OPENCODE_ORIGINS,
  parseIdFromSourceId,
  parseOriginFromSourceId,
  sourceIdFor,
} from '../paths';
import { type OpenCodeSession, readOrigin } from '../records';
import type { SessionDetails, SessionSummary } from './types';

const HARNESS_ID = 'opencode';

function isoFromMs(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
}

type LoadedSession = { details: SessionDetails; steps: Step[] };

async function loadSession(ctx: AdapterContext, sourceId: string): Promise<LoadedSession> {
  const origin = parseOriginFromSourceId(sourceId);
  const id = parseIdFromSourceId(sourceId);
  if (!origin || !id) {
    throw new Error(`invalid OpenCode sourceId: ${sourceId}`);
  }
  const records = await readOrigin(ctx, origin);
  const session = records.sessions.find((s) => s.id === id);
  if (!session) {
    throw new Error(`OpenCode session not found: ${sourceId}`);
  }
  const sessionsById = new Map(records.sessions.map((s) => [s.id, s]));
  const messages = records.messagesBySession.get(id) ?? [];
  const bundle = await computeBundle({
    harnessId: HARNESS_ID,
    origin,
    session,
    messages,
    sessionsById,
    projects: records.projects,
    recordDiagnostics: records.diagnostics,
    ctx,
  });
  const details: SessionDetails = {
    harnessId: 'opencode',
    sourceId,
    sourceLocator: bundle.session.sourceLocator ?? '',
    dbOrigin: origin,
    project: bundle.project,
    session: bundle.session,
    steps: bundle.steps,
    diagnostics: bundle.diagnostics,
  };
  return { details, steps: bundle.steps };
}

function summaryFrom(input: {
  session: OpenCodeSession;
  origin: DbOrigin;
  bundle: SessionDetails;
  children: string[];
}): SessionSummary {
  const s = input.bundle.session;
  return {
    sourceId: input.bundle.sourceId,
    sourceLocator: input.bundle.sourceLocator,
    dbOrigin: input.origin,
    id: s.id,
    projectKey: s.projectKey,
    title: s.title,
    agent: s.agentType,
    modelPrimary: s.modelPrimary,
    parentId: s.parentId,
    relation: s.relation,
    depth: s.depth,
    startedAt: s.startedAt,
    updatedAt: isoFromMs(input.session.timeUpdated ?? input.session.timeCreated),
    costUsd: s.costUsd,
    tokens: {
      uncachedInput: s.uncachedInput,
      cachedInput: s.cachedInput,
      cacheWrite: s.cacheWrite,
      output: s.output,
      reasoningOutput: s.reasoningOutput,
    },
    turns: s.turns,
    apiCalls: s.apiCalls,
    toolCalls: s.toolCalls,
    compactions: s.compactions,
    resumed: s.resumed,
    forkedFrom: s.forkedFrom,
    version: s.harnessVersionFirst,
    children: input.children,
  };
}

/**
 * Streams one `SessionSummary` per session across both origins, sorted by id
 * within each origin. Bounded memory: one summary (and one computed bundle)
 * is held at a time.
 */
export async function* inventorySessions(
  ctx: AdapterContext,
  opts?: { includeLegacy?: boolean },
): AsyncIterable<SessionSummary> {
  const origins: readonly DbOrigin[] =
    opts?.includeLegacy === false ? ['current'] : OPENCODE_ORIGINS;
  for (const origin of origins) {
    const records = await readOrigin(ctx, origin);
    const sessionsById = new Map(records.sessions.map((s) => [s.id, s]));
    const childrenByParent = new Map<string, string[]>();
    for (const s of records.sessions) {
      if (!s.parentId) continue;
      const list = childrenByParent.get(s.parentId) ?? [];
      list.push(sourceIdFor(origin, s.id));
      childrenByParent.set(s.parentId, list);
    }
    const sorted = [...records.sessions].sort((a, b) => a.id.localeCompare(b.id));
    for (const session of sorted) {
      const messages = records.messagesBySession.get(session.id) ?? [];
      const bundle = await computeBundle({
        harnessId: HARNESS_ID,
        origin,
        session,
        messages,
        sessionsById,
        projects: records.projects,
        recordDiagnostics: records.diagnostics,
        ctx,
      });
      yield summaryFrom({
        session,
        origin,
        bundle: {
          harnessId: 'opencode',
          sourceId: bundle.session.sourceId ?? '',
          sourceLocator: bundle.session.sourceLocator ?? '',
          dbOrigin: origin,
          project: bundle.project,
          session: bundle.session,
          steps: bundle.steps,
          diagnostics: bundle.diagnostics,
        },
        children: childrenByParent.get(session.id) ?? [],
      });
    }
  }
}

/**
 * Returns the full metadata-only, CORE-representable `SessionDetails` for one
 * source (project + session + steps + diagnostics). Never persists into CORE.
 */
export async function retrieveSession(
  ctx: AdapterContext,
  sourceId: string,
): Promise<SessionDetails> {
  const { details } = await loadSession(ctx, sourceId);
  return details;
}

/**
 * Streams `Step[]` in `seq`-ordered pages (`pageSize`, default 200). Holds one
 * page in memory at a time. No `sensitive`/`enrich` options — the connector is
 * metadata-only.
 */
export async function* retrieveSessionParts(
  ctx: AdapterContext,
  sourceId: string,
  opts?: { pageSize?: number },
): AsyncIterable<Step[]> {
  const pageSize = opts?.pageSize ?? 200;
  const { steps } = await loadSession(ctx, sourceId);
  for (let i = 0; i < steps.length; i += pageSize) {
    yield steps.slice(i, i + pageSize);
  }
}
