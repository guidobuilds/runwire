import type {
  AdapterContext,
  Diagnostic,
  Project,
  Session,
  SessionBundle,
  Step,
} from '@runwire/core';
import { makeDiagnostic, TOKEN_FIELDS } from '@runwire/core';
import type { DbOrigin } from './paths';
import { sourceIdFor, sourceLocatorFor } from './paths';
import { resolveOpencodeProject } from './project';
import type { OpenCodeMessage, OpenCodeProject, OpenCodeSession } from './records';
import { opencodeToolCategory } from './tool-category';

export type ComputeSessionInput = {
  harnessId: string;
  origin: DbOrigin;
  session: OpenCodeSession;
  messages: OpenCodeMessage[];
  sessionsById: Map<string, OpenCodeSession>;
  projects: Map<string, OpenCodeProject>;
  recordDiagnostics: readonly Diagnostic[];
  ctx: AdapterContext;
};

type TokenField = (typeof TOKEN_FIELDS)[number];

function isoFromMs(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
}

function pickMostFrequent(
  order: readonly string[],
  counts: Map<string, number>,
): string | undefined {
  let best: string | undefined;
  let bestCount = -1;
  for (const name of order) {
    const c = counts.get(name) ?? 0;
    if (c > bestCount) {
      best = name;
      bestCount = c;
    }
  }
  return best;
}

function pickPrimaryModel(
  order: readonly string[],
  counts: Map<string, number>,
  outputByName: Map<string, number>,
): string | undefined {
  if (order.length === 0) return undefined;
  const anyOutput = [...outputByName.values()].some((v) => v > 0);
  if (anyOutput) {
    let best: string | undefined;
    let bestOutput = -1;
    for (const name of order) {
      const o = outputByName.get(name) ?? 0;
      if (o > bestOutput) {
        best = name;
        bestOutput = o;
      }
    }
    if (best) return best;
  }
  return pickMostFrequent(order, counts);
}

export function computeDepth(
  session: OpenCodeSession,
  sessionsById: Map<string, OpenCodeSession>,
): number {
  let depth = 0;
  let cur = session;
  const seen = new Set<string>();
  while (cur.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = sessionsById.get(cur.parentId);
    if (!parent) break;
    depth++;
    cur = parent;
  }
  return depth;
}

export async function computeBundle(input: ComputeSessionInput): Promise<SessionBundle> {
  const { harnessId, origin, session, messages, sessionsById, projects, recordDiagnostics, ctx } =
    input;

  const diagnostics: Diagnostic[] = [...recordDiagnostics];

  const sourceId = sourceIdFor(origin, session.id);

  const project: Project = await resolveSessionProject(session, projects, ctx);

  const steps: Step[] = [];
  let seq = 0;

  let firstAt: number | undefined;
  let lastAt: number | undefined;
  function touch(ms: number | undefined): void {
    if (ms === undefined || !Number.isFinite(ms)) return;
    if (firstAt === undefined || ms < firstAt) firstAt = ms;
    if (lastAt === undefined || ms > lastAt) lastAt = ms;
  }

  const modelOrder: string[] = [];
  const modelCounts = new Map<string, number>();
  const modelOutputByName = new Map<string, number>();
  const modelProviderByName = new Map<string, string>();

  let callStepCount = 0;
  let toolCallCount = 0;
  let compactionCount = 0;
  let turnCount = 0;
  let modelChanges = 0;
  const tokenSums: Partial<Record<TokenField, number>> = {};
  const tokenFieldSeen = new Set<TokenField>();
  const unknownTypes = new Map<string, number>();

  for (const msg of messages) {
    const created = msg.data.time?.created;
    const completed = msg.data.time?.completed;
    touch(created);
    touch(completed);
    const at = isoFromMs(created ?? completed);

    switch (msg.type) {
      case 'user': {
        steps.push({ sessionId: sourceId, seq: seq++, at, kind: 'turn' });
        turnCount++;
        break;
      }

      case 'assistant': {
        const modelId = msg.data.model?.id;
        const providerId = msg.data.model?.providerID;
        if (modelId) {
          if (!modelCounts.has(modelId)) modelOrder.push(modelId);
          modelCounts.set(modelId, (modelCounts.get(modelId) ?? 0) + 1);
          if (!modelProviderByName.has(modelId) && providerId !== undefined) {
            modelProviderByName.set(modelId, providerId);
          }
        }

        const tokens = msg.data.tokens;
        if (tokens) {
          const step: Step = {
            sessionId: sourceId,
            seq: seq++,
            at,
            kind: 'call',
            model: modelId,
            modelProvider: providerId,
            uncachedInput: tokens.input,
            cachedInput: tokens.cache?.read,
            cacheWrite: tokens.cache?.write,
            output: tokens.output,
            reasoningOutput: tokens.reasoning,
          };
          steps.push(step);
          callStepCount++;
          for (const f of TOKEN_FIELDS) {
            const v = step[f];
            if (v === undefined) continue;
            tokenFieldSeen.add(f);
            tokenSums[f] = (tokenSums[f] ?? 0) + v;
          }
          if (modelId) {
            modelOutputByName.set(
              modelId,
              (modelOutputByName.get(modelId) ?? 0) + (tokens.output ?? 0),
            );
          }
        }

        for (const part of msg.data.content ?? []) {
          const toolName = part.name ?? part.tool;
          if (part.type === 'tool' && toolName) {
            const toolCreated = part.time?.created ?? created;
            const toolCompleted = part.time?.completed ?? completed;
            const toolStep: Step = {
              sessionId: sourceId,
              seq: seq++,
              at: isoFromMs(toolCreated ?? toolCompleted),
              kind: 'tool',
              toolCategory: opencodeToolCategory(toolName),
              toolName,
              callId: part.id,
              error: part.state?.status === 'error',
              model: modelId ?? undefined,
              modelProvider: modelId !== undefined ? providerId : undefined,
            };
            if (toolCompleted !== undefined && toolCreated !== undefined) {
              const dur = toolCompleted - toolCreated;
              if (Number.isFinite(dur) && dur >= 0) toolStep.durationMs = dur;
            }
            steps.push(toolStep);
            toolCallCount++;
          }
        }
        break;
      }

      case 'model-switched': {
        steps.push({
          sessionId: sourceId,
          seq: seq++,
          at,
          kind: 'model-change',
          fromValue: msg.data.previous?.id,
          toValue: msg.data.model?.id,
        });
        modelChanges++;
        break;
      }

      case 'compaction': {
        steps.push({
          sessionId: sourceId,
          seq: seq++,
          at,
          kind: 'compaction',
          compactionTrigger: msg.data.reason,
        });
        compactionCount++;
        break;
      }

      case 'agent-switched': {
        steps.push({
          sessionId: sourceId,
          seq: seq++,
          at,
          kind: 'harness',
          toolName: 'agent-switched',
        });
        break;
      }

      case 'system': {
        steps.push({ sessionId: sourceId, seq: seq++, at, kind: 'harness', toolName: 'system' });
        break;
      }

      case 'location-switched': {
        steps.push({
          sessionId: sourceId,
          seq: seq++,
          at,
          kind: 'harness',
          toolName: 'location-switched',
        });
        break;
      }

      case 'synthetic':
        break;

      default:
        unknownTypes.set(msg.type, (unknownTypes.get(msg.type) ?? 0) + 1);
        break;
    }
  }

  if (unknownTypes.size > 0) {
    const count = [...unknownTypes.values()].reduce((a, b) => a + b, 0);
    diagnostics.push(
      makeDiagnostic(
        'info',
        'unknown-record-type',
        `Saw ${count} record(s) of an unrecognized type`,
        {
          count,
        },
      ),
    );
  }

  const modelPrimary = pickPrimaryModel(modelOrder, modelCounts, modelOutputByName);

  const uncachedInput = tokenFieldSeen.has('uncachedInput') ? tokenSums.uncachedInput : undefined;
  const cachedInput = tokenFieldSeen.has('cachedInput') ? tokenSums.cachedInput : undefined;
  const cacheWrite = tokenFieldSeen.has('cacheWrite') ? tokenSums.cacheWrite : undefined;
  const output = tokenFieldSeen.has('output') ? tokenSums.output : undefined;
  const reasoningOutput = tokenFieldSeen.has('reasoningOutput')
    ? tokenSums.reasoningOutput
    : undefined;

  if (
    (session.tokensInput !== undefined &&
      uncachedInput !== undefined &&
      session.tokensInput !== uncachedInput) ||
    (session.tokensOutput !== undefined &&
      output !== undefined &&
      session.tokensOutput !== output) ||
    (session.tokensReasoning !== undefined &&
      reasoningOutput !== undefined &&
      session.tokensReasoning !== reasoningOutput) ||
    (session.tokensCacheRead !== undefined &&
      cachedInput !== undefined &&
      session.tokensCacheRead !== cachedInput) ||
    (session.tokensCacheWrite !== undefined &&
      cacheWrite !== undefined &&
      session.tokensCacheWrite !== cacheWrite)
  ) {
    diagnostics.push(
      makeDiagnostic(
        'info',
        'token-total-drift',
        'Harness-reported token totals differ from the sum of call-step tokens',
      ),
    );
  }

  const depth = computeDepth(session, sessionsById);
  const relation = session.parentId ? 'subagent' : session.forkSessionId ? 'fork' : undefined;

  const sessionObj: Session = {
    id: sourceId,
    harnessId,
    projectKey: project.key,
    parentId: session.parentId ? sourceIdFor(origin, session.parentId) : undefined,
    relation,
    depth,
    agentType: session.agent,
    spawnCallId: session.spawnCallId,
    title: ctx.privacy.titles ? session.title : undefined,
    cwd: session.directory,
    startedAt: isoFromMs(firstAt),
    endedAt: isoFromMs(lastAt),
    durationMs: firstAt !== undefined && lastAt !== undefined ? lastAt - firstAt : undefined,
    modelPrimary,
    modelPrimaryProvider: modelPrimary ? modelProviderByName.get(modelPrimary) : undefined,
    modelChanges: modelChanges > 0 ? modelChanges : undefined,
    uncachedInput,
    cachedInput,
    cacheWrite,
    output,
    reasoningOutput,
    turns: turnCount > 0 ? turnCount : undefined,
    apiCalls: callStepCount > 0 ? callStepCount : undefined,
    toolCalls: toolCallCount > 0 ? toolCallCount : undefined,
    compactions: compactionCount > 0 ? compactionCount : undefined,
    costUsd: session.cost,
    resumed: session.timeSuspended !== undefined && session.timeSuspended !== null,
    forkedFrom: session.forkSessionId ? sourceIdFor(origin, session.forkSessionId) : undefined,
    harnessVersionFirst: session.version,
    harnessVersionLast: session.version,
    sourceId,
    sourceLocator: sourceLocatorFor(ctx, origin),
    sourcePath: sourceId,
    sourceSize: messages.length,
    sourceMtime: session.timeUpdated ?? session.timeCreated ?? 0,
  };

  return { project, session: sessionObj, steps, diagnostics };
}

async function resolveSessionProject(
  session: OpenCodeSession,
  projects: Map<string, OpenCodeProject>,
  ctx: AdapterContext,
): Promise<Project> {
  const proj = projects.get(session.projectId);
  const cwd = session.directory ?? session.id;
  return resolveOpencodeProject({ cwd, repoRootHint: proj?.worktree }, { fs: ctx.fs });
}
