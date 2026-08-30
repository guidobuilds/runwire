import { describe, expect, test } from 'bun:test';
import { createBunFs } from '../adapter/fs.bun';
import type { AdapterContext, HarnessAdapter } from '../adapter/types';
import { comparability } from '../compare/comparability';
import { createFakeAdapter } from '../test-kit/fake-adapter';
import { createScanState, scan } from './pipeline';
import { ScoutStore } from './store';

function testContext(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    home: '/home/u',
    platform: 'linux',
    env: {},
    fs: createBunFs(),
    privacy: { titles: true },
    log: { info() {}, warn() {}, error() {} },
    ...overrides,
  };
}

describe('scan pipeline - end to end on the fake adapter', () => {
  test('produces linked summaries, correct rollups, project/harness aggregates and a comparability matrix', async () => {
    const adapter = createFakeAdapter();
    const ctx = testContext({ privacy: { titles: true } });
    const state = createScanState();

    const report = await scan([adapter], ctx, state, { projectIdentity: 'cwd' });

    // root, child1, child2, child3, child4, malformed, titled
    expect(report.perAdapter.fake?.discovered).toBe(7);
    expect(report.perAdapter.fake?.parsed).toBe(7);
    expect(report.perAdapter.fake?.failed).toBe(0);

    const root = state.summaries.find((s) => s.id === 'fake:root');
    const child = state.summaries.find((s) => s.id === 'fake:child1');
    expect(root).toBeDefined();
    expect(child).toBeDefined();
    // Order not asserted here: `scan()` builds its linked items from
    // `state.cache.values()` (Map insertion order = per-source async
    // completion order, not discovery/scenario-array order), so which
    // child lands where in `children[]` is a scan-timing detail, not a
    // documented contract.
    expect(new Set(root?.children)).toEqual(
      new Set(['fake:child1', 'fake:child2', 'fake:child3', 'fake:child4']),
    );
    expect(child?.parentId).toBe('fake:root');
    expect(child?.depth).toBe(1);
    expect(root?.title?.value).toBe('A real session title');
    expect(root?.usage.output?.value).toBe(100); // deduped: two 'req1' fragments count once

    const rootRollup = state.rollups.get('fake:root');
    expect(rootRollup?.exclusive.usage.output?.value).toBe(100);
    expect(rootRollup?.inclusive.usage.output?.value).toBe(120); // + child1's 20; child2-4 carry no usage
    expect(rootRollup?.descendants).toBe(4);

    const titled = state.summaries.find((s) => s.id === 'fake:titled');
    expect(titled?.title?.value).toBe('A fake session title');

    // Projects/harnesses aggregate from a ScoutStore built on the same scan.
    const store = new ScoutStore([adapter], ctx, { projectIdentity: 'cwd' });
    await store.rescan();
    const projects = store.getProjects();
    const harnesses = store.getHarnesses();
    expect(projects.length).toBeGreaterThan(0);
    expect(harnesses).toEqual([
      expect.objectContaining({ harness: 'fake', sessionCount: 3 }), // 3 roots: root, malformed, titled
    ]);

    // Comparability: a single-harness comparison should never be flagged incomparable.
    expect(root).toBeDefined();
    expect(titled).toBeDefined();
    const cmp = comparability(
      [root, titled].filter((s): s is NonNullable<typeof s> => s !== undefined),
      new Map<string, HarnessAdapter>([['fake', adapter]]),
    );
    const outputRow = cmp.rows.find((r) => r.field === 'output');
    expect(outputRow?.cells.some((c) => c.flag === 'incomparable')).toBe(false);

    // Trace: the timeline for the root should exist and its totals match the summary.
    const trace = await store.getTrace('fake:root');
    expect(trace).toBeDefined();
    expect(trace?.totals.output).toBe(root?.usage.output?.value);

    // ADR 0001: fillChildIds matches agent-category steps to children by
    // exact viaCallId<->callId, not emission-order position.
    expect(() => trace).not.toThrow();
    const agentSteps = (trace?.steps ?? []).filter(
      (s): s is Extract<NonNullable<typeof trace>['steps'][number], { kind: 'tool' }> =>
        s.kind === 'tool' && s.category === 'agent',
    );
    const c1Step = agentSteps.find((s) => s.callId === 'c1');
    const decoyStep = agentSteps.find((s) => s.callId === 'c-decoy');
    const c2Step = agentSteps.find((s) => s.callId === 'c2');
    // (a) exact match: the c1 agent step resolves to child1 (its viaCallId).
    expect(c1Step?.childId).toBe('fake:child1');
    // (b)/(c): the decoy step never matches. Under the old index-based
    // logic (children[] zipped against agentSteps[] by position), this
    // second agent step would have been wired to child2 (the second child
    // in discovery order) - this is the direct refutation of order-based
    // matching.
    expect(decoyStep?.childId).toBeUndefined();
    // (e) viaCallId collision: child3 and child4 both claim 'c2'; the later
    // child in discovery/summary order (child4) wins, deterministically.
    expect(c2Step?.childId).toBe('fake:child4');

    // (d) child2 has no viaCallId: it is still linked as a normal child
    // (getSubtree), it just never receives an agent-step childId.
    const subtree = store.getSubtree('fake:root');
    expect(subtree.some((s) => s.id === 'fake:child2')).toBe(true);
  });

  test('a malformed source produces diagnostics without failing the scan or the other sources', async () => {
    const adapter = createFakeAdapter();
    const ctx = testContext();
    const state = createScanState();

    const report = await scan([adapter], ctx, state, { projectIdentity: 'cwd' });

    const malformed = state.summaries.find((s) => s.id === 'fake:malformed');
    expect(malformed).toBeDefined();
    expect(malformed?.diagnostics.some((d) => d.code === 'unknown-record-type')).toBe(true);
    // Every other source still parsed successfully.
    expect(state.summaries.find((s) => s.id === 'fake:root')).toBeDefined();
    expect(report.perAdapter.fake?.failed).toBe(0);
  });

  test('privacy.titles=false drops titles through the whole pipeline', async () => {
    const adapter = createFakeAdapter();
    const ctx = testContext({ privacy: { titles: false } });
    const state = createScanState();
    await scan([adapter], ctx, state, { projectIdentity: 'cwd' });

    const titled = state.summaries.find((s) => s.id === 'fake:titled');
    expect(titled?.title).toBeUndefined();
  });

  test('a second scan reuses unchanged sources and rescans nothing', async () => {
    const adapter = createFakeAdapter();
    const ctx = testContext();
    const state = createScanState();

    const first = await scan([adapter], ctx, state, { projectIdentity: 'cwd' });
    expect(first.perAdapter.fake?.parsed).toBe(7);
    expect(first.perAdapter.fake?.reused).toBe(0);

    const second = await scan([adapter], ctx, state, { projectIdentity: 'cwd' });
    expect(second.perAdapter.fake?.parsed).toBe(0);
    expect(second.perAdapter.fake?.reused).toBe(7);
    expect(state.summaries.find((s) => s.id === 'fake:root')?.usage.output?.value).toBe(100);
  });

  test('an adapter whose probe reports not-installed contributes nothing and does not fail the scan', async () => {
    const notInstalled: HarnessAdapter = {
      ...createFakeAdapter(),
      id: 'codex',
      async probe() {
        return { installed: false, roots: [], notes: ['not found'] };
      },
    };
    const ctx = testContext();
    const state = createScanState();
    const report = await scan([notInstalled], ctx, state);
    expect(report.perAdapter.codex).toEqual({
      discovered: 0,
      parsed: 0,
      reused: 0,
      failed: 0,
      durationMs: expect.any(Number),
    });
    expect(state.summaries).toEqual([]);
  });

  test('a source whose parse() throws produces a diagnostic and does not stop the scan', async () => {
    const throwing: HarnessAdapter = {
      ...createFakeAdapter(),
      async *parse(ref, ctx) {
        if (ref.sourceId === 'root') throw new Error('boom');
        yield* createFakeAdapter().parse(ref, ctx);
      },
    };
    const ctx = testContext();
    const state = createScanState();
    const report = await scan([throwing], ctx, state);

    expect(report.diagnostics.some((d) => d.code === 'source-parse-failed')).toBe(true);
    expect(report.perAdapter.fake?.failed).toBe(1);
    expect(state.summaries.find((s) => s.id === 'fake:root')).toBeUndefined();
    expect(state.summaries.find((s) => s.id === 'fake:titled')).toBeDefined();
  });
});
