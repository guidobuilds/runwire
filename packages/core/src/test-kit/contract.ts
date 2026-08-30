import { describe, expect, test } from 'bun:test';
import { createMemoryFs } from '../adapter/fs.memory';
import type { AdapterContext, HarnessAdapter, SourceRef } from '../adapter/types';
import type { ScoutEvent } from '../events/event';

export type AdapterContractOptions = {
  adapter: HarnessAdapter;
  ctx?: AdapterContext;
  /** sourceId of a scenario whose events include >=1 diagnostic and must never throw. */
  malformedSourceId?: string;
  /** sourceId of a scenario whose content fields hold a sentinel that must never leak. */
  canarySourceId?: string;
  canarySentinel?: string;
};

function defaultContext(): AdapterContext {
  return {
    home: '/home/u',
    platform: 'linux',
    env: {},
    fs: createMemoryFs(),
    privacy: { titles: true },
    log: { info() {}, warn() {}, error() {} },
  };
}

async function collectEvents(
  adapter: HarnessAdapter,
  ref: SourceRef,
  ctx: AdapterContext,
): Promise<ScoutEvent[]> {
  const out: ScoutEvent[] = [];
  for await (const e of adapter.parse(ref, ctx)) out.push(e);
  return out;
}

/**
 * Finds the real SourceRef discover() produced for a given sourceId. A
 * fabricated ref (e.g. `path: ''`) only works for an adapter whose parse()
 * ignores the ref entirely (like the in-memory fake); a real adapter needs
 * the genuine path/size/mtime discover() assigned.
 */
async function findRef(
  adapter: HarnessAdapter,
  ctx: AdapterContext,
  sourceId: string,
): Promise<SourceRef> {
  for await (const ref of adapter.discover(ctx)) {
    if (ref.sourceId === sourceId) return ref;
  }
  throw new Error(
    `adapterContract: no source with id "${sourceId}" was found by discover() in the given ctx`,
  );
}

/**
 * The adapter contract test suite (docs/ARCHITECTURE.md §11). Any harness
 * adapter, real or fake, must satisfy this. Call it from a *.test.ts file;
 * it registers `describe`/`test` blocks itself.
 */
export function adapterContract(opts: AdapterContractOptions): void {
  const ctx = opts.ctx ?? defaultContext();
  const { adapter } = opts;

  describe(`adapter contract: ${adapter.id}`, () => {
    test('discover() yields sources with stable sourceIds across two runs', async () => {
      const first: string[] = [];
      for await (const ref of adapter.discover(ctx)) first.push(ref.sourceId);
      const second: string[] = [];
      for await (const ref of adapter.discover(ctx)) second.push(ref.sourceId);
      expect(new Set(second)).toEqual(new Set(first));
      expect(first.length).toBeGreaterThan(0);
    });

    test('parse() emits meta as the first event for every discovered source', async () => {
      for await (const ref of adapter.discover(ctx)) {
        const events = await collectEvents(adapter, ref, ctx);
        expect(events.length).toBeGreaterThan(0);
        expect(events[0]?.kind).toBe('meta');
      }
    });

    test('toolCategory() is total: an unknown tool name falls back to "other"', () => {
      expect(adapter.toolCategory('__totally_unknown_tool_name__')).toBe('other');
    });

    test('every harnessEvent name observed across all sources is declared in harnessEventNames', async () => {
      const declared = new Set(adapter.harnessEventNames);
      for await (const ref of adapter.discover(ctx)) {
        const events = await collectEvents(adapter, ref, ctx);
        for (const e of events) {
          if (e.kind === 'harnessEvent') expect(declared.has(e.name)).toBe(true);
        }
      }
    });

    test('every usage number emitted is a non-negative finite value', async () => {
      const keys = [
        'uncachedInput',
        'cachedInput',
        'cacheWrite',
        'output',
        'reasoningOutput',
      ] as const;
      for await (const ref of adapter.discover(ctx)) {
        const events = await collectEvents(adapter, ref, ctx);
        for (const e of events) {
          if (e.kind !== 'usage' && e.kind !== 'usageTotal') continue;
          for (const k of keys) {
            const v = e[k];
            if (v === undefined) continue;
            expect(Number.isFinite(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(0);
          }
        }
      }
    });

    if (opts.malformedSourceId) {
      test('the malformed source never throws and produces at least one diagnostic', async () => {
        const ref = await findRef(adapter, ctx, opts.malformedSourceId as string);
        let events: ScoutEvent[] = [];
        await expect(
          (async () => {
            events = await collectEvents(adapter, ref, ctx);
          })(),
        ).resolves.toBeUndefined();
        expect(events.some((e) => e.kind === 'diagnostic')).toBe(true);
      });
    }

    if (opts.canarySourceId) {
      test('the canary sentinel never appears anywhere in the emitted events', async () => {
        const sentinel = opts.canarySentinel ?? 'SCOUT_CANARY_';
        const ref = await findRef(adapter, ctx, opts.canarySourceId as string);
        const events = await collectEvents(adapter, ref, ctx);
        const serialized = JSON.stringify(events);
        expect(serialized.includes(sentinel)).toBe(false);
      });
    }

    test('capabilities are consistent with what the fixtures actually exercise', async () => {
      const observed = new Set<string>();
      for await (const ref of adapter.discover(ctx)) {
        const events = await collectEvents(adapter, ref, ctx);
        for (const e of events) {
          if (e.kind === 'usage' || e.kind === 'usageTotal') {
            observed.add(e.kind === 'usage' ? 'usage.perCall' : 'usage.cumulative');
            if (e.cacheWrite !== undefined) observed.add('usage.cacheWrite');
            if (e.reasoningOutput !== undefined) observed.add('usage.reasoning');
          }
          if (e.kind === 'observed' || (e as { at?: string }).at) observed.add('timing');
          if (e.kind === 'model') observed.add('model');
          if (e.kind === 'mode') observed.add('mode');
          if (e.kind === 'effort') observed.add('effort');
          if (e.kind === 'version' || (e.kind === 'meta' && e.harnessVersion))
            observed.add('version');
          if (e.kind === 'turn') observed.add('turns');
          if (e.kind === 'toolCall') observed.add('toolCalls');
          if (e.kind === 'compaction') observed.add('compactions');
          if (e.kind === 'link') observed.add('subagents');
          if (e.kind === 'cost') observed.add('cost');
          if (e.kind === 'meta' && e.title) observed.add('title');
          if (e.kind === 'meta' && e.git) observed.add('git');
        }
      }

      for (const cap of adapter.capabilities) {
        if (cap.startsWith('trace.')) continue; // trace-only capabilities aren't inferable from this generic scan
        expect(observed.has(cap)).toBe(true);
      }
      // Reverse direction: an event kind that implies a capability the
      // adapter did not declare is also a contract violation.
      for (const cap of observed) {
        expect(adapter.capabilities.includes(cap as HarnessAdapter['capabilities'][number])).toBe(
          true,
        );
      }
    });
  });
}
