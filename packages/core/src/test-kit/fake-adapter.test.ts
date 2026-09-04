import { describe, expect, test } from 'bun:test';
import { createMemoryFs } from '../adapter/fs.memory';
import type { AdapterContext } from '../adapter/types';
import type { Known } from '../contract/adapter';
import { createFakeAdapter } from './fake-adapter';

function ctx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    home: '/home/u',
    platform: 'linux',
    env: {},
    fs: createMemoryFs(),
    privacy: { titles: true },
    log: { info() {}, warn() {}, error() {} },
    ...overrides,
  };
}

async function idsOf(adapter: ReturnType<typeof createFakeAdapter>, known: Known = new Map()) {
  const ids: string[] = [];
  for await (const bundle of adapter.discover(ctx(), known)) ids.push(bundle.session.id);
  return ids;
}

const BASE_IDS = [
  'fake:root',
  'fake:child1',
  'fake:child2',
  'fake:child3',
  'fake:child4',
  'fake:grandchild',
  'fake:orphan',
  'fake:diagnosed',
  'fake:titled',
];

describe('createFakeAdapter', () => {
  test('id, capabilities and probe defaults', async () => {
    const adapter = createFakeAdapter();
    expect(adapter.id).toBe('fake');
    const probe = await adapter.probe(ctx());
    expect(probe).toEqual({ installed: true, roots: ['/fake'], notes: [] });
  });

  test('opts.installed=false is honored by probe', async () => {
    const adapter = createFakeAdapter({ installed: false });
    const probe = await adapter.probe(ctx());
    expect(probe.installed).toBe(false);
  });

  test('discover yields exactly the base scenario ids, session.id starting with "fake:"', async () => {
    const adapter = createFakeAdapter();
    const ids = await idsOf(adapter);
    expect(ids).toEqual(BASE_IDS);
    for (const id of ids) expect(id.startsWith('fake:')).toBe(true);
  });

  test('opts.includeInvalid adds fake:invalid with a negative seq step', async () => {
    const adapter = createFakeAdapter({ includeInvalid: true });
    const bundles: string[] = [];
    let invalidSeq: number | undefined;
    for await (const bundle of adapter.discover(ctx(), new Map())) {
      bundles.push(bundle.session.id);
      if (bundle.session.id === 'fake:invalid') invalidSeq = bundle.steps[0]?.seq;
    }
    expect(bundles).toContain('fake:invalid');
    expect(invalidSeq).toBe(-1);
  });

  test('opts.scenarios restricts discover to exactly the listed ids', async () => {
    const adapter = createFakeAdapter({ scenarios: ['child1', 'child2'] });
    const ids = await idsOf(adapter);
    expect(ids).toEqual(['fake:child1', 'fake:child2']);
  });

  test('known: a scenario whose stored size/mtime match is skipped', async () => {
    const adapter = createFakeAdapter();
    const known: Known = new Map([['/fake/root.jsonl', { size: 1000, mtime: 1000 }]]);
    const ids = await idsOf(adapter, known);
    expect(ids).not.toContain('fake:root');
    expect(ids).toEqual(BASE_IDS.filter((id) => id !== 'fake:root'));
  });

  test('known: a mismatched size/mtime still re-emits the scenario', async () => {
    const adapter = createFakeAdapter();
    const known: Known = new Map([['/fake/root.jsonl', { size: 999, mtime: 1000 }]]);
    const ids = await idsOf(adapter, known);
    expect(ids).toContain('fake:root');
  });

  test('title is honored by ctx.privacy.titles', async () => {
    const adapter = createFakeAdapter();
    let withTitles: string | undefined;
    let withoutTitles: string | undefined;
    for await (const b of adapter.discover(ctx({ privacy: { titles: true } }), new Map())) {
      if (b.session.id === 'fake:root') withTitles = b.session.title;
    }
    for await (const b of adapter.discover(ctx({ privacy: { titles: false } }), new Map())) {
      if (b.session.id === 'fake:root') withoutTitles = b.session.title;
    }
    expect(withTitles).toBeDefined();
    expect(withoutTitles).toBeUndefined();
  });

  test('child3/child4 both declare spawnCallId c2 (collision fixture for link.ts MIN(id))', async () => {
    const adapter = createFakeAdapter();
    const bundles = [];
    for await (const b of adapter.discover(ctx(), new Map())) bundles.push(b);
    const child3 = bundles.find((b) => b.session.id === 'fake:child3');
    const child4 = bundles.find((b) => b.session.id === 'fake:child4');
    expect(child3?.session.spawnCallId).toBe('c2');
    expect(child4?.session.spawnCallId).toBe('c2');
  });
});
