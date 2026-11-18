import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createGentleShellAdapter, createPiAdapter } from '@runwire/adapter-pi';
import { SessionBundleSchema } from '@runwire/core';
import { adapters } from './adapters';

const root = resolve(import.meta.dir, '../../..');

async function discover(id: string, fixture: string) {
  const proc = Bun.spawn(
    [
      process.execPath,
      'packages/cli/src/index.ts',
      'discover',
      '--adapter',
      id,
      '--home',
      fixture,
      '--json',
    ],
    {
      cwd: root,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) => !key.startsWith('PI_') && !key.startsWith('GENTLE_'),
          ),
        ),
        RUNWIRE_DEBUG: '1',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

test('registry preserves existing factories and appends Gentle Shell after Pi (D25)', () => {
  expect(adapters.map((adapter) => adapter.id)).toEqual([
    'claude-code',
    'opencode',
    'pi',
    'gentle-shell',
  ]);
  expect(adapters.find((adapter) => adapter.id === 'pi')).toEqual(createPiAdapter());
  expect(adapters.find((adapter) => adapter.id === 'gentle-shell')).toEqual(
    createGentleShellAdapter(),
  );
});

test.each(['claude-code', 'opencode', 'pi', 'gentle-shell'])(
  '%s stays reachable through discover with valid NDJSON and no stderr',
  async (id) => {
    const result = await discover(id, `fixtures/${id}/small/home`);
    if (id === 'opencode') {
      const absolute = resolve(root, 'fixtures/opencode/small/home');
      const second = await discover(id, absolute);
      console.error(
        'DEBUG-OPENCODE',
        JSON.stringify({
          cwd: root,
          absolute,
          dbExists: existsSync(`${absolute}/.local/share/opencode/opencode.db`),
          relative: { code: result.code, out: result.stdout.slice(0, 120), err: result.stderr },
          absoluteRun: { code: second.code, out: second.stdout.slice(0, 120), err: second.stderr },
        }),
      );
    }
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    const lines = result.stdout.trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const bundle = SessionBundleSchema.parse(JSON.parse(line));
      expect(bundle.session.harnessId).toBe(id);
    }
  },
);

test('coverage docs name every registered harness and pin Gentle Shell privacy boundaries', async () => {
  const doc = await readFile(resolve(root, 'docs/usage/what-runwire-knows.md'), 'utf8');
  for (const adapter of adapters) {
    expect(doc).toContain(`| ${adapter.displayName}`);
  }
  expect(doc).toContain('link metadata');
  expect(doc).toContain('tool names, usage and timings');
  expect(doc).toContain('custom.data');
  expect(doc).toContain('ledger prompt/result/thread');
  expect(doc).toContain('parents remain `pi`');
});
