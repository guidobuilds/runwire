import type { AdapterContext, HarnessAdapter, SourceRef } from '../adapter/types';
import type { ScoutEvent } from '../events/event';
import type { ToolCategory } from '../model/trace';

/**
 * A pure in-memory adapter double used to exercise scan -> link -> rollup ->
 * aggregates -> comparability end to end without any real harness data
 * (docs/PLAN.md M1). Its scenarios are fixed and hand-authored, not parsed
 * from files, since it is not modeling a real on-disk format.
 */
export type FakeScenario = { ref: SourceRef; events: ScoutEvent[] };

const SAMPLE_TITLE = 'A fake session title';

const HARNESS_EVENT_NAMES = ['hook:PreToolUse', 'permission'] as const;

function makeScenarios(): FakeScenario[] {
  const root: FakeScenario = {
    ref: { sourceId: 'root', path: '/fake/root.json', kind: 'root', sizeBytes: 100, mtimeMs: 1000 },
    events: [
      {
        kind: 'meta',
        sourceId: 'root',
        role: 'root',
        harnessVersion: '1.0.0',
        cwd: '/home/u/proj',
        at: '2026-01-01T00:00:00Z',
        title: 'A real session title',
      },
      { kind: 'model', model: 'fake-model-a' },
      { kind: 'mode', mode: 'auto' },
      { kind: 'effort', effort: 'high' },
      {
        kind: 'usage',
        dedupeKey: 'req1',
        model: 'fake-model-a',
        output: 100,
        uncachedInput: 10,
        blocks: { text: 1 },
      },
      {
        kind: 'usage',
        dedupeKey: 'req1',
        model: 'fake-model-a',
        output: 100,
        uncachedInput: 10,
        blocks: { toolUse: 1 },
      },
      { kind: 'toolCall', name: 'read-thing', category: 'read', callId: 'c1' },
      { kind: 'toolResult', callId: 'c1', error: false },
      { kind: 'harnessEvent', name: 'hook:PreToolUse' },
      { kind: 'turn' },
      { kind: 'compaction', preTokens: 500, postTokens: 50 },
      { kind: 'cost', usd: 0.42 },
      { kind: 'observed', at: '2026-01-01T00:10:00Z' },
    ],
  };

  const child: FakeScenario = {
    ref: {
      sourceId: 'child1',
      path: '/fake/child1.json',
      kind: 'child',
      sizeBytes: 40,
      mtimeMs: 1000,
      parentHint: 'root',
    },
    events: [
      {
        kind: 'meta',
        sourceId: 'child1',
        role: 'child',
        cwd: '/home/u/proj',
        at: '2026-01-01T00:03:00Z',
      },
      {
        kind: 'link',
        parentSourceId: 'root',
        relation: 'subagent',
        agentType: 'fake-explorer',
        depth: 1,
        viaCallId: 'c1',
      },
      { kind: 'usage', dedupeKey: 'req2', model: 'fake-model-a', output: 20 },
      { kind: 'observed', at: '2026-01-01T00:04:00Z' },
    ],
  };

  const malformed: FakeScenario = {
    ref: {
      sourceId: 'malformed',
      path: '/fake/malformed.json',
      kind: 'root',
      sizeBytes: 10,
      mtimeMs: 1000,
    },
    events: [
      { kind: 'meta', sourceId: 'malformed', role: 'root', cwd: '/home/u/proj2' },
      {
        kind: 'diagnostic',
        level: 'warn',
        code: 'unknown-record-type',
        message: 'saw a record we do not understand',
      },
    ],
  };

  // Not a canary fixture (see fake-adapter.test.ts for why): just a scenario
  // that exercises the title field for the reduce()/privacy.titles pipeline test.
  const titled: FakeScenario = {
    ref: {
      sourceId: 'titled',
      path: '/fake/titled.json',
      kind: 'root',
      sizeBytes: 10,
      mtimeMs: 1000,
    },
    events: [
      {
        kind: 'meta',
        sourceId: 'titled',
        role: 'root',
        cwd: '/home/u/titled',
        title: SAMPLE_TITLE,
      },
      { kind: 'usage', dedupeKey: 'req3', output: 1 },
    ],
  };

  return [root, child, malformed, titled];
}

export function createFakeAdapter(): HarnessAdapter & { scenarios: FakeScenario[] } {
  const scenarios = makeScenarios();
  const byId = new Map(scenarios.map((s) => [s.ref.sourceId, s]));

  const explainMap: Partial<Record<string, string>> = {
    output: 'fake: sum of per-call output tokens, deduped by requestId',
    uncachedInput: 'fake: sum of per-call input tokens not served from cache',
  };

  const toolCategoryMap: Record<string, ToolCategory> = { 'read-thing': 'read' };

  return {
    id: 'fake',
    displayName: 'Fake (test-kit)',
    adapterVersion: '1.0.0',
    capabilities: [
      'usage.perCall',
      'timing',
      'model',
      'mode',
      'effort',
      'version',
      'turns',
      'toolCalls',
      'compactions',
      'subagents',
      'cost',
      'title',
      'trace.blocks',
      'trace.errors',
      'trace.harnessEvents',
    ],
    allowlist: { kind: true, sourceId: true, role: true },
    scenarios,

    async probe() {
      return { installed: true, roots: ['/fake'], notes: [] };
    },

    async *discover(): AsyncIterable<SourceRef> {
      for (const s of scenarios) yield s.ref;
    },

    async *parse(ref: SourceRef, _ctx: AdapterContext): AsyncIterable<ScoutEvent> {
      const scenario = byId.get(ref.sourceId);
      if (!scenario) return;
      for (const e of scenario.events) yield e;
    },

    explain(field) {
      return explainMap[field as string];
    },

    toolCategory(name) {
      return toolCategoryMap[name] ?? 'other';
    },

    harnessEventNames: HARNESS_EVENT_NAMES,
  };
}
