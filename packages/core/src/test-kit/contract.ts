import { describe, expect, test } from 'bun:test';
import { createMemoryFs } from '../adapter/fs.memory';
import type { AdapterContext } from '../adapter/types';
import type { HarnessAdapter, Known } from '../contract/adapter';
import { CAPABILITIES, CAPABILITY_FIELDS, type Capability } from '../contract/capabilities';
import { validateBundle } from '../contract/schema';
import type { SessionBundle, Step, StepKind } from '../contract/types';
import { TOKEN_FIELDS } from '../contract/types';

export type AdapterContractOptions = {
  adapter: HarnessAdapter;
  ctx?: AdapterContext;
  /** session.id of a bundle with >= 1 diagnostic and no throw. */
  malformedSessionId?: string;
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

async function collectAll(
  adapter: HarnessAdapter,
  ctx: AdapterContext,
  known: Known = new Map(),
): Promise<SessionBundle[]> {
  const out: SessionBundle[] = [];
  for await (const bundle of adapter.discover(ctx, known)) out.push(bundle);
  return out;
}

/** Recursively walks every string reached from `value` (objects, arrays, primitives). */
function everyString(value: unknown, visit: (s: string) => void): void {
  if (typeof value === 'string') {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const el of value) everyString(el, visit);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) everyString(v, visit);
  }
}

function stepFieldValue(step: Step, field: string): unknown {
  return (step as unknown as Record<string, unknown>)[field];
}

/**
 * The adapter contract test suite (docs/ARCHITECTURE.md §8). Any harness
 * adapter must satisfy this on its fixtures. Call it from a *.test.ts file;
 * it registers `describe`/`test` blocks itself.
 */
export function adapterContract(opts: AdapterContractOptions): void {
  const ctx = opts.ctx ?? defaultContext();
  const { adapter } = opts;

  describe(`adapter contract: ${adapter.id}`, () => {
    test('schema: every discovered bundle validates against the contract schema', async () => {
      const bundles = await collectAll(adapter, ctx);
      expect(bundles.length).toBeGreaterThan(0);
      for (const bundle of bundles) {
        const result = validateBundle(bundle);
        expect(result.ok).toBe(true);
      }
    });

    test('every session.id starts with "<adapterId>:" and steps/project reference it correctly', async () => {
      const bundles = await collectAll(adapter, ctx);
      for (const bundle of bundles) {
        expect(bundle.session.id.startsWith(`${adapter.id}:`)).toBe(true);
        expect(bundle.project.key).toBe(bundle.session.projectKey);
        for (const step of bundle.steps) {
          expect(step.sessionId).toBe(bundle.session.id);
        }
      }
    });

    test('steps: seq is contiguous from 0 in source order for every bundle', async () => {
      const bundles = await collectAll(adapter, ctx);
      for (const bundle of bundles) {
        const seqs = bundle.steps.map((s) => s.seq);
        expect(seqs).toEqual(bundle.steps.map((_, i) => i));
      }
    });

    test('stable ids: two discover() runs yield the same session.id set', async () => {
      const first = await collectAll(adapter, ctx);
      const second = await collectAll(adapter, ctx);
      expect(new Set(second.map((b) => b.session.id))).toEqual(
        new Set(first.map((b) => b.session.id)),
      );
      expect(first.length).toBeGreaterThan(0);
    });

    test('known: feeding back what was discovered yields zero bundles on the next run', async () => {
      const first = await collectAll(adapter, ctx);
      const known: Known = new Map();
      for (const bundle of first) {
        // Key by the EFFECTIVE source id (sourceId ?? sourcePath), so an adapter
        // that separates sourceId from sourcePath still feeds back a matching key.
        known.set(bundle.session.sourceId ?? bundle.session.sourcePath, {
          size: bundle.session.sourceSize,
          mtime: bundle.session.sourceMtime,
        });
      }
      const second = await collectAll(adapter, ctx, known);
      expect(second.length).toBe(0);
    });

    test('totals: per TOKEN_FIELD, Σ over call steps equals the session value when defined', async () => {
      const bundles = await collectAll(adapter, ctx);
      for (const bundle of bundles) {
        const callSteps = bundle.steps.filter((s) => s.kind === 'call');
        for (const field of TOKEN_FIELDS) {
          const sessionValue = bundle.session[field];
          if (sessionValue === undefined) continue;
          const sum = callSteps.reduce((acc, s) => acc + (s[field] ?? 0), 0);
          expect(sum).toBe(sessionValue);
        }
      }
    });

    test('totals: apiCalls/toolCalls/compactions/modelChanges/modeChanges equal step-kind counts when defined', async () => {
      const bundles = await collectAll(adapter, ctx);
      const checks: [
        StepKind,
        'apiCalls' | 'toolCalls' | 'compactions' | 'modelChanges' | 'modeChanges',
      ][] = [
        ['call', 'apiCalls'],
        ['tool', 'toolCalls'],
        ['compaction', 'compactions'],
        ['model-change', 'modelChanges'],
        ['mode-change', 'modeChanges'],
      ];
      for (const bundle of bundles) {
        for (const [kind, field] of checks) {
          const sessionValue = bundle.session[field];
          if (sessionValue === undefined) continue;
          const count = bundle.steps.filter((s) => s.kind === kind).length;
          expect(count).toBe(sessionValue);
        }
      }
    });

    test('diagnostics: every diagnostic is <= 200 chars with no newline', async () => {
      const bundles = await collectAll(adapter, ctx);
      for (const bundle of bundles) {
        for (const d of bundle.diagnostics) {
          expect(d.message.length).toBeLessThanOrEqual(200);
          expect(d.message.includes('\n')).toBe(false);
        }
      }
    });

    if (opts.malformedSessionId) {
      test('the malformed session never throws discover() and carries >= 1 diagnostic', async () => {
        let bundles: SessionBundle[] = [];
        await expect(
          (async () => {
            bundles = await collectAll(adapter, ctx);
          })(),
        ).resolves.toBeUndefined();
        const bundle = bundles.find((b) => b.session.id === opts.malformedSessionId);
        expect(bundle).toBeDefined();
        expect(bundle?.diagnostics.length ?? 0).toBeGreaterThanOrEqual(1);
      });
    }

    test('privacy.titles=false: no discovered session carries a title (D7)', async () => {
      // A bundle must never carry a title when the caller opted out; persist
      // enforces this too, but the adapter owns the opt-out at discovery time.
      const titlesOff: AdapterContext = { ...ctx, privacy: { titles: false } };
      const bundles = await collectAll(adapter, titlesOff);
      for (const bundle of bundles) {
        expect(bundle.session.title).toBeUndefined();
      }
    });

    test('canary: the sentinel never appears in any string reached from any bundle', async () => {
      const sentinel = opts.canarySentinel ?? 'RUNWIRE_CANARY_';
      const bundles = await collectAll(adapter, ctx);
      for (const bundle of bundles) {
        everyString(bundle, (s) => {
          expect(s.includes(sentinel)).toBe(false);
        });
      }
    });

    test('capabilities: CAPABILITY_FIELDS both directions over the discovered union', async () => {
      const bundles = await collectAll(adapter, ctx);
      const observed = new Set<Capability>();

      for (const bundle of bundles) {
        for (const cap of CAPABILITIES) {
          const gate = CAPABILITY_FIELDS[cap];
          if (gate.sessionFields.some((f) => bundle.session[f] !== undefined)) {
            observed.add(cap);
          }
          for (const step of bundle.steps) {
            if (gate.stepKinds.includes(step.kind)) observed.add(cap);
            for (const key of gate.stepFields) {
              const dot = key.indexOf('.');
              const kind = key.slice(0, dot) as StepKind;
              const field = key.slice(dot + 1);
              if (step.kind === kind && stepFieldValue(step, field) !== undefined) {
                observed.add(cap);
              }
            }
          }
        }
      }

      for (const cap of adapter.capabilities) {
        expect(observed.has(cap)).toBe(true);
      }
      for (const cap of observed) {
        expect(adapter.capabilities.includes(cap)).toBe(true);
      }
    });
  });
}
