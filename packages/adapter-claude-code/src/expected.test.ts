import { describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { AdapterContext, Session, SessionBundle, StepKind, ToolCategory } from '@runwire/core';
import { createBunFs } from '@runwire/core';
import { createClaudeCodeAdapter } from './index';

const FIXTURES_ROOT = join(import.meta.dir, '..', '..', '..', 'fixtures', 'claude-code');

const CASES = ['small', 'medium', 'subagents', 'old-version', 'dispatch', 'malformed', 'canary'];

type ExpectedSession = Omit<Session, 'sourceMtime' | 'sourcePath'> & { sourcePath: string };
type ExpectedDiagnostic = { level: string; code: string; count?: number };
type Expected = {
  sessions: ExpectedSession[];
  stepCounts: Record<string, Partial<Record<StepKind, number>>>;
  toolCounts: Record<string, Partial<Record<ToolCategory, number>>>;
  diagnostics: Record<string, ExpectedDiagnostic[]>;
};

function contextFor(name: string): AdapterContext {
  return {
    home: join(FIXTURES_ROOT, name, 'home'),
    platform: 'darwin',
    env: {},
    fs: createBunFs(),
    privacy: { titles: true },
    log: { info() {}, warn() {}, error() {} },
  };
}

async function computeExpected(name: string): Promise<Expected> {
  const ctx = contextFor(name);
  const adapter = createClaudeCodeAdapter();
  const bundles: SessionBundle[] = [];
  for await (const b of adapter.discover(ctx, new Map())) bundles.push(b);
  bundles.sort((a, b) => a.session.id.localeCompare(b.session.id));

  const sessions: ExpectedSession[] = bundles.map((b) => {
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
      if (s.kind === 'tool' && s.toolCategory) {
        tc[s.toolCategory] = (tc[s.toolCategory] ?? 0) + 1;
      }
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

function expectedPath(name: string): string {
  return join(FIXTURES_ROOT, name, 'expected.json');
}

describe('fixtures/claude-code/<case>/expected.json snapshots', () => {
  for (const name of CASES) {
    test(`${name}: discover() output matches expected.json`, async () => {
      const actual = await computeExpected(name);
      const path = expectedPath(name);
      if (process.env.UPDATE_EXPECTED === '1') {
        writeFileSync(path, `${JSON.stringify(actual, null, 2)}\n`);
      }
      const expected = JSON.parse(readFileSync(path, 'utf8'));
      expect(actual).toEqual(expected);
    });
  }
});
