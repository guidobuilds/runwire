import type {
  AdapterContext,
  Diagnostic,
  Project,
  Session,
  SessionBundle,
  Step,
} from '@scout/core';
import { makeDiagnostic, TOKEN_FIELDS } from '@scout/core';
import { classifyInitiator } from './initiator';
import type { ClaudeCodeRecord } from './schema';
import { claudeCodeToolCategory, hookEventName } from './tool-category';

export type ComputeLink = {
  parentId?: string;
  relation?: 'subagent';
  agentType?: string;
  depth: number;
  spawnCallId?: string;
};

export type ComputeSource = { path: string; sizeBytes: number; mtimeMs: number };

export type ResolveProjectFn = (cwd: string) => Promise<Project>;

export type ComputeBundleInput = {
  harnessId: string;
  /** Full contract session id, e.g. `claude-code:<uuid>` or `.../<agentId>`. */
  sessionId: string;
  /** Only root sources are checked for the unexpected-sidechain diagnostic. */
  isRoot: boolean;
  source: ComputeSource;
  link: ComputeLink;
  records: ReadonlyArray<{ record: ClaudeCodeRecord; line: number }>;
  /** Diagnostics already accumulated while reading the source (records.ts). */
  recordDiagnostics: readonly Diagnostic[];
  resolveProject: ResolveProjectFn;
  /** cwdFromProjectDirname(...) - used only when no record carries a cwd. */
  fallbackCwd?: string;
  ctx: AdapterContext;
};

type TokenField = (typeof TOKEN_FIELDS)[number];

function isFiniteTimestamp(at: string | undefined): at is string {
  return typeof at === 'string' && Number.isFinite(Date.parse(at));
}

/** Normalizes to a strict ISO-8601 string (docs/ARCHITECTURE.md §3 "ISO-8601 UTC", plan P8). */
function normAt(at: string | undefined): string | undefined {
  return isFiniteTimestamp(at) ? new Date(Date.parse(at)).toISOString() : undefined;
}

function attachmentHarnessName(record: ClaudeCodeRecord): string | undefined {
  const type = record.attachment?.type;
  if (type === 'hook_success' || type === 'hook_system_message') {
    return hookEventName(record.attachment?.hookName);
  }
  if (type === 'command_permissions') return 'permission';
  if (type === 'plan_mode') return 'plan-mode';
  if (type === 'plan_mode_exit') return 'plan-mode-exit';
  if (type === 'auto_mode') return 'auto-mode';
  return undefined;
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

/**
 * Folds a whole source's records into a `SessionBundle` (docs/ARCHITECTURE.md
 * §3/§4). Single pass, plus the small look-ahead pre-pass every adapter needs
 * for file-wide facts (does this file report turn_duration at all? what is
 * the initial cwd/title?) - the same two-pass shape the old parse.ts used,
 * folded here with the old reduce.ts + trace.ts logic (plan.md P8/P9/P11/P12/P13).
 */
export async function computeBundle(input: ComputeBundleInput): Promise<SessionBundle> {
  const {
    harnessId,
    sessionId,
    isRoot,
    source,
    link,
    records,
    recordDiagnostics,
    resolveProject,
    fallbackCwd,
    ctx,
  } = input;

  const diagnostics: Diagnostic[] = [...recordDiagnostics];

  // --- pre-pass: file-wide facts ---
  const hasTurnDuration = records.some(
    (p) => p.record.type === 'system' && p.record.subtype === 'turn_duration',
  );
  const initialCwd = records.find((p) => p.record.cwd)?.record.cwd;
  const initialBranch = records.find((p) => p.record.gitBranch)?.record.gitBranch;
  const lastAiTitleRecord = [...records].reverse().find((p) => p.record.type === 'ai-title');
  const title = ctx.privacy.titles ? lastAiTitleRecord?.record.aiTitle : undefined;
  const sawUnexpectedSidechain = isRoot && records.some((p) => p.record.isSidechain === true);
  const entrypoint = records.find((p) => p.record.entrypoint)?.record.entrypoint;
  const dispatched = records.some((p) => p.record.type === 'agent-setting');

  if (sawUnexpectedSidechain) {
    diagnostics.push(
      makeDiagnostic(
        'warn',
        'unexpected-sidechain',
        'A root source contained isSidechain:true records',
      ),
    );
  }

  let cwd = initialCwd;
  if (!cwd && fallbackCwd) {
    cwd = fallbackCwd;
    diagnostics.push(
      makeDiagnostic(
        'info',
        'cwd-from-dirname',
        'No cwd observed; derived from the project directory name',
      ),
    );
  }

  const project: Project = cwd
    ? await resolveProject(cwd)
    : { key: sessionId, name: sessionId, identity: 'cwd' };

  // --- main pass ---
  const steps: Step[] = [];
  let seq = 0;

  let firstAt: string | undefined;
  let lastAt: string | undefined;
  function touch(at: string | undefined): void {
    const iso = normAt(at);
    if (!iso) return;
    if (!firstAt || iso < firstAt) firstAt = iso;
    if (!lastAt || iso > lastAt) lastAt = iso;
  }

  let versionFirst: string | undefined;
  let versionLast: string | undefined;

  let lastModel: string | undefined;
  let modelChanges = 0;
  const modelOrder: string[] = [];
  const modelCounts = new Map<string, number>();
  const modelOutputByName = new Map<string, number>();

  let lastMode: string | undefined;
  let modeChanges = 0;
  const modeOrder: string[] = [];
  const modeCounts = new Map<string, number>();

  let effort: string | undefined;
  let costUsd: number | undefined;

  const usageSeenKeys = new Set<string>();
  let anonSeq = 0;
  let callStepCount = 0;
  const tokenSums: Partial<Record<TokenField, number>> = {};
  const tokenFieldSeen = new Set<TokenField>();

  let turnCount = 0;
  let toolCallCount = 0;
  let compactionCount = 0;
  let unpairedToolResultCount = 0;

  const pendingByCallId = new Map<string, Step>();

  for (const { record } of records) {
    touch(record.timestamp);

    if (record.version) {
      versionFirst ??= record.version;
      versionLast = record.version;
    }

    switch (record.type) {
      case 'assistant': {
        const message = record.message;
        const model = message?.model;
        const isSynthetic = model === '<synthetic>';
        const at = normAt(record.timestamp);

        if (model && !isSynthetic) {
          if (!modelCounts.has(model)) modelOrder.push(model);
          modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
          if (lastModel !== undefined && lastModel !== model) {
            steps.push({
              sessionId,
              seq: seq++,
              at,
              kind: 'model-change',
              fromValue: lastModel,
              toValue: model,
            });
            modelChanges++;
          }
          lastModel = model;
        }

        if (record.effort) effort = record.effort;

        const usage = message?.usage;
        if (usage) {
          const key = record.requestId ?? `__anon_${anonSeq++}`;
          if (!usageSeenKeys.has(key)) {
            usageSeenKeys.add(key);
            const step: Step = {
              sessionId,
              seq: seq++,
              at,
              kind: 'call',
              model: isSynthetic ? undefined : model,
              uncachedInput: usage.input_tokens,
              cachedInput: usage.cache_read_input_tokens,
              cacheWrite: usage.cache_creation_input_tokens,
              output: usage.output_tokens,
              reasoningOutput: usage.output_tokens_details?.thinking_tokens,
            };
            steps.push(step);
            callStepCount++;
            for (const f of TOKEN_FIELDS) {
              const v = step[f];
              if (v === undefined) continue;
              tokenFieldSeen.add(f);
              tokenSums[f] = (tokenSums[f] ?? 0) + v;
            }
            if (!isSynthetic && model) {
              modelOutputByName.set(
                model,
                (modelOutputByName.get(model) ?? 0) + (usage.output_tokens ?? 0),
              );
            }
          }
        }

        for (const block of message?.content ?? []) {
          if (block.type === 'tool_use' && block.name) {
            const toolCategory = claudeCodeToolCategory(block.name);
            const toolStep: Step = {
              sessionId,
              seq: seq++,
              at,
              kind: 'tool',
              toolCategory,
              toolName: block.name,
              callId: block.id,
              skillName:
                toolCategory === 'skill'
                  ? (block as { input?: { skill?: string } }).input?.skill
                  : undefined,
              model: isSynthetic ? undefined : model,
            };
            steps.push(toolStep);
            toolCallCount++;
            if (block.id) pendingByCallId.set(block.id, toolStep);
          }
        }
        break;
      }

      case 'user': {
        const content = record.message?.content ?? [];
        const toolResults = content.filter((b) => b.type === 'tool_result');
        for (const block of toolResults) {
          const target = block.tool_use_id ? pendingByCallId.get(block.tool_use_id) : undefined;
          if (target) {
            pendingByCallId.delete(block.tool_use_id as string);
            target.error = block.is_error === true;
            const resultAt = normAt(record.timestamp);
            if (target.at && resultAt) {
              const dur = Date.parse(resultAt) - Date.parse(target.at);
              if (Number.isFinite(dur)) target.durationMs = dur;
            }
          } else {
            unpairedToolResultCount++;
          }
        }
        if (!hasTurnDuration && !record.isMeta && toolResults.length === 0) {
          steps.push({ sessionId, seq: seq++, at: normAt(record.timestamp), kind: 'turn' });
          turnCount++;
        }
        break;
      }

      case 'system': {
        if (record.subtype === 'compact_boundary') {
          steps.push({
            sessionId,
            seq: seq++,
            at: normAt(record.timestamp),
            kind: 'compaction',
            compactionTrigger: record.compactMetadata?.trigger,
            preTokens: record.compactMetadata?.preTokens,
            postTokens: record.compactMetadata?.postTokens,
          });
          compactionCount++;
        } else if (record.subtype === 'turn_duration') {
          steps.push({
            sessionId,
            seq: seq++,
            at: normAt(record.timestamp),
            kind: 'turn',
            durationMs: record.durationMs,
          });
          turnCount++;
        }
        break;
      }

      case 'permission-mode': {
        if (record.permissionMode) {
          const at = normAt(record.timestamp);
          if (!modeCounts.has(record.permissionMode)) modeOrder.push(record.permissionMode);
          modeCounts.set(record.permissionMode, (modeCounts.get(record.permissionMode) ?? 0) + 1);
          if (lastMode !== undefined && lastMode !== record.permissionMode) {
            steps.push({
              sessionId,
              seq: seq++,
              at,
              kind: 'mode-change',
              fromValue: lastMode,
              toValue: record.permissionMode,
            });
            modeChanges++;
          }
          lastMode = record.permissionMode;
        }
        break;
      }

      case 'cost-state': {
        if (record.totalCostUSD !== undefined) costUsd = record.totalCostUSD;
        break;
      }

      case 'ai-title':
        break; // handled in the pre-pass

      case 'attachment': {
        const name = attachmentHarnessName(record);
        if (name) {
          steps.push({
            sessionId,
            seq: seq++,
            at: normAt(record.timestamp),
            kind: 'harness',
            toolName: name,
          });
        }
        break;
      }

      default:
        break; // unknown/known-ignored types contribute nothing (records.ts already diagnosed them)
    }
  }

  if (unpairedToolResultCount > 0) {
    diagnostics.push(
      makeDiagnostic(
        'info',
        'unpaired-tool-result',
        `${unpairedToolResultCount} tool_result record(s) had no matching pending tool call`,
        { count: unpairedToolResultCount },
      ),
    );
  }

  const initiator = classifyInitiator({ entrypoint, dispatched });
  const modelPrimary = pickPrimaryModel(modelOrder, modelCounts, modelOutputByName);
  const modePrimary = modeOrder.length > 0 ? pickMostFrequent(modeOrder, modeCounts) : undefined;

  const session: Session = {
    id: sessionId,
    harnessId,
    projectKey: project.key,
    parentId: link.parentId,
    relation: link.relation,
    depth: link.depth,
    agentType: link.agentType,
    spawnCallId: link.spawnCallId,
    title,
    cwd,
    gitBranch: initialBranch,
    startedAt: firstAt,
    endedAt: lastAt,
    durationMs: firstAt && lastAt ? Date.parse(lastAt) - Date.parse(firstAt) : undefined,
    modelPrimary,
    modelChanges: modelOrder.length > 0 ? modelChanges : undefined,
    modePrimary,
    modeChanges: modeOrder.length > 0 ? modeChanges : undefined,
    effort,
    uncachedInput: tokenFieldSeen.has('uncachedInput') ? tokenSums.uncachedInput : undefined,
    cachedInput: tokenFieldSeen.has('cachedInput') ? tokenSums.cachedInput : undefined,
    cacheWrite: tokenFieldSeen.has('cacheWrite') ? tokenSums.cacheWrite : undefined,
    output: tokenFieldSeen.has('output') ? tokenSums.output : undefined,
    reasoningOutput: tokenFieldSeen.has('reasoningOutput') ? tokenSums.reasoningOutput : undefined,
    turns: turnCount > 0 ? turnCount : undefined,
    apiCalls: callStepCount > 0 ? callStepCount : undefined,
    toolCalls: toolCallCount > 0 ? toolCallCount : undefined,
    compactions: compactionCount > 0 ? compactionCount : undefined,
    costUsd,
    initiatorKind: initiator?.kind,
    initiatorSurface: initiator?.surface,
    initiatorAutomation: initiator?.automation,
    harnessVersionFirst: versionFirst,
    harnessVersionLast: versionLast,
    sourcePath: source.path,
    sourceSize: source.sizeBytes,
    sourceMtime: source.mtimeMs,
  };

  return { project, session, steps, diagnostics };
}
