import type { ScoutEvent, UsageEventFields } from '../events/event';
import { type Diagnostic, makeDiagnostic } from '../model/diagnostic';
import type { HarnessId } from '../model/harness';
import { type Metric, minConfidence } from '../model/metric';
import type { Initiator, SessionRelation } from '../model/session';
import type { Counts, Usage } from '../model/usage';

export type ReducedSession = {
  sourceId: string;
  harness: HarnessId;
  harnessVersion?: { first: string; last: string };
  parentSourceId?: string;
  relation?: SessionRelation;
  depthHint?: number;
  viaCallId?: string;
  agentType?: string;
  initiator?: Metric<Initiator>;
  title?: { value: string; contentDerived: true };
  cwd: { first: string; all: string[] };
  git?: { branch?: string; commit?: string; remote?: string };
  timing: { startedAt?: Metric<string>; endedAt?: Metric<string>; durationMs?: Metric };
  model: { primary?: Metric<string>; all: string[]; changes: number };
  mode?: { primary?: Metric<string>; all: string[]; changes: number };
  effort?: Metric<string>;
  flags: { resumed?: boolean; forkedFrom?: string; versionChanged?: boolean };
  usage: Usage;
  counts: Counts;
  cost?: Metric<{ usd: number }>;
  diagnostics: Diagnostic[];
};

export type ReduceContext = { harness: HarnessId; path: string; privacyTitles: boolean };

const USAGE_NUMBER_KEYS = [
  'uncachedInput',
  'cachedInput',
  'cacheWrite',
  'output',
  'reasoningOutput',
] as const;
type UsageNumberKey = (typeof USAGE_NUMBER_KEYS)[number];

function extractUsageNumberFields(e: UsageEventFields): UsageEventFields {
  const out: UsageEventFields = {};
  for (const k of USAGE_NUMBER_KEYS) {
    if (e[k] !== undefined) out[k] = e[k];
  }
  return out;
}

const CROSS_CHECK_TOLERANCE = 0.05;

export async function reduce(
  events: AsyncIterable<ScoutEvent>,
  ctx: ReduceContext,
): Promise<ReducedSession> {
  let sourceId: string | undefined;
  const diagnostics: Diagnostic[] = [];

  let firstTimestamp: string | undefined;
  let lastTimestamp: string | undefined;
  let timestampCount = 0;

  const modelCounts = new Map<string, number>();
  const modelOutputByName = new Map<string, number>();
  const modelOrder: string[] = [];
  let modelChanges = 0;
  let lastModel: string | undefined;

  const modeCounts = new Map<string, number>();
  const modeOrder: string[] = [];
  let modeChanges = 0;
  let lastMode: string | undefined;

  let effort: string | undefined;
  const cwdAll: string[] = [];
  let versionFirst: string | undefined;
  let versionLast: string | undefined;

  let git: { branch?: string; commit?: string; remote?: string } | undefined;
  let title: { value: string; contentDerived: true } | undefined;
  let parentSourceId: string | undefined;
  let relation: SessionRelation | undefined;
  let depthHint: number | undefined;
  let viaCallId: string | undefined;
  let agentType: string | undefined;
  let initiator: Metric<Initiator> | undefined;

  const usageByKey = new Map<string, UsageEventFields>();
  let usageAnonSeq = 0;
  const usageDerivedFields = new Set<keyof Usage>();
  let apiCallCount = 0;

  let usageTotalLast: UsageEventFields | undefined;
  let usageTotalDerivedFields = new Set<keyof Usage>();

  let turnCount = 0;
  let sawTurnEvent = false;
  let toolCallCount = 0;
  let compactionCount = 0;

  let costUsd: number | undefined;
  let resumed = false;
  let forkedFrom: string | undefined;

  function touchTimestamp(at?: string): void {
    if (!at) return;
    timestampCount++;
    if (!firstTimestamp || at < firstTimestamp) firstTimestamp = at;
    if (!lastTimestamp || at > lastTimestamp) lastTimestamp = at;
  }

  for await (const event of events) {
    switch (event.kind) {
      case 'meta': {
        sourceId = event.sourceId;
        if (event.harnessVersion) {
          versionFirst ??= event.harnessVersion;
          versionLast = event.harnessVersion;
        }
        if (event.cwd) cwdAll.push(event.cwd);
        if (event.title && ctx.privacyTitles) title = { value: event.title, contentDerived: true };
        if (event.git) git = { ...event.git };
        touchTimestamp(event.at);
        break;
      }
      case 'link': {
        parentSourceId = event.parentSourceId;
        relation = event.relation;
        agentType ??= event.agentType;
        depthHint = event.depth;
        viaCallId = event.viaCallId;
        break;
      }
      case 'initiator': {
        // First one wins: an adapter describes the session's initiator once.
        // No touchTimestamp - the event carries no `at` by design.
        initiator ??= {
          value: {
            kind: event.initiatorKind,
            surface: event.surface,
            ...(event.automation ? { automation: event.automation } : {}),
          },
          confidence: event.confidence,
          source: `${ctx.harness}/initiator`,
        };
        break;
      }
      case 'observed': {
        touchTimestamp(event.at);
        break;
      }
      case 'model': {
        touchTimestamp(event.at);
        if (!modelCounts.has(event.model)) modelOrder.push(event.model);
        modelCounts.set(event.model, (modelCounts.get(event.model) ?? 0) + 1);
        if (lastModel !== undefined && lastModel !== event.model) modelChanges++;
        lastModel = event.model;
        break;
      }
      case 'mode': {
        touchTimestamp(event.at);
        if (!modeCounts.has(event.mode)) modeOrder.push(event.mode);
        modeCounts.set(event.mode, (modeCounts.get(event.mode) ?? 0) + 1);
        if (lastMode !== undefined && lastMode !== event.mode) modeChanges++;
        lastMode = event.mode;
        break;
      }
      case 'effort': {
        touchTimestamp(event.at);
        effort = event.effort;
        break;
      }
      case 'cwd': {
        touchTimestamp(event.at);
        cwdAll.push(event.cwd);
        break;
      }
      case 'version': {
        touchTimestamp(event.at);
        versionFirst ??= event.version;
        versionLast = event.version;
        break;
      }
      case 'usage': {
        touchTimestamp(event.at);
        const key = event.dedupeKey ?? `__anon_${usageAnonSeq++}`;
        const isNewKey = !usageByKey.has(key);
        // A repeated dedupeKey means the harness wrote the SAME call's usage
        // more than once (e.g. Claude Code splits one response across
        // several records sharing a requestId) - keep the numbers from the
        // first occurrence only. Summing here would double-count exactly
        // the bug this dedupe exists to prevent.
        if (isNewKey) {
          usageByKey.set(key, extractUsageNumberFields(event));
          apiCallCount++;
          if (event.model) {
            if (!modelCounts.has(event.model)) modelOrder.push(event.model);
            modelCounts.set(event.model, (modelCounts.get(event.model) ?? 0) + 1);
            const attributed = event.output ?? 0;
            modelOutputByName.set(
              event.model,
              (modelOutputByName.get(event.model) ?? 0) + attributed,
            );
          }
        }
        for (const f of event.derived ?? []) usageDerivedFields.add(f);
        break;
      }
      case 'usageTotal': {
        touchTimestamp(event.at);
        usageTotalLast = { ...event };
        usageTotalDerivedFields = new Set(event.derived ?? []);
        break;
      }
      case 'turn': {
        touchTimestamp(event.at);
        sawTurnEvent = true;
        turnCount++;
        break;
      }
      case 'toolCall': {
        touchTimestamp(event.at);
        toolCallCount++;
        break;
      }
      case 'toolResult': {
        touchTimestamp(event.at);
        break;
      }
      case 'harnessEvent': {
        touchTimestamp(event.at);
        break;
      }
      case 'compaction': {
        touchTimestamp(event.at);
        compactionCount++;
        break;
      }
      case 'cost': {
        touchTimestamp(event.at);
        costUsd = event.usd;
        break;
      }
      case 'flag': {
        if (event.flag === 'resumed') resumed = true;
        else forkedFrom = event.value;
        break;
      }
      case 'diagnostic': {
        diagnostics.push(
          makeDiagnostic({
            level: event.level,
            code: event.code,
            message: event.message,
            harness: ctx.harness,
            path: ctx.path,
            line: event.line,
            count: event.count,
          }),
        );
        break;
      }
    }
  }

  if (!sourceId) {
    throw new Error(
      `reduce(): source at ${ctx.path} produced no 'meta' event (adapters must emit meta first)`,
    );
  }

  // --- usage ---
  const dedupedUsage: UsageEventFields = {};
  for (const fields of usageByKey.values()) {
    for (const k of USAGE_NUMBER_KEYS) {
      const v = fields[k];
      if (v === undefined) continue;
      dedupedUsage[k] = (dedupedUsage[k] ?? 0) + v;
    }
  }

  const hasPerCall = usageByKey.size > 0;
  const hasTotal = usageTotalLast !== undefined;

  let usage: Usage = {};
  if (hasPerCall) {
    usage = usageToMetric(dedupedUsage, usageDerivedFields, {
      confidence: 'high',
      source: `${ctx.harness}/usage#dedupe`,
    });

    if (hasTotal && usageTotalLast) {
      const total = usageTotalLast;
      const a = dedupedUsage.output ?? 0;
      const b = total.output ?? 0;
      const mismatch = b === 0 ? a !== 0 : Math.abs(a - b) / b > CROSS_CHECK_TOLERANCE;
      if (mismatch) {
        usage = usageToMetric(dedupedUsage, usageDerivedFields, {
          confidence: 'low',
          source: `${ctx.harness}/usage#dedupe`,
          note: 'usage-total-mismatch',
        });
        diagnostics.push(
          makeDiagnostic({
            level: 'warn',
            code: 'usage-total-mismatch',
            message: 'Deduped per-call usage and the last reported total disagree by more than 5%',
            harness: ctx.harness,
            path: ctx.path,
          }),
        );
      }
    }
  } else if (hasTotal && usageTotalLast) {
    usage = usageToMetric(usageTotalLast, usageTotalDerivedFields, {
      confidence: 'medium',
      source: `${ctx.harness}/usageTotal`,
      note: 'cumulative total reported by harness',
    });
  }

  if (usage.uncachedInput || usage.cachedInput) {
    const uc = usage.uncachedInput?.value ?? 0;
    const ci = usage.cachedInput?.value ?? 0;
    const cw = usage.cacheWrite?.value ?? 0;
    usage.totalInput = {
      value: uc + ci + cw,
      confidence: minConfidence(
        [
          usage.uncachedInput?.confidence,
          usage.cachedInput?.confidence,
          usage.cacheWrite?.confidence,
        ].filter((c): c is NonNullable<typeof c> => c !== undefined),
      ),
      source: `${ctx.harness}/derived#totalInput`,
      note: 'derived: uncachedInput + cachedInput + cacheWrite',
    };
  }

  // --- counts ---
  const counts: Counts = {};
  if (sawTurnEvent) {
    counts.turns = { value: turnCount, confidence: 'high', source: `${ctx.harness}/turn` };
  }
  if (hasPerCall) {
    counts.apiCalls = {
      value: apiCallCount,
      confidence: 'high',
      source: `${ctx.harness}/usage#dedupe`,
    };
  }
  if (toolCallCount > 0) {
    counts.toolCalls = {
      value: toolCallCount,
      confidence: 'high',
      source: `${ctx.harness}/toolCall`,
    };
  }
  if (compactionCount > 0) {
    counts.compactions = {
      value: compactionCount,
      confidence: 'high',
      source: `${ctx.harness}/compaction`,
    };
  }

  // --- timing ---
  const timing: ReducedSession['timing'] = {};
  if (timestampCount >= 2 && firstTimestamp && lastTimestamp) {
    timing.startedAt = {
      value: firstTimestamp,
      confidence: 'high',
      source: `${ctx.harness}/observed`,
    };
    timing.endedAt = {
      value: lastTimestamp,
      confidence: 'high',
      source: `${ctx.harness}/observed`,
    };
    timing.durationMs = {
      value: Date.parse(lastTimestamp) - Date.parse(firstTimestamp),
      confidence: 'high',
      source: `${ctx.harness}/derived#duration`,
    };
  } else if (timestampCount === 1 && firstTimestamp) {
    timing.startedAt = {
      value: firstTimestamp,
      confidence: 'low',
      source: `${ctx.harness}/observed`,
      note: 'single-timestamp',
    };
  }

  // --- model / mode ---
  const modelPrimaryName = pickPrimary(modelOrder, modelCounts, modelOutputByName);
  const model: ReducedSession['model'] = {
    all: modelOrder,
    changes: modelChanges,
    ...(modelPrimaryName
      ? {
          primary: {
            value: modelPrimaryName,
            confidence: modelChanges > 0 ? 'medium' : 'high',
            source: `${ctx.harness}/model`,
            ...(modelChanges > 0 ? { note: `changed ${modelChanges} times` } : {}),
          },
        }
      : {}),
  };

  let mode: ReducedSession['mode'];
  if (modeOrder.length > 0) {
    const modePrimaryName = pickMostFrequent(modeOrder, modeCounts);
    mode = {
      all: modeOrder,
      changes: modeChanges,
      ...(modePrimaryName
        ? {
            primary: {
              value: modePrimaryName,
              confidence: modeChanges > 0 ? 'medium' : 'high',
              source: `${ctx.harness}/mode`,
              ...(modeChanges > 0 ? { note: `changed ${modeChanges} times` } : {}),
            },
          }
        : {}),
    };
  }

  const cwdFirst = cwdAll[0];
  if (!cwdFirst) {
    diagnostics.push(
      makeDiagnostic({
        level: 'info',
        code: 'no-cwd',
        message: 'No cwd was observed for this source',
        harness: ctx.harness,
        path: ctx.path,
      }),
    );
  }

  return {
    sourceId,
    harness: ctx.harness,
    ...(versionFirst && versionLast
      ? { harnessVersion: { first: versionFirst, last: versionLast } }
      : {}),
    parentSourceId,
    relation,
    depthHint,
    viaCallId,
    agentType,
    initiator,
    title,
    cwd: { first: cwdFirst ?? '', all: [...new Set(cwdAll)] },
    git,
    timing,
    model,
    mode,
    ...(effort
      ? { effort: { value: effort, confidence: 'high', source: `${ctx.harness}/effort` } }
      : {}),
    flags: {
      ...(resumed ? { resumed: true } : {}),
      ...(forkedFrom ? { forkedFrom } : {}),
      ...(versionFirst && versionLast && versionFirst !== versionLast
        ? { versionChanged: true }
        : {}),
    },
    usage,
    counts,
    ...(costUsd !== undefined
      ? { cost: { value: { usd: costUsd }, confidence: 'high', source: `${ctx.harness}/cost` } }
      : {}),
    diagnostics,
  };
}

function usageToMetric(
  fields: UsageEventFields,
  derived: Set<keyof Usage>,
  base: { confidence: Metric['confidence']; source: string; note?: string },
): Usage {
  const out: Usage = {};
  for (const k of USAGE_NUMBER_KEYS as readonly UsageNumberKey[]) {
    const v = fields[k];
    if (v === undefined) continue;
    const isDerived = derived.has(k);
    out[k] = {
      value: v,
      confidence: isDerived ? 'medium' : base.confidence,
      source: base.source,
      note: isDerived ? `derived: ${k}` : base.note,
    };
  }
  return out;
}

function pickMostFrequent(order: string[], counts: Map<string, number>): string | undefined {
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

function pickPrimary(
  order: string[],
  counts: Map<string, number>,
  outputByName: Map<string, number>,
): string | undefined {
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
