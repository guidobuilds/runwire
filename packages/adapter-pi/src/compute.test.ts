import { describe, expect, test } from 'bun:test';
import type { AdapterContext, Project, Step } from '@scout/core';
import { TOKEN_FIELDS } from '@scout/core';
import type { ComputeBundleInput } from './compute';
import { computeBundle } from './compute';
import type { PiRecord } from './schema';

function rec(partial: Record<string, unknown>): { record: PiRecord; line: number } {
  return { record: partial as PiRecord, line: 1 };
}

function ctxWith(): AdapterContext {
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
    privacy: { titles: true },
    log: { info() {}, warn() {}, error() {} },
  };
}

async function fakeResolveProject(cwd: string): Promise<Project> {
  return { key: cwd, name: cwd, identity: 'cwd' };
}

const HEADER_UUID = 'a1000000-0000-7000-8000-000000000001';

function baseInput(
  records: Array<{ record: PiRecord; line: number }>,
  overrides: Partial<ComputeBundleInput> = {},
): ComputeBundleInput {
  return {
    sessionId: `pi:${HEADER_UUID}`,
    source: { path: '/home/u/.pi/agent/sessions/x/sess.jsonl', sizeBytes: 100, mtimeMs: 1000 },
    records,
    recordDiagnostics: [],
    resolveProject: fakeResolveProject,
    headerUuid: HEADER_UUID,
    ctx: ctxWith(),
    ...overrides,
  };
}

function header(overrides: Record<string, unknown> = {}): { record: PiRecord; line: number } {
  return rec({
    type: 'session',
    version: 3,
    id: HEADER_UUID,
    timestamp: '2026-01-01T00:00:00.000Z',
    cwd: '/home/u/pi',
    ...overrides,
  });
}

function usage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { total: 0.01 },
    ...overrides,
  };
}

function assistant(opts: {
  at: string;
  ms?: number;
  model?: string;
  responseModel?: string;
  stopReason?: string;
  usage?: Record<string, unknown> | null;
  content?: unknown[];
}): { record: PiRecord; line: number } {
  return rec({
    type: 'message',
    timestamp: opts.at,
    message: {
      role: 'assistant',
      model: opts.model,
      responseModel: opts.responseModel,
      stopReason: opts.stopReason,
      timestamp: opts.ms,
      usage: opts.usage === null ? undefined : (opts.usage ?? usage()),
      content: opts.content ?? [],
    },
  });
}

function toolResult(opts: {
  at: string;
  ms?: number;
  toolCallId?: string;
  isError?: boolean;
  usage?: Record<string, unknown> | null;
}): { record: PiRecord; line: number } {
  return rec({
    type: 'message',
    timestamp: opts.at,
    message: {
      role: 'toolResult',
      toolCallId: opts.toolCallId,
      isError: opts.isError,
      timestamp: opts.ms,
      usage: opts.usage === null ? undefined : opts.usage,
    },
  });
}

describe('computeBundle: the Σ-over-call-steps invariant', () => {
  test('session tokens equal the sum over assistant + extra-context call steps', async () => {
    const bundle = await computeBundle(
      baseInput([
        header(),
        assistant({
          at: '2026-01-01T00:00:01.000Z',
          ms: 1000,
          model: 'm-a',
          usage: usage({
            input: 1,
            cacheRead: 2,
            cacheWrite: 3,
            output: 4,
            reasoning: 5,
            totalTokens: 10,
            cost: { total: 0.5 },
          }),
          content: [{ type: 'toolCall', id: 't1', name: 'read' }],
        }),
        toolResult({
          at: '2026-01-01T00:00:02.000Z',
          ms: 2000,
          toolCallId: 't1',
          isError: false,
          usage: usage({ input: 10, output: 20, totalTokens: 30, cost: { total: 0.2 } }),
        }),
        rec({
          type: 'compaction',
          timestamp: '2026-01-01T00:00:03.000Z',
          tokensBefore: 100,
          fromHook: true,
          usage: usage({ input: 100, output: 200, totalTokens: 300, cost: { total: 0.3 } }),
        }),
      ]),
    );

    expect(bundle.session.uncachedInput).toBe(111);
    expect(bundle.session.cachedInput).toBe(2);
    expect(bundle.session.cacheWrite).toBe(3);
    expect(bundle.session.output).toBe(224);
    expect(bundle.session.reasoningOutput).toBe(5);
    expect(bundle.session.apiCalls).toBe(3);

    const calls = bundle.steps.filter((s) => s.kind === 'call');
    for (const f of TOKEN_FIELDS) {
      const sessionValue = bundle.session[f];
      if (sessionValue === undefined) continue;
      const sum = calls.reduce((acc, s) => acc + (s[f] ?? 0), 0);
      expect(sum).toBe(sessionValue);
    }
  });
});

describe('computeBundle: extra-context calls (§5.2)', () => {
  test('extra call steps carry no model and are excluded from model tallies', async () => {
    const bundle = await computeBundle(
      baseInput([
        header(),
        assistant({ at: '2026-01-01T00:00:01.000Z', ms: 1000, model: 'm-a' }),
        toolResult({
          at: '2026-01-01T00:00:02.000Z',
          ms: 2000,
          usage: usage({ input: 5, output: 5 }),
        }),
        rec({
          type: 'compaction',
          timestamp: '2026-01-01T00:00:03.000Z',
          tokensBefore: 1,
          usage: usage({ input: 6, output: 6 }),
        }),
        rec({
          type: 'branch_summary',
          timestamp: '2026-01-01T00:00:04.000Z',
          usage: usage({ input: 7, output: 7 }),
        }),
      ]),
    );

    const calls = bundle.steps.filter((s) => s.kind === 'call');
    expect(calls).toHaveLength(4);
    expect(calls[0]?.model).toBe('m-a');
    expect(calls[1]?.model).toBeUndefined();
    expect(calls[2]?.model).toBeUndefined();
    expect(calls[3]?.model).toBeUndefined();
    expect(bundle.session.modelPrimary).toBe('m-a');
    const diag = bundle.diagnostics.find((d) => d.code === 'usage-on-non-assistant');
    expect(diag?.count).toBe(3);
  });
});

describe('computeBundle: tool pairing', () => {
  test('strict pairing by toolCallId sets error and duration from the two ms timestamps', async () => {
    const bundle = await computeBundle(
      baseInput([
        header(),
        assistant({
          at: '2026-01-01T00:00:01.000Z',
          ms: 1000,
          model: 'm-a',
          content: [{ type: 'toolCall', id: 't1', name: 'read' }],
        }),
        toolResult({ at: '2026-01-01T00:00:02.000Z', ms: 1500, toolCallId: 't1', isError: true }),
      ]),
    );
    const tool = bundle.steps.find((s) => s.kind === 'tool') as Step;
    expect(tool.error).toBe(true);
    expect(tool.durationMs).toBe(500);
  });

  test('an unmatched result and an unanswered call are both counted', async () => {
    const bundle = await computeBundle(
      baseInput([
        header(),
        assistant({
          at: '2026-01-01T00:00:01.000Z',
          ms: 1000,
          model: 'm-a',
          content: [{ type: 'toolCall', id: 'x', name: 'read' }],
        }),
        toolResult({
          at: '2026-01-01T00:00:02.000Z',
          ms: 2000,
          toolCallId: 'ghost',
          isError: false,
        }),
      ]),
    );
    expect(bundle.diagnostics.find((d) => d.code === 'unpaired-tool-result')?.count).toBe(1);
    expect(bundle.diagnostics.find((d) => d.code === 'unanswered-tool-call')?.count).toBe(1);
  });
});

describe('computeBundle: model accounting', () => {
  test('model-change steps derive from call steps; model_change seeds and unused targets are counted', async () => {
    const bundle = await computeBundle(
      baseInput([
        header(),
        rec({
          type: 'model_change',
          timestamp: '2026-01-01T00:00:00.500Z',
          provider: 'p',
          modelId: 'm-seed',
        }),
        assistant({ at: '2026-01-01T00:00:01.000Z', ms: 1000, model: 'm-seed' }),
        assistant({ at: '2026-01-01T00:00:02.000Z', ms: 2000, model: 'm-b' }),
        rec({
          type: 'model_change',
          timestamp: '2026-01-01T00:00:03.000Z',
          provider: 'p',
          modelId: 'm-unused',
        }),
      ]),
    );
    expect(bundle.session.modelChanges).toBe(1);
    expect(bundle.session.modelPrimary).toBe('m-seed');
    const changes = bundle.steps.filter((s) => s.kind === 'model-change');
    expect(changes).toHaveLength(1);
    expect(changes[0]?.fromValue).toBe('m-seed');
    expect(changes[0]?.toValue).toBe('m-b');
    expect(bundle.diagnostics.find((d) => d.code === 'unused-model-change')?.count).toBe(1);
  });
});

describe('computeBundle: harness events', () => {
  test('effort is the last thinkingLevel; call-error/call-aborted are harness steps', async () => {
    const bundle = await computeBundle(
      baseInput([
        header(),
        rec({
          type: 'thinking_level_change',
          timestamp: '2026-01-01T00:00:01.000Z',
          thinkingLevel: 'low',
        }),
        rec({
          type: 'thinking_level_change',
          timestamp: '2026-01-01T00:00:02.000Z',
          thinkingLevel: 'high',
        }),
        assistant({ at: '2026-01-01T00:00:03.000Z', ms: 3000, model: 'm-a', stopReason: 'error' }),
        assistant({
          at: '2026-01-01T00:00:04.000Z',
          ms: 4000,
          model: 'm-a',
          stopReason: 'aborted',
        }),
      ]),
    );
    expect(bundle.session.effort).toBe('high');
    const names = bundle.steps.filter((s) => s.kind === 'harness').map((s) => s.toolName);
    expect(names).toContain('thinking-level-change');
    expect(names).toContain('call-error');
    expect(names).toContain('call-aborted');
  });

  test('label/session_info/custom/custom_message become harness steps under their entry type', async () => {
    const bundle = await computeBundle(
      baseInput([
        header(),
        rec({ type: 'label', timestamp: '2026-01-01T00:00:01.000Z' }),
        rec({ type: 'session_info', timestamp: '2026-01-01T00:00:02.000Z' }),
        rec({ type: 'custom', timestamp: '2026-01-01T00:00:03.000Z' }),
        rec({ type: 'custom_message', timestamp: '2026-01-01T00:00:04.000Z' }),
      ]),
    );
    const names = bundle.steps.filter((s) => s.kind === 'harness').map((s) => s.toolName);
    expect(names).toEqual(['label', 'session-info', 'custom', 'custom-message']);
  });
});

describe('computeBundle: identity and tree', () => {
  test('parentSession yields a fork link with no parentId', async () => {
    const bundle = await computeBundle(
      baseInput([
        header({
          parentSession:
            '/home/u/pi/.pi/agent/sessions/--home-u-pi--/2026-01-01T00-00-00-000Z_99000000-0000-7000-8000-0000000000aa.jsonl',
        }),
      ]),
    );
    expect(bundle.session.relation).toBe('fork');
    expect(bundle.session.forkedFrom).toBe('pi:99000000-0000-7000-8000-0000000000aa');
    expect(bundle.session.parentId).toBeUndefined();
    expect(bundle.session.depth).toBe(0);
  });

  test('a header id that differs from the filename uuid is diagnosed', async () => {
    const bundle = await computeBundle(baseInput([header({ id: 'different-id' })]));
    expect(bundle.diagnostics.some((d) => d.code === 'session-id-mismatch')).toBe(true);
  });

  test('a missing session header is diagnosed and cwd falls back to the dirname', async () => {
    const bundle = await computeBundle(
      baseInput(
        [
          rec({
            type: 'message',
            timestamp: '2026-01-01T00:00:01.000Z',
            message: { role: 'user' },
          }),
        ],
        {
          fallbackCwd: '/home/u/pi',
        },
      ),
    );
    expect(bundle.diagnostics.some((d) => d.code === 'missing-session-header')).toBe(true);
    expect(bundle.diagnostics.some((d) => d.code === 'cwd-from-dirname')).toBe(true);
    expect(bundle.session.cwd).toBe('/home/u/pi');
  });

  test('a real linear session (header id unreferenced, first entry parentId null) is not branched', async () => {
    const bundle = await computeBundle(
      baseInput([
        header(),
        rec({
          type: 'message',
          id: 'u1',
          parentId: null,
          timestamp: '2026-01-01T00:00:01.000Z',
          message: { role: 'user' },
        }),
        rec({
          type: 'message',
          id: 'a1',
          parentId: 'u1',
          timestamp: '2026-01-01T00:00:02.000Z',
          message: { role: 'assistant' },
        }),
      ]),
    );
    // The header carries an id but is not a node: roots=1, leaves=1.
    expect(bundle.diagnostics.some((d) => d.code === 'branched-tree')).toBe(false);
  });

  test('more than one root/leaf yields branched-tree with extra-root count', async () => {
    const bundle = await computeBundle(
      baseInput([
        header(),
        rec({
          type: 'message',
          id: 'u1',
          parentId: null,
          timestamp: '2026-01-01T00:00:01.000Z',
          message: { role: 'user' },
        }),
        rec({
          type: 'message',
          id: 'u2',
          parentId: null,
          timestamp: '2026-01-01T00:00:02.000Z',
          message: { role: 'user' },
        }),
      ]),
    );
    // Two real roots (u1, u2); the unreferenced header is not counted.
    const diag = bundle.diagnostics.find((d) => d.code === 'branched-tree');
    expect(diag?.count).toBe(1);
  });
});

describe('computeBundle: legacy-format detection (pi.md §8)', () => {
  test('a versioned file whose entries lack id/parentId (v1 shape) is legacy', async () => {
    const bundle = await computeBundle(
      baseInput([
        header(),
        rec({
          type: 'message',
          timestamp: '2026-01-01T00:00:01.000Z',
          message: { role: 'user' },
        }),
      ]),
    );
    expect(bundle.diagnostics.some((d) => d.code === 'legacy-format')).toBe(true);
  });

  test('a versioned file with entry ids is not legacy', async () => {
    const bundle = await computeBundle(
      baseInput([
        header(),
        rec({
          type: 'message',
          id: 'u1',
          parentId: null,
          timestamp: '2026-01-01T00:00:01.000Z',
          message: { role: 'user' },
        }),
      ]),
    );
    expect(bundle.diagnostics.some((d) => d.code === 'legacy-format')).toBe(false);
  });
});

describe('computeBundle: usage diagnostics', () => {
  test('token-arithmetic-drift when totalTokens disagrees with the 4-part sum', async () => {
    const bundle = await computeBundle(
      baseInput([
        header(),
        assistant({
          at: '2026-01-01T00:00:01.000Z',
          ms: 1000,
          model: 'm-a',
          usage: usage({ totalTokens: 999 }),
        }),
      ]),
    );
    expect(bundle.diagnostics.find((d) => d.code === 'token-arithmetic-drift')?.count).toBe(1);
  });

  test('unpriced-model when tokens are present but cost.total is zero', async () => {
    const bundle = await computeBundle(
      baseInput([
        header(),
        assistant({
          at: '2026-01-01T00:00:01.000Z',
          ms: 1000,
          model: 'm-a',
          usage: usage({ cost: { total: 0 } }),
        }),
      ]),
    );
    expect(bundle.diagnostics.find((d) => d.code === 'unpriced-model')?.count).toBe(1);
  });
});
