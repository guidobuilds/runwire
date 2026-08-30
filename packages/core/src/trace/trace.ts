import type { ScoutEvent, UsageEventFields } from '../events/event';
import type { SessionTrace, TraceStep } from '../model/trace';
import { type UsageNumbers, zeroUsageNumbers } from '../model/usage';

const USAGE_NUMBER_KEYS = [
  'uncachedInput',
  'cachedInput',
  'cacheWrite',
  'output',
  'reasoningOutput',
] as const;

/**
 * Folds the same event stream the reducer sees into a per-step timeline
 * (docs/ARCHITECTURE.md §3.5). Pure and order-preserving; never stored.
 */
export async function buildTrace(
  id: string,
  events: AsyncIterable<ScoutEvent>,
): Promise<SessionTrace> {
  const steps: TraceStep[] = [];
  let i = 0;

  const models: string[] = [];
  const modelSeen = new Set<string>();
  let lastModel: string | undefined;
  let lastMode: string | undefined;

  let firstTimestamp: string | undefined;
  let lastTimestamp: string | undefined;

  const cum: UsageNumbers = zeroUsageNumbers();
  const usageByKey = new Map<string, TraceStep & { kind: 'call' }>(); // dedupeKey -> its call step
  let usageAnonSeq = 0;

  // A tool call awaiting its result, in emission order, keyed by callId when known.
  const pendingByCallId = new Map<string, TraceStep & { kind: 'tool' }>();
  const pendingUnkeyed: Array<TraceStep & { kind: 'tool' }> = [];

  function touch(at?: string): void {
    if (!at) return;
    if (!firstTimestamp || at < firstTimestamp) firstTimestamp = at;
    if (!lastTimestamp || at > lastTimestamp) lastTimestamp = at;
  }

  for await (const event of events) {
    switch (event.kind) {
      case 'meta':
      case 'link':
      case 'observed':
      case 'effort':
      case 'cwd':
      case 'version':
      case 'flag':
      case 'diagnostic':
        touch('at' in event ? event.at : undefined);
        break;

      case 'model': {
        touch(event.at);
        if (!modelSeen.has(event.model)) {
          modelSeen.add(event.model);
          models.push(event.model);
        }
        if (lastModel !== undefined && lastModel !== event.model) {
          steps.push({
            kind: 'model-change',
            i: i++,
            at: event.at,
            from: lastModel,
            to: event.model,
          });
        }
        lastModel = event.model;
        break;
      }

      case 'mode': {
        touch(event.at);
        if (lastMode !== undefined && lastMode !== event.mode) {
          steps.push({ kind: 'mode-change', i: i++, at: event.at, from: lastMode, to: event.mode });
        } else if (lastMode === undefined) {
          steps.push({ kind: 'mode-change', i: i++, at: event.at, to: event.mode });
        }
        lastMode = event.mode;
        break;
      }

      case 'usage': {
        touch(event.at);
        const key = event.dedupeKey ?? `__anon_${usageAnonSeq++}`;
        const blocks = {
          text: event.blocks?.text ?? 0,
          thinking: event.blocks?.thinking ?? 0,
          toolUse: event.blocks?.toolUse ?? 0,
        };

        const existing = usageByKey.get(key);
        if (!existing) {
          for (const k of USAGE_NUMBER_KEYS) cum[k] += event[k] ?? 0;
          if (event.model && !modelSeen.has(event.model)) {
            modelSeen.add(event.model);
            models.push(event.model);
          }
          const step: TraceStep & { kind: 'call' } = {
            kind: 'call',
            i: i++,
            at: event.at,
            model: event.model ?? lastModel ?? 'unknown',
            usage: extractUsage(event),
            cum: { ...cum },
            blocks,
          };
          steps.push(step);
          usageByKey.set(key, step);
        } else {
          // Same dedupeKey as an earlier call: fold this record's blocks
          // into the existing call step by direct reference; the usage
          // numbers are already counted and must not be summed again.
          existing.blocks.text += blocks.text;
          existing.blocks.thinking += blocks.thinking;
          existing.blocks.toolUse += blocks.toolUse;
        }
        break;
      }

      case 'usageTotal': {
        touch(event.at);
        break;
      }

      case 'turn': {
        touch(event.at);
        steps.push({ kind: 'turn', i: i++, at: event.at, durationMs: event.durationMs });
        break;
      }

      case 'toolCall': {
        touch(event.at);
        const step: TraceStep & { kind: 'tool' } = {
          kind: 'tool',
          i: i++,
          at: event.at,
          category: event.category,
          name: event.name,
          callId: event.callId,
          durationMs: event.durationMs,
        };
        steps.push(step);
        if (event.callId) pendingByCallId.set(event.callId, step);
        else pendingUnkeyed.push(step);
        break;
      }

      case 'toolResult': {
        touch(event.at);
        let target: (TraceStep & { kind: 'tool' }) | undefined;
        if (event.callId && pendingByCallId.has(event.callId)) {
          target = pendingByCallId.get(event.callId);
          pendingByCallId.delete(event.callId);
        } else {
          target = pendingUnkeyed.shift();
        }
        if (target) {
          target.error = event.error;
          if (event.durationMs !== undefined) target.durationMs = event.durationMs;
        }
        break;
      }

      case 'harnessEvent': {
        touch(event.at);
        steps.push({ kind: 'harness', i: i++, at: event.at, name: event.name });
        break;
      }

      case 'compaction': {
        touch(event.at);
        steps.push({
          kind: 'compaction',
          i: i++,
          at: event.at,
          preTokens: event.preTokens,
          postTokens: event.postTokens,
        });
        break;
      }

      case 'cost': {
        touch(event.at);
        break;
      }
    }
  }

  return {
    id,
    steps,
    models,
    axis: { steps: steps.length, startedAt: firstTimestamp, endedAt: lastTimestamp },
    totals: { ...cum },
  };
}

function extractUsage(fields: UsageEventFields): Partial<UsageNumbers> {
  const out: Partial<UsageNumbers> = {};
  for (const k of USAGE_NUMBER_KEYS) {
    if (fields[k] !== undefined) out[k] = fields[k];
  }
  return out;
}
