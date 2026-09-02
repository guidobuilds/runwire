import { describe, expect, test } from 'bun:test';
import { createBunFs } from '../adapter/fs.bun';
import type { AdapterContext, HarnessAdapter, SourceRef } from '../adapter/types';
import type { ScoutEvent } from '../events/event';
import type { HarnessId } from '../model/harness';
import type { InitiatorKind } from '../model/session';
import { ScoutStore } from './store';

/**
 * `ScoutStore`'s automated-session filter, at the one seam every list and every
 * aggregate in the product reads (`getRoots` -> `getProjects`/`getHarnesses`
 * and the three `/api` list routes).
 *
 * A dedicated in-file adapter rather than `test-kit`'s shared
 * `createFakeAdapter`: this fixture's whole point is a hand-placed mix of
 * initiator verdicts (including the two that must NOT be hidden), and per
 * .forge/lessons.md `fake-adapter-shared-fixture` the shared double is edited
 * by other dispatches, so pinning counts against it would be fragile.
 */

type Root = {
  sourceId: string;
  cwd: string;
  /** Absent = the harness reported no initiator signal at all (old sessions). */
  initiator?: { kind: InitiatorKind; surface: string; automation?: string };
  output: number;
};

/**
 * Four projects covering every branch the filter can take:
 * - `alpha` is mixed, so it survives the filter but narrows,
 * - `ghost` is 100% machine — the shape of the 182 real `detector-eval-*` temp
 *   dirs that have no human session at all — so it must disappear entirely,
 * - `legacy` has no initiator signal (pre-`entrypoint` sessions),
 * - `novel` reports a surface this adapter version does not recognise.
 *
 * `legacy` and `novel` are the controls that keep the filter conservative: a
 * filter that hid "we don't know" would hide real work every time a harness
 * shipped a new surface value.
 */
const ROOTS: Root[] = [
  {
    sourceId: 'a-human',
    cwd: '/repos/alpha',
    initiator: { kind: 'human', surface: 'cli' },
    output: 1,
  },
  {
    sourceId: 'a-machine',
    cwd: '/repos/alpha',
    initiator: { kind: 'machine', surface: 'sdk-py', automation: 'sdk' },
    output: 10,
  },
  {
    sourceId: 'g-machine-1',
    cwd: '/repos/ghost',
    initiator: { kind: 'machine', surface: 'sdk-cli', automation: 'sdk' },
    output: 100,
  },
  {
    sourceId: 'g-machine-2',
    cwd: '/repos/ghost',
    initiator: { kind: 'machine', surface: 'cli', automation: 'subagent-dispatch' },
    output: 1000,
  },
  { sourceId: 'legacy', cwd: '/repos/legacy', output: 10_000 },
  {
    sourceId: 'novel',
    cwd: '/repos/novel',
    initiator: { kind: 'unknown', surface: 'some-future-surface' },
    output: 100_000,
  },
];

/** A subagent of the one human root: proves children never enter the root set. */
const CHILD_OF_HUMAN = 'a-human-child';

function initiatorAdapter(): HarnessAdapter {
  const refs: SourceRef[] = [
    ...ROOTS.map((r) => ({
      sourceId: r.sourceId,
      path: `/probe/${r.sourceId}.json`,
      kind: 'root' as const,
      sizeBytes: 10,
      mtimeMs: 1,
    })),
    {
      sourceId: CHILD_OF_HUMAN,
      path: `/probe/${CHILD_OF_HUMAN}.json`,
      kind: 'child' as const,
      sizeBytes: 10,
      mtimeMs: 1,
      parentHint: 'a-human',
    },
  ];

  return {
    id: 'fake' as HarnessId,
    displayName: 'Initiator probe',
    adapterVersion: '1.0.0',
    capabilities: ['timing', 'initiator'],
    allowlist: { kind: true, sourceId: true, role: true },
    explain: () => undefined,
    toolCategory: () => 'other' as const,
    harnessEventNames: [],
    async probe() {
      return { installed: true, roots: [], notes: [] };
    },
    async *discover() {
      for (const ref of refs) yield ref;
    },
    async *parse(ref: SourceRef): AsyncIterable<ScoutEvent> {
      if (ref.sourceId === CHILD_OF_HUMAN) {
        yield {
          kind: 'meta',
          sourceId: CHILD_OF_HUMAN,
          role: 'child',
          cwd: '/repos/alpha',
          at: '2026-01-01T00:01:00Z',
        };
        yield { kind: 'link', parentSourceId: 'a-human', relation: 'subagent', depth: 1 };
        // Machine-ish surface on a CHILD: the filter only ever applies to
        // roots, so this must not change any count either way.
        yield {
          kind: 'initiator',
          initiatorKind: 'machine',
          surface: 'sdk-cli',
          automation: 'sdk',
          confidence: 'high',
        };
        yield { kind: 'observed', at: '2026-01-01T00:02:00Z' };
        return;
      }

      const root = ROOTS.find((r) => r.sourceId === ref.sourceId);
      if (!root) return;
      yield {
        kind: 'meta',
        sourceId: root.sourceId,
        role: 'root',
        cwd: root.cwd,
        at: '2026-01-01T00:00:00Z',
      };
      if (root.initiator) {
        yield {
          kind: 'initiator',
          initiatorKind: root.initiator.kind,
          surface: root.initiator.surface,
          ...(root.initiator.automation ? { automation: root.initiator.automation } : {}),
          confidence: 'high',
        };
      }
      yield {
        kind: 'usage',
        dedupeKey: `${root.sourceId}-req`,
        model: 'probe-model',
        output: root.output,
      };
      yield { kind: 'observed', at: '2026-01-01T00:05:00Z' };
    },
  };
}

async function scannedStore(): Promise<ScoutStore> {
  const ctx: AdapterContext = {
    home: '/home/u',
    platform: 'linux',
    env: {},
    fs: createBunFs(),
    privacy: { titles: true },
    log: { info() {}, warn() {}, error() {} },
  };
  const store = new ScoutStore([initiatorAdapter()], ctx, { projectIdentity: 'cwd' });
  await store.rescan();
  return store;
}

const INCLUDE = { excludeAutomated: false } as const;
const EXCLUDE = { excludeAutomated: true } as const;

function ids(summaries: Array<{ id: string }>): string[] {
  return summaries.map((s) => s.id).sort();
}

function projectNames(store: ScoutStore, query: { excludeAutomated: boolean }): string[] {
  return store
    .getProjects(query)
    .map((p) => p.project.name)
    .sort();
}

describe('ScoutStore.getRoots — the automated filter seam', () => {
  test('excludeAutomated: false is the whole root set, children excluded as always', async () => {
    const store = await scannedStore();
    expect(ids(store.getRoots(INCLUDE))).toEqual(
      ids(ROOTS.map((r) => ({ id: `fake:${r.sourceId}` }))),
    );
    // The child carries a machine initiator and is still absent from BOTH sets:
    // "root" is about parentage, not provenance.
    expect(store.getRoots(INCLUDE).some((s) => s.id === `fake:${CHILD_OF_HUMAN}`)).toBe(false);
    expect(store.getRoots(EXCLUDE).some((s) => s.id === `fake:${CHILD_OF_HUMAN}`)).toBe(false);
  });

  test('excludeAutomated: true drops only kind === machine', async () => {
    const store = await scannedStore();
    expect(ids(store.getRoots(EXCLUDE))).toEqual([
      'fake:a-human',
      'fake:legacy', // no initiator signal at all
      'fake:novel', // kind: 'unknown'
    ]);
  });

  test('a hidden root is still resolvable by id, and so is its subtree and rollup', async () => {
    const store = await scannedStore();
    // The point of filtering in getRoots and NOT in state.summaries: Compare,
    // deep links and the Back button must still reach a hidden session.
    expect(store.getSession('fake:a-machine')?.id).toBe('fake:a-machine');
    expect(store.getRollup('fake:a-machine')).toBeDefined();
    expect(store.getSubtree('fake:g-machine-1').map((s) => s.id)).toEqual(['fake:g-machine-1']);
    expect(store.getSummaries().length).toBe(ROOTS.length + 1);
  });
});

describe('ScoutStore.getProjects — rollup under the filter (f8)', () => {
  test('unfiltered, every project including the all-machine one is present', async () => {
    const store = await scannedStore();
    expect(projectNames(store, INCLUDE)).toEqual(['alpha', 'ghost', 'legacy', 'novel']);
  });

  test('a project whose roots are 100% machine disappears entirely', async () => {
    const store = await scannedStore();
    const names = projectNames(store, EXCLUDE);
    expect(names).toEqual(['alpha', 'legacy', 'novel']);
    // Not "present with sessionCount 0" — a project only exists as long as some
    // visible root claims it.
    expect(store.getProjects(EXCLUDE).some((p) => p.project.name === 'ghost')).toBe(false);
  });

  test('a mixed project survives but narrows its count and its usage total', async () => {
    const store = await scannedStore();
    const before = store.getProjects(INCLUDE).find((p) => p.project.name === 'alpha');
    const after = store.getProjects(EXCLUDE).find((p) => p.project.name === 'alpha');

    expect(before?.sessionCount).toBe(2);
    expect(after?.sessionCount).toBe(1);
    // Inclusive rollup usage: unfiltered alpha is the human root (1) + its
    // subagent (0 usage) + the machine root (10); filtered is the human root
    // and its subagent alone. Aggregates follow the filter — a hidden session
    // must not contribute tokens to anything on screen.
    expect(before?.aggregateUsage.output?.value).toBe(11);
    expect(after?.aggregateUsage.output?.value).toBe(1);
  });

  test('projects with no initiator signal or an unrecognised one are never hidden', async () => {
    const store = await scannedStore();
    const filtered = store.getProjects(EXCLUDE);
    expect(filtered.find((p) => p.project.name === 'legacy')?.sessionCount).toBe(1);
    expect(filtered.find((p) => p.project.name === 'novel')?.sessionCount).toBe(1);
  });
});

describe('ScoutStore.getHarnesses — rollup under the filter', () => {
  test('session count and usage follow the same filter as projects', async () => {
    const store = await scannedStore();
    const [before] = store.getHarnesses(INCLUDE);
    const [after] = store.getHarnesses(EXCLUDE);

    expect(before?.sessionCount).toBe(ROOTS.length);
    expect(after?.sessionCount).toBe(3);
    // 1 + 10 + 100 + 1000 + 10000 + 100000 vs 1 + 10000 + 100000.
    expect(before?.aggregateUsage.output?.value).toBe(111_111);
    expect(after?.aggregateUsage.output?.value).toBe(110_001);
    // The ghost project's key is gone from the harness's project list too.
    expect(before?.projects.some((k) => k.includes('ghost'))).toBe(true);
    expect(after?.projects.some((k) => k.includes('ghost'))).toBe(false);
  });
});
