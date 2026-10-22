import { basename } from 'node:path/posix';
import type {
  AdapterContext,
  Diagnostic,
  Project,
  Session,
  SessionBundle,
  Step,
} from '@runwire/core';
import { makeDiagnostic, TOKEN_FIELDS } from '@runwire/core';
import { sessionIdFromRootFile } from './paths';
import type { PiRecord } from './schema';
import { piToolCategory } from './tool-category';

const PI_HARNESS_ID = 'pi';

export type ComputeSource = { path: string; sizeBytes: number; mtimeMs: number };

export type ResolveProjectFn = (cwd: string) => Promise<Project>;

export type ComputeBundleInput = {
  /** Full contract session id, `pi:<uuid from filename>`. */
  sessionId: string;
  source: ComputeSource;
  records: ReadonlyArray<{ record: PiRecord; line: number }>;
  /** Diagnostics already accumulated while reading the source (records.ts). */
  recordDiagnostics: readonly Diagnostic[];
  resolveProject: ResolveProjectFn;
  /** decodeProjectDirname(...) - used only when the header carries no cwd. */
  fallbackCwd?: string;
  /** The uuid in the filename, used only for the session-id-mismatch check. */
  headerUuid: string;
  /** Harness id for `session.harnessId` and the fork prefix; defaults to `pi`. */
  harnessId?: string;
  ctx: AdapterContext;
};

type TokenField = (typeof TOKEN_FIELDS)[number];

function normAt(at: string | undefined): string | undefined {
  return typeof at === 'string' && Number.isFinite(Date.parse(at))
    ? new Date(Date.parse(at)).toISOString()
    : undefined;
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

/** Entry `type` -> the finite `harness` step toolName vocabulary (pi.md §3.3). */
const HARNESS_STEP_NAME: Record<string, string> = {
  label: 'label',
  session_info: 'session-info',
  custom: 'custom',
  custom_message: 'custom-message',
};

/**
 * Folds a whole Pi source's records into a `SessionBundle` (docs/adapters/pi.md
 * §3.2/§3.3 + §5.1-§5.4). Steps are emitted in file/append order (linearization
 * option (a)): every billed API call counts, abandoned branches are spend, and
 * the active-path view stays derivable later from `parentId`. Session token
 * totals are computed as Σ over `call` steps, never copied from a Pi aggregate.
 */
export async function computeBundle(input: ComputeBundleInput): Promise<SessionBundle> {
  const { sessionId, source, records, recordDiagnostics, resolveProject, fallbackCwd, headerUuid } =
    input;
  const HARNESS_ID = input.harnessId ?? PI_HARNESS_ID;

  const diagnostics: Diagnostic[] = [...recordDiagnostics];

  // --- pre-pass: file-wide facts ---
  const header = records.find((p) => p.record.type === 'session')?.record;
  const headerCwd = header?.cwd && header.cwd.length > 0 ? header.cwd : undefined;

  if (!header) {
    diagnostics.push(
      makeDiagnostic(
        'warn',
        'missing-session-header',
        'No session header; identity was taken from the filename',
      ),
    );
  }
  if (header?.id !== undefined && header.id !== headerUuid) {
    diagnostics.push(
      makeDiagnostic(
        'info',
        'session-id-mismatch',
        'The header id differs from the uuid in the filename',
      ),
    );
  }

  const sawFirstKeptEntryIndex = records.some((p) => p.record.firstKeptEntryIndex !== undefined);
  // pi.md §8: legacy when the header is absent, the version is absent, any
  // entry carries firstKeptEntryIndex, or the entries are v1-shaped (none of
  // them carries an id/parentId at all).
  const entries = records.filter((p) => p.record.type !== 'session');
  const entriesLackIds = entries.length > 0 && entries.every((p) => p.record.id === undefined);
  const legacy =
    !header || header.version === undefined || sawFirstKeptEntryIndex || entriesLackIds;
  if (legacy) {
    diagnostics.push(
      makeDiagnostic(
        'info',
        'legacy-format',
        'A legacy (v1/v2) session file was read without migration',
      ),
    );
  }

  let cwd = headerCwd;
  if (!cwd && fallbackCwd) {
    cwd = fallbackCwd;
    diagnostics.push(
      makeDiagnostic(
        'info',
        'cwd-from-dirname',
        'No cwd observed in the header; derived from the project directory name',
      ),
    );
  } else if (!cwd && !fallbackCwd) {
    // Gentle Shell children live in a flat directory (gentle-shell.md §2), so
    // there is no dirname fallback; an absent header cwd stays unknown. Pi
    // always has the dirname fallback, so this never fires for Pi.
    diagnostics.push(
      makeDiagnostic('info', 'missing-cwd', 'No cwd observed and no dirname fallback'),
    );
  }

  const forkSource = header?.parentSession;
  const relation: Session['relation'] = forkSource ? 'fork' : undefined;
  const forkedFrom = forkSource
    ? `${HARNESS_ID}:${sessionIdFromRootFile(basename(forkSource))}`
    : undefined;

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

  let hasModeledCall = false;
  let lastModel: string | undefined;
  let modelChanges = 0;
  const modelOrder: string[] = [];
  const modelCounts = new Map<string, number>();
  const modelOutputByName = new Map<string, number>();
  // First provider observed per model name: feeds modelPrimaryProvider.
  // A session running one model name through two providers is not something the
  // harnesses do in practice; first-seen wins deterministically.
  const modelProviderByName = new Map<string, string>();
  const modelTargetsSeen = new Set<string>();
  const declaredModelTargets = new Set<string>();

  let effort: string | undefined;
  let costUsd: number | undefined;

  let callStepCount = 0;
  const tokenSums: Partial<Record<TokenField, number>> = {};
  const tokenFieldSeen = new Set<TokenField>();

  let turnCount = 0;
  let toolCallCount = 0;
  let answeredToolCallCount = 0;
  let compactionCount = 0;
  let unpairedToolResultCount = 0;
  let usageOnNonAssistantCount = 0;
  let tokenArithmeticDriftCount = 0;
  let unpricedModelCount = 0;

  const pendingByCallId = new Map<string, Step>();
  const pendingTimestampByCallId = new Map<string, number>();

  function accountUsage(usage: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    reasoning?: number;
    totalTokens?: number;
    cost?: { total?: number };
  }): void {
    if (usage.cost?.total !== undefined) costUsd = (costUsd ?? 0) + usage.cost.total;
    if (usage.totalTokens !== undefined) {
      const sum =
        (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
      if (usage.totalTokens !== sum) tokenArithmeticDriftCount++;
    }
    const tokens =
      (usage.input ?? 0) +
      (usage.output ?? 0) +
      (usage.cacheRead ?? 0) +
      (usage.cacheWrite ?? 0) +
      (usage.reasoning ?? 0);
    if (tokens > 0 && (usage.cost?.total ?? 0) === 0) unpricedModelCount++;
  }

  function sumTokens(step: Step): void {
    for (const f of TOKEN_FIELDS) {
      const v = step[f];
      if (v === undefined) continue;
      tokenFieldSeen.add(f);
      tokenSums[f] = (tokenSums[f] ?? 0) + v;
    }
  }

  /** One extra-context `call` step (§5.2): model stays undefined, like Claude's <synthetic>. */
  function pushExtraCall(at: string | undefined, usage: NonNullable<PiRecord['usage']>): void {
    const step: Step = {
      sessionId,
      seq: seq++,
      at,
      kind: 'call',
      uncachedInput: usage.input,
      cachedInput: usage.cacheRead,
      cacheWrite: usage.cacheWrite,
      output: usage.output,
      reasoningOutput: usage.reasoning,
    };
    steps.push(step);
    callStepCount++;
    sumTokens(step);
    accountUsage(usage);
    usageOnNonAssistantCount++;
  }

  for (const { record } of records) {
    touch(record.timestamp);

    switch (record.type) {
      case 'session':
        break; // header: timestamps + project + fork link only

      case 'message': {
        const message = record.message;
        if (!message) break;
        const at = normAt(record.timestamp);

        if (message.role === 'assistant') {
          const resolved = message.responseModel ?? message.model;
          const usage = message.usage;

          if (usage) {
            if (resolved !== undefined) {
              if (!modelCounts.has(resolved)) modelOrder.push(resolved);
              modelCounts.set(resolved, (modelCounts.get(resolved) ?? 0) + 1);
              if (!modelProviderByName.has(resolved)) {
                if (message.provider !== undefined)
                  modelProviderByName.set(resolved, message.provider);
              }
              if (lastModel !== undefined && lastModel !== resolved) {
                steps.push({
                  sessionId,
                  seq: seq++,
                  at,
                  kind: 'model-change',
                  fromValue: lastModel,
                  toValue: resolved,
                });
                modelChanges++;
              }
              lastModel = resolved;
              hasModeledCall = true;
              modelTargetsSeen.add(resolved);
              modelOutputByName.set(
                resolved,
                (modelOutputByName.get(resolved) ?? 0) + (usage.output ?? 0),
              );
            }
            const step: Step = {
              sessionId,
              seq: seq++,
              at,
              kind: 'call',
              model: resolved,
              modelProvider: message.provider,
              uncachedInput: usage.input,
              cachedInput: usage.cacheRead,
              cacheWrite: usage.cacheWrite,
              output: usage.output,
              reasoningOutput: usage.reasoning,
            };
            steps.push(step);
            callStepCount++;
            sumTokens(step);
            accountUsage(usage);
          }

          for (const block of message.content ?? []) {
            if (block.type !== 'toolCall' || !block.name) continue;
            const toolStep: Step = {
              sessionId,
              seq: seq++,
              at,
              kind: 'tool',
              toolCategory: piToolCategory(block.name),
              toolName: block.name,
              callId: block.id,
              model: resolved,
              modelProvider: message.provider,
            };
            steps.push(toolStep);
            toolCallCount++;
            if (block.id) {
              pendingByCallId.set(block.id, toolStep);
              if (message.timestamp !== undefined) {
                pendingTimestampByCallId.set(block.id, message.timestamp);
              }
            }
          }

          if (message.stopReason === 'error' || message.stopReason === 'aborted') {
            steps.push({
              sessionId,
              seq: seq++,
              at,
              kind: 'harness',
              toolName: message.stopReason === 'error' ? 'call-error' : 'call-aborted',
            });
          }
          break;
        }

        if (message.role === 'toolResult') {
          const callId = message.toolCallId;
          const target = callId ? pendingByCallId.get(callId) : undefined;
          if (target) {
            answeredToolCallCount++;
            if (callId) {
              pendingByCallId.delete(callId);
              const startedAt = pendingTimestampByCallId.get(callId);
              pendingTimestampByCallId.delete(callId);
              target.error = message.isError === true;
              if (startedAt !== undefined && message.timestamp !== undefined) {
                const dur = message.timestamp - startedAt;
                if (Number.isFinite(dur) && dur >= 0) target.durationMs = dur;
              }
            }
          } else {
            unpairedToolResultCount++;
          }
          if (message.usage) pushExtraCall(at, message.usage);
          break;
        }

        if (message.role === 'user') {
          steps.push({ sessionId, seq: seq++, at, kind: 'turn' });
          turnCount++;
          break;
        }
        break; // bashExecution/custom/branchSummary/compactionSummary: no step
      }

      case 'compaction': {
        steps.push({
          sessionId,
          seq: seq++,
          at: normAt(record.timestamp),
          kind: 'compaction',
          preTokens: record.tokensBefore,
          compactionTrigger: record.fromHook === true ? 'extension' : undefined,
        });
        compactionCount++;
        if (record.usage) {
          pushExtraCall(normAt(record.timestamp), record.usage);
        }
        break;
      }

      case 'branch_summary': {
        steps.push({
          sessionId,
          seq: seq++,
          at: normAt(record.timestamp),
          kind: 'harness',
          toolName: 'branch-summary',
        });
        if (record.usage) {
          pushExtraCall(normAt(record.timestamp), record.usage);
        }
        break;
      }

      case 'thinking_level_change': {
        steps.push({
          sessionId,
          seq: seq++,
          at: normAt(record.timestamp),
          kind: 'harness',
          toolName: 'thinking-level-change',
        });
        if (record.thinkingLevel !== undefined) effort = record.thinkingLevel;
        break;
      }

      case 'model_change': {
        if (record.modelId !== undefined) {
          declaredModelTargets.add(record.modelId);
          if (!hasModeledCall) lastModel = record.modelId;
        }
        break; // no step
      }

      case 'label':
      case 'session_info':
      case 'custom':
      case 'custom_message': {
        const name = HARNESS_STEP_NAME[record.type];
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
        break; // unknown entry type contributes nothing (records.ts already diagnosed it)
    }
  }

  // --- tree accounting (pi.md §5.1) ---
  // Only entry records are tree nodes. Real Pi writes the `session` header with
  // an `id` (the session uuid) that no entry ever references, so counting it
  // made every linear session look branched (B-1). Entries without ids (v1
  // files) leave this vacuous, which emits no tree diagnostic.
  const ids = new Set<string>();
  const referencedParents = new Set<string>();
  let roots = 0;
  for (const { record } of records) {
    if (record.type === 'session') continue;
    if (record.id === undefined) continue;
    ids.add(record.id);
    if (record.parentId === null || record.parentId === undefined) roots++;
    else referencedParents.add(record.parentId);
  }
  let leaves = 0;
  for (const id of ids) {
    if (!referencedParents.has(id)) leaves++;
  }
  if (roots > 1 || leaves > 1) {
    diagnostics.push(
      makeDiagnostic(
        'info',
        'branched-tree',
        `A branched session tree (${leaves} leaves); file order counts all branches`,
        { count: roots - 1 },
      ),
    );
  }

  // --- aggregated diagnostics ---
  if (unpairedToolResultCount > 0) {
    diagnostics.push(
      makeDiagnostic(
        'info',
        'unpaired-tool-result',
        `${unpairedToolResultCount} toolResult(s) had no matching pending tool call`,
        { count: unpairedToolResultCount },
      ),
    );
  }
  const unansweredToolCalls = toolCallCount - answeredToolCallCount;
  if (unansweredToolCalls > 0) {
    diagnostics.push(
      makeDiagnostic(
        'info',
        'unanswered-tool-call',
        `${unansweredToolCalls} tool call(s) were never answered`,
        { count: unansweredToolCalls },
      ),
    );
  }
  const unusedModelChanges = [...declaredModelTargets].filter(
    (t) => !modelTargetsSeen.has(t),
  ).length;
  if (unusedModelChanges > 0) {
    diagnostics.push(
      makeDiagnostic(
        'info',
        'unused-model-change',
        `${unusedModelChanges} model_change target(s) never appeared on a call step`,
        { count: unusedModelChanges },
      ),
    );
  }
  if (usageOnNonAssistantCount > 0) {
    diagnostics.push(
      makeDiagnostic(
        'info',
        'usage-on-non-assistant',
        `${usageOnNonAssistantCount} call step(s) came from compaction/branch/tool usage`,
        { count: usageOnNonAssistantCount },
      ),
    );
  }
  if (tokenArithmeticDriftCount > 0) {
    diagnostics.push(
      makeDiagnostic(
        'info',
        'token-arithmetic-drift',
        `${tokenArithmeticDriftCount} usage record(s) whose totalTokens disagreed with the 4-part sum`,
        { count: tokenArithmeticDriftCount },
      ),
    );
  }
  if (unpricedModelCount > 0) {
    diagnostics.push(
      makeDiagnostic(
        'info',
        'unpriced-model',
        `${unpricedModelCount} call(s) had tokens but a zero cost`,
        { count: unpricedModelCount },
      ),
    );
  }

  const modelPrimary = pickPrimaryModel(modelOrder, modelCounts, modelOutputByName);

  const session: Session = {
    id: sessionId,
    harnessId: HARNESS_ID,
    projectKey: project.key,
    relation,
    forkedFrom,
    depth: 0,
    cwd,
    startedAt: firstAt,
    endedAt: lastAt,
    durationMs: firstAt && lastAt ? Date.parse(lastAt) - Date.parse(firstAt) : undefined,
    modelPrimary,
    modelPrimaryProvider: modelPrimary ? modelProviderByName.get(modelPrimary) : undefined,
    modelChanges: modelOrder.length > 0 ? modelChanges : undefined,
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
    sourcePath: source.path,
    sourceSize: source.sizeBytes,
    sourceMtime: source.mtimeMs,
  };

  return { project, session, steps, diagnostics };
}
