import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SessionBundleSchema } from '@runwire/core';

// Never 'bun' from PATH (Windows lookup, PATH-dependence) and never
// process.cwd() (depends on the caller's shell) - process.execPath is the
// PATH-independent spawn target, cwd is resolved from import.meta.dir so the
// script path 'packages/cli/src/index.ts' always resolves the same way
// regardless of where `bun test` was invoked from.
const REPO_ROOT = resolve(import.meta.dir, '../../..');
const CLI_SCRIPT = 'packages/cli/src/index.ts';

async function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, CLI_SCRIPT, ...args], {
    cwd: REPO_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

describe('runwire discover', () => {
  test('--json on small yields NDJSON where every line parses and validates', async () => {
    const { code, stdout, stderr } = await run([
      'discover',
      '--adapter',
      'claude-code',
      '--home',
      'fixtures/claude-code/small/home',
      '--json',
    ]);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    const lines = stdout.trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      const result = SessionBundleSchema.safeParse(parsed);
      expect(result.success).toBe(true);
    }
  });

  test('unknown --adapter exits 1 with empty stdout', async () => {
    const { code, stdout, stderr } = await run(['discover', '--adapter', 'nope']);
    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('nope');
  });

  test('missing --adapter exits 1 with empty stdout', async () => {
    const { code, stdout, stderr } = await run(['discover']);
    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(stderr.length).toBeGreaterThan(0);
  });
});

describe('runwire import', () => {
  let tmpDir: string;

  test('subagents fixture: row counts via bun:sqlite on a tmp DB', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'runwire-cli-import-test-'));
    const dbPath = join(tmpDir, 'runwire.db');
    try {
      const { code, stderr } = await run([
        'import',
        '--db',
        dbPath,
        '--home',
        'fixtures/claude-code/subagents/home',
      ]);
      expect(code).toBe(0);
      expect(stderr).toContain('imported=3');

      const db = new Database(dbPath, { readonly: true });
      try {
        const sessions = db.query('SELECT id, parent_id FROM sessions').all() as {
          id: string;
          parent_id: string | null;
        }[];
        expect(sessions.length).toBe(3);
        expect(sessions.filter((s) => s.parent_id !== null).length).toBe(2);

        const steps = db.query('SELECT child_id FROM steps WHERE child_id IS NOT NULL').all() as {
          child_id: string;
        }[];
        expect(steps.length).toBe(2);

        const rollups = db.query('SELECT session_id, descendants FROM rollups').all() as {
          session_id: string;
          descendants: number;
        }[];
        expect(rollups.length).toBe(3);
        const root = sessions.find((s) => s.parent_id === null);
        expect(root).toBeDefined();
        const rootRollup = rollups.find((r) => r.session_id === root?.id);
        expect(rootRollup?.descendants).toBe(2);
      } finally {
        db.close();
      }
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test(':memory: on malformed fixture exits 0 with imported: 1', async () => {
    const { code, stderr } = await run([
      'import',
      '--db',
      ':memory:',
      '--home',
      'fixtures/claude-code/malformed/home',
    ]);
    expect(code).toBe(0);
    expect(stderr).toContain('imported=1');
  });

  test('--force reimports sources that an incremental second run skips', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'runwire-cli-force-test-'));
    const dbPath = join(tmpDir, 'runwire.db');
    const args = ['import', '--db', dbPath, '--home', 'fixtures/claude-code/small/home'];
    try {
      const first = await run(args);
      expect(first.code).toBe(0);
      expect(first.stderr).toContain('imported=1');

      const incremental = await run(args);
      expect(incremental.code).toBe(0);
      expect(incremental.stderr).toContain('imported=0');
      expect(incremental.stderr).toContain('skipped=1');

      const forced = await run([...args, '--force']);
      expect(forced.code).toBe(0);
      expect(forced.stderr).toContain('imported=1');
      expect(forced.stderr).toContain('skipped=0');

      // The forced upsert stored fresh sourceSize/sourceMtime (persist.ts:95,
      // :137-138), so a normal run after the forced one resumes incremental
      // skipping rather than re-importing the unchanged source again.
      const postForce = await run(args);
      expect(postForce.code).toBe(0);
      expect(postForce.stderr).toContain('imported=0');
      expect(postForce.stderr).toContain('skipped=1');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
