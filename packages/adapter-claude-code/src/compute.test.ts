import { describe, expect, test } from 'bun:test';
import type { AdapterContext, Project } from '@scout/core';
import type { ComputeBundleInput, ComputeLink } from './compute';
import { computeBundle } from './compute';
import type { ClaudeCodeRecord } from './schema';

function rec(partial: Record<string, unknown>): { record: ClaudeCodeRecord; line: number } {
  return { record: partial as ClaudeCodeRecord, line: 1 };
}

function ctxWith(titles = true): AdapterContext {
  return {
    home: '/home/u',
    platform: 'linux',
    env: {},
    fs: {
      stat: async () => undefined,
      readdir: async () => [],
      readFile: async () => undefined,
      openStream: () => new ReadableStream(),
      openSqliteReadonly: () => {
        throw new Error('not used');
      },
    },
    privacy: { titles },
    log: { info() {}, warn() {}, error() {} },
  };
}

async function fakeResolveProject(cwd: string): Promise<Project> {
  return { key: cwd, name: cwd, identity: 'cwd' };
}

const BASE_LINK: ComputeLink = { depth: 0 };

function baseInput(
  records: Array<{ record: ClaudeCodeRecord; line: number }>,
  overrides: Partial<ComputeBundleInput> = {},
): ComputeBundleInput {
  return {
    harnessId: 'claude-code',
    sessionId: 'claude-code:s1',
    isRoot: true,
    source: { path: '/home/u/.claude/projects/proj/s1.jsonl', sizeBytes: 100, mtimeMs: 1000 },
    link: BASE_LINK,
    records,
    recordDiagnostics: [],
    resolveProject: fakeResolveProject,
    ctx: ctxWith(),
    ...overrides,
  };
}

function assistantWithUsage(opts: {
  requestId?: string;
  model?: string;
  output?: number;
  uncachedInput?: number;
  at?: string;
  toolUse?: { id: string; name: string };
}) {
  const content: Record<string, unknown>[] = [];
  if (opts.toolUse) {
    content.push({ type: 'tool_use', id: opts.toolUse.id, name: opts.toolUse.name });
  }
  return rec({
    type: 'assistant',
    requestId: opts.requestId,
    timestamp: opts.at,
    message: {
      model: opts.model ?? 'claude-opus-5',
      usage: { input_tokens: opts.uncachedInput ?? 1, output_tokens: opts.output ?? 1 },
      content,
    },
  });
}

describe('computeBundle - usage dedupe (the medium-fixture regression, at unit scale)', () => {
  test('sums usage once per requestId, not once per record', async () => {
    const bundle = await computeBundle(
      baseInput([
        assistantWithUsage({ requestId: 'req1', output: 100, at: '2026-01-01T00:00:00.000Z' }),
        assistantWithUsage({ requestId: 'req1', output: 100, at: '2026-01-01T00:00:01.000Z' }),
        assistantWithUsage({ requestId: 'req2', output: 50, at: '2026-01-01T00:00:02.000Z' }),
      ]),
    );
    expect(bundle.session.output).toBe(150);
    expect(bundle.session.apiCalls).toBe(2);
    expect(bundle.steps.filter((s) => s.kind === 'call')).toHaveLength(2);
  });

  test('records without a requestId are each unique', async () => {
    const bundle = await computeBundle(
      baseInput([
        assistantWithUsage({ output: 10, at: '2026-01-01T00:00:00.000Z' }),
        assistantWithUsage({ output: 20, at: '2026-01-01T00:00:01.000Z' }),
      ]),
    );
    expect(bundle.session.output).toBe(30);
    expect(bundle.session.apiCalls).toBe(2);
  });

  test('a duplicate requestId still emits its own tool_use step (dedupe is usage-only)', async () => {
    const bundle = await computeBundle(
      baseInput([
        rec({
          type: 'assistant',
          requestId: 'req1',
          timestamp: '2026-01-01T00:00:00.000Z',
          message: { model: 'claude-opus-5', usage: { output_tokens: 5 }, content: [] },
        }),
        rec({
          type: 'assistant',
          requestId: 'req1',
          timestamp: '2026-01-01T00:00:01.000Z',
          message: {
            model: 'claude-opus-5',
            content: [{ type: 'tool_use', id: 't1', name: 'Read' }],
          },
        }),
      ]),
    );
    expect(bundle.steps.filter((s) => s.kind === 'call')).toHaveLength(1);
    expect(bundle.steps.filter((s) => s.kind === 'tool')).toHaveLength(1);
  });

  test('a <synthetic> model keeps usage but excludes it from model tallies', async () => {
    const bundle = await computeBundle(
      baseInput([
        assistantWithUsage({ model: '<synthetic>', output: 5, at: '2026-01-01T00:00:00Z' }),
      ]),
    );
    expect(bundle.session.output).toBe(5);
    const call = bundle.steps.find((s) => s.kind === 'call');
    expect(call?.model).toBeUndefined();
    expect(bundle.session.modelPrimary).toBeUndefined();
  });
});

describe('computeBundle - model primary and changes', () => {
  test('primary model is the one with the most output; changes counts transitions only', async () => {
    const bundle = await computeBundle(
      baseInput([
        assistantWithUsage({
          requestId: 'r1',
          model: 'haiku',
          output: 5,
          at: '2026-01-01T00:00:00Z',
        }),
        assistantWithUsage({
          requestId: 'r2',
          model: 'opus',
          output: 500,
          at: '2026-01-01T00:00:01Z',
        }),
        assistantWithUsage({
          requestId: 'r3',
          model: 'haiku',
          output: 1,
          at: '2026-01-01T00:00:02Z',
        }),
      ]),
    );
    expect(bundle.session.modelPrimary).toBe('opus');
    expect(bundle.session.modelChanges).toBe(2);
    expect(bundle.steps.filter((s) => s.kind === 'model-change')).toHaveLength(2);
  });

  test('a single model has zero changes, and no model-change step is emitted for the first value', async () => {
    const bundle = await computeBundle(
      baseInput([assistantWithUsage({ requestId: 'r1', model: 'opus', output: 5 })]),
    );
    expect(bundle.session.modelChanges).toBe(0);
    expect(bundle.steps.some((s) => s.kind === 'model-change')).toBe(false);
  });
});

describe('computeBundle - mode primary and changes', () => {
  test('mode primary is the most frequent mode; no mode-change step for the first mode observed', async () => {
    const bundle = await computeBundle(
      baseInput([
        rec({ type: 'permission-mode', permissionMode: 'auto', timestamp: '2026-01-01T00:00:00Z' }),
        rec({ type: 'permission-mode', permissionMode: 'plan', timestamp: '2026-01-01T00:00:01Z' }),
        rec({ type: 'permission-mode', permissionMode: 'auto', timestamp: '2026-01-01T00:00:02Z' }),
      ]),
    );
    expect(bundle.session.modePrimary).toBe('auto');
    expect(bundle.session.modeChanges).toBe(2); // auto->plan, plan->auto (not the initial auto)
    expect(bundle.steps.filter((s) => s.kind === 'mode-change')).toHaveLength(2);
  });

  test('no mode records leaves modePrimary/modeChanges undefined, not zero', async () => {
    const bundle = await computeBundle(baseInput([]));
    expect(bundle.session.modePrimary).toBeUndefined();
    expect(bundle.session.modeChanges).toBeUndefined();
  });
});

describe('computeBundle - turns', () => {
  test('turns come from turn_duration records when the file has any, ignoring user heuristics', async () => {
    const bundle = await computeBundle(
      baseInput([
        rec({
          type: 'system',
          subtype: 'turn_duration',
          durationMs: 500,
          timestamp: '2026-01-01T00:00:00Z',
        }),
        rec({ type: 'user', timestamp: '2026-01-01T00:00:01Z', message: { content: [] } }),
      ]),
    );
    expect(bundle.session.turns).toBe(1);
    const turn = bundle.steps.find((s) => s.kind === 'turn');
    expect(turn?.durationMs).toBe(500);
  });

  test('turns fall back to non-meta user records with no tool_result block when there is no turn_duration', async () => {
    const bundle = await computeBundle(
      baseInput([
        rec({
          type: 'user',
          isMeta: true,
          timestamp: '2026-01-01T00:00:00Z',
          message: { content: [] },
        }),
        rec({ type: 'user', timestamp: '2026-01-01T00:00:01Z', message: { content: [] } }),
        rec({
          type: 'user',
          timestamp: '2026-01-01T00:00:02Z',
          message: { content: [{ type: 'tool_result', tool_use_id: 'x' }] },
        }),
      ]),
    );
    expect(bundle.session.turns).toBe(1);
  });
});

describe('computeBundle - tool pairing', () => {
  test('a call/result pair gets error and durationMs; strict by tool_use_id', async () => {
    const bundle = await computeBundle(
      baseInput([
        rec({
          type: 'assistant',
          timestamp: '2026-01-01T00:00:00.000Z',
          message: { content: [{ type: 'tool_use', id: 'c1', name: 'Bash' }] },
        }),
        rec({
          type: 'user',
          timestamp: '2026-01-01T00:00:02.000Z',
          message: { content: [{ type: 'tool_result', tool_use_id: 'c1', is_error: true }] },
        }),
      ]),
    );
    const tool = bundle.steps.find((s) => s.kind === 'tool');
    expect(tool?.error).toBe(true);
    expect(tool?.durationMs).toBe(2000);
    expect(bundle.session.toolCalls).toBe(1);
  });

  test('a tool_result with no matching pending call is not a step and is aggregated as a diagnostic', async () => {
    const bundle = await computeBundle(
      baseInput([
        rec({
          type: 'user',
          timestamp: '2026-01-01T00:00:00.000Z',
          message: { content: [{ type: 'tool_result', tool_use_id: 'ghost', is_error: false }] },
        }),
      ]),
    );
    expect(bundle.steps.some((s) => s.kind === 'tool')).toBe(false);
    const d = bundle.diagnostics.find((x) => x.code === 'unpaired-tool-result');
    expect(d?.count).toBe(1);
  });
});

describe('computeBundle - compaction, cost, version, effort', () => {
  test('compaction step carries trigger and pre/post tokens', async () => {
    const bundle = await computeBundle(
      baseInput([
        rec({
          type: 'system',
          subtype: 'compact_boundary',
          timestamp: '2026-01-01T00:00:00Z',
          compactMetadata: { trigger: 'auto', preTokens: 500, postTokens: 50 },
        }),
      ]),
    );
    expect(bundle.session.compactions).toBe(1);
    const c = bundle.steps.find((s) => s.kind === 'compaction');
    expect(c).toMatchObject({ compactionTrigger: 'auto', preTokens: 500, postTokens: 50 });
  });

  test('cost takes the last reported value', async () => {
    const bundle = await computeBundle(
      baseInput([
        rec({ type: 'cost-state', totalCostUSD: 1.5, timestamp: '2026-01-01T00:00:00Z' }),
        rec({ type: 'cost-state', totalCostUSD: 3.2, timestamp: '2026-01-01T00:00:01Z' }),
      ]),
    );
    expect(bundle.session.costUsd).toBe(3.2);
  });

  test('harnessVersionFirst/Last track the first and last observed version', async () => {
    const bundle = await computeBundle(
      baseInput([
        rec({
          type: 'user',
          version: '2.1.250',
          timestamp: '2026-01-01T00:00:00Z',
          message: { content: [] },
        }),
        rec({
          type: 'user',
          version: '2.1.251',
          timestamp: '2026-01-01T00:00:01Z',
          message: { content: [] },
        }),
      ]),
    );
    expect(bundle.session.harnessVersionFirst).toBe('2.1.250');
    expect(bundle.session.harnessVersionLast).toBe('2.1.251');
  });

  test('effort is the last observed value', async () => {
    const bundle = await computeBundle(
      baseInput([
        rec({
          type: 'assistant',
          effort: 'low',
          timestamp: '2026-01-01T00:00:00Z',
          message: { content: [] },
        }),
        rec({
          type: 'assistant',
          effort: 'high',
          timestamp: '2026-01-01T00:00:01Z',
          message: { content: [] },
        }),
      ]),
    );
    expect(bundle.session.effort).toBe('high');
  });
});

describe('computeBundle - title and privacy', () => {
  test('title is set from the last ai-title record only when ctx.privacy.titles', async () => {
    const records = [
      rec({ type: 'ai-title', aiTitle: 'first title' }),
      rec({ type: 'ai-title', aiTitle: 'final title' }),
    ];
    const on = await computeBundle(baseInput(records, { ctx: ctxWith(true) }));
    expect(on.session.title).toBe('final title');
    const off = await computeBundle(baseInput(records, { ctx: ctxWith(false) }));
    expect(off.session.title).toBeUndefined();
  });
});

describe('computeBundle - project identity and cwd fallback', () => {
  test('first observed cwd is used to resolve the project', async () => {
    const bundle = await computeBundle(
      baseInput([
        rec({
          type: 'user',
          cwd: '/home/u/proj-a',
          timestamp: '2026-01-01T00:00:00Z',
          message: { content: [] },
        }),
        rec({
          type: 'user',
          cwd: '/home/u/proj-b',
          timestamp: '2026-01-01T00:00:01Z',
          message: { content: [] },
        }),
      ]),
    );
    expect(bundle.session.cwd).toBe('/home/u/proj-a');
    expect(bundle.project.key).toBe('/home/u/proj-a');
  });

  test('no cwd anywhere falls back to the decoded directory name with a diagnostic', async () => {
    const bundle = await computeBundle(
      baseInput(
        [rec({ type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: [] } })],
        {
          fallbackCwd: '/home/u/fallback-proj',
        },
      ),
    );
    expect(bundle.session.cwd).toBe('/home/u/fallback-proj');
    expect(bundle.diagnostics.some((d) => d.code === 'cwd-from-dirname')).toBe(true);
  });
});

describe('computeBundle - unexpected sidechain', () => {
  test('a root source with isSidechain:true records gets the diagnostic', async () => {
    const bundle = await computeBundle(
      baseInput([
        rec({
          type: 'user',
          isSidechain: true,
          timestamp: '2026-01-01T00:00:00Z',
          message: { content: [] },
        }),
      ]),
    );
    expect(bundle.diagnostics.some((d) => d.code === 'unexpected-sidechain')).toBe(true);
  });

  test('a child source with isSidechain:true does not get the diagnostic', async () => {
    const bundle = await computeBundle(
      baseInput(
        [
          rec({
            type: 'user',
            isSidechain: true,
            timestamp: '2026-01-01T00:00:00Z',
            message: { content: [] },
          }),
        ],
        { isRoot: false },
      ),
    );
    expect(bundle.diagnostics.some((d) => d.code === 'unexpected-sidechain')).toBe(false);
  });
});

describe('computeBundle - initiator', () => {
  test('classifies via classifyInitiator from entrypoint and the agent-setting marker', async () => {
    const bundle = await computeBundle(
      baseInput([
        rec({
          type: 'user',
          entrypoint: 'sdk-py',
          timestamp: '2026-01-01T00:00:00Z',
          message: { content: [] },
        }),
      ]),
    );
    expect(bundle.session.initiatorKind).toBe('machine');
    expect(bundle.session.initiatorSurface).toBe('sdk-py');
    expect(bundle.session.initiatorAutomation).toBe('sdk');
  });

  test('no entrypoint and no marker leaves initiator fields entirely undefined', async () => {
    const bundle = await computeBundle(
      baseInput([
        rec({ type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: [] } }),
      ]),
    );
    expect(bundle.session.initiatorKind).toBeUndefined();
  });
});

describe('computeBundle - timing and seq', () => {
  test('startedAt/endedAt/durationMs come from the min/max valid timestamps; redacted timestamps are ignored', async () => {
    const bundle = await computeBundle(
      baseInput([
        rec({ type: 'user', timestamp: 'xxxxxxxxxxxxxxxxxxxxxxxx', message: { content: [] } }),
        rec({ type: 'user', timestamp: '2026-01-01T00:00:00.000Z', message: { content: [] } }),
        rec({ type: 'user', timestamp: '2026-01-01T00:10:00.000Z', message: { content: [] } }),
      ]),
    );
    expect(bundle.session.startedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(bundle.session.endedAt).toBe('2026-01-01T00:10:00.000Z');
    expect(bundle.session.durationMs).toBe(600_000);
  });

  test('steps.seq is contiguous from 0 in source order', async () => {
    const bundle = await computeBundle(
      baseInput([
        assistantWithUsage({ requestId: 'r1', output: 1, at: '2026-01-01T00:00:00Z' }),
        rec({
          type: 'system',
          subtype: 'compact_boundary',
          timestamp: '2026-01-01T00:00:01Z',
        }),
        assistantWithUsage({ requestId: 'r2', output: 2, at: '2026-01-01T00:00:02Z' }),
      ]),
    );
    expect(bundle.steps.map((s) => s.seq)).toEqual(bundle.steps.map((_, i) => i));
  });
});
