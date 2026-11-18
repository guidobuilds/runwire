import { describe, expect, test } from 'bun:test';
import { cpSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { AdapterContext, Session, SessionBundle, StepKind, ToolCategory } from '@runwire/core';
import { createBunFs } from '@runwire/core';
import { createGentleShellAdapter } from './index';

const FIXTURES_ROOT = join(import.meta.dir, '..', '..', '..', '..', 'fixtures', 'gentle-shell');
const CASES = [
  'small',
  'subagents',
  'published-state',
  'unlinked',
  'cross-home',
  'duplicate',
  'extra-usage',
  'new-format',
  'malformed',
  'canary',
  'fork',
];

type Expected = {
  sessions: (Omit<Session, 'sourceMtime' | 'sourcePath'> & { sourcePath: string })[];
  stepCounts: Record<string, Partial<Record<StepKind, number>>>;
  toolCounts: Record<string, Partial<Record<ToolCategory, number>>>;
  diagnostics: Record<string, { level: string; code: string; count?: number }[]>;
};

if (process.env.UPDATE_EXPECTED === '1') {
  for (const name of CASES) {
    cpSync(join(FIXTURES_ROOT, name, 'home'), join(FIXTURES_ROOT, 'all', 'home'), {
      recursive: true,
    });
  }
}

async function computeExpected(name: string): Promise<Expected> {
  const ctx: AdapterContext = {
    home: join(FIXTURES_ROOT, name, 'home'),
    platform: 'darwin',
    env: {},
    fs: createBunFs(),
    privacy: { titles: true },
    log: { info() {}, warn() {}, error() {} },
  };
  const bundles: SessionBundle[] = [];
  for await (const b of createGentleShellAdapter().discover(ctx, new Map())) bundles.push(b);
  bundles.sort((a, b) => a.session.id.localeCompare(b.session.id));
  const sessions = bundles.map((b) => {
    const { sourceMtime: _sourceMtime, sourcePath, ...rest } = b.session;
    return { ...rest, sourcePath: relative(ctx.home, sourcePath).replaceAll('\\', '/') };
  });
  const stepCounts: Expected['stepCounts'] = {};
  const toolCounts: Expected['toolCounts'] = {};
  const diagnostics: Expected['diagnostics'] = {};
  for (const b of bundles) {
    const sc: Partial<Record<StepKind, number>> = {};
    const tc: Partial<Record<ToolCategory, number>> = {};
    for (const s of b.steps) {
      sc[s.kind] = (sc[s.kind] ?? 0) + 1;
      if (s.kind === 'tool' && s.toolCategory) tc[s.toolCategory] = (tc[s.toolCategory] ?? 0) + 1;
    }
    stepCounts[b.session.id] = sc;
    toolCounts[b.session.id] = tc;
    diagnostics[b.session.id] = b.diagnostics.map((d) => ({
      level: d.level,
      code: d.code,
      ...(d.count !== undefined ? { count: d.count } : {}),
    }));
  }
  return { sessions, stepCounts, toolCounts, diagnostics };
}

describe('fixtures/gentle-shell/<case>/expected.json snapshots', () => {
  for (const name of [...CASES, 'all']) {
    test(`${name}: discover() output matches expected.json`, async () => {
      const actual = await computeExpected(name);
      const path = join(FIXTURES_ROOT, name, 'expected.json');
      if (process.env.UPDATE_EXPECTED === '1') {
        writeFileSync(path, `${JSON.stringify(actual, null, 2)}\n`);
      }
      expect(actual).toEqual(JSON.parse(readFileSync(path, 'utf8')));
    });
  }

  test('all/home is exactly the union of case homes, including hidden directories', () => {
    const files = (root: string): string[] =>
      readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => relative(root, join(entry.parentPath, entry.name)))
        .sort();
    const union = new Map<string, Buffer<ArrayBuffer>>();
    for (const name of CASES) {
      const home = join(FIXTURES_ROOT, name, 'home');
      for (const file of files(home)) {
        expect(union.has(file)).toBe(false);
        union.set(file, readFileSync(join(home, file)));
      }
    }
    const all = join(FIXTURES_ROOT, 'all', 'home');
    expect(files(all)).toEqual([...union.keys()].sort());
    for (const [file, bytes] of union) expect(readFileSync(join(all, file))).toEqual(bytes);
  });
});
