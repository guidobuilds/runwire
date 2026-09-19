import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { HarnessAdapter, SessionBundle } from '@runwire/core';
import { SessionBundleSchema } from '@runwire/core';
import { runDiscover } from './commands/discover';

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

// `discover --json` must not be the one dump path that skips import's strict
// schema gate (cli-report M2): an adapter object with an unrecognized key is a
// contract violation, so the line is dropped (never stringified raw) and the
// run exits 1, while valid lines already emitted are kept.
function fakeBundle(): Record<string, unknown> {
  return {
    project: { key: 'k', name: 'n', identity: 'cwd' },
    session: {
      id: 'fake:s1',
      harnessId: 'fake',
      projectKey: 'k',
      depth: 0,
      sourcePath: '/fake/s1.jsonl',
      sourceSize: 10,
      sourceMtime: 1,
    },
    steps: [],
    diagnostics: [],
  };
}

function fakeAdapter(bundles: unknown[]): HarnessAdapter {
  return {
    id: 'fake',
    displayName: 'Fake',
    adapterVersion: '0',
    capabilities: [],
    allowlist: {},
    probe: async () => ({ installed: true, roots: [], notes: [] }),
    discover: async function* () {
      for (const bundle of bundles) yield bundle as SessionBundle;
    },
  };
}

async function runDiscoverCaptured(
  bundles: unknown[],
  json: boolean,
): Promise<{ code: number; logs: string[]; errors: string[] }> {
  const logs: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  };
  try {
    const code = await runDiscover({
      adapters: [fakeAdapter(bundles)],
      adapterId: 'fake',
      json,
      titles: true,
    });
    return { code, logs, errors };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}

describe('runDiscover bundle validation', () => {
  test('--json drops an unknown-key bundle, keeps valid lines and exits 1', async () => {
    const valid = fakeBundle();
    const invalid = {
      ...fakeBundle(),
      prompt: 'RUNWIRE_CANARY_1',
    };
    const { code, logs, errors } = await runDiscoverCaptured([valid, invalid], true);

    expect(code).toBe(1);
    // Only the valid bundle reaches stdout, and it is the schema's output.
    expect(logs.length).toBe(1);
    expect(SessionBundleSchema.safeParse(JSON.parse(logs[0] ?? '')).success).toBe(true);

    const stdout = logs.join('\n');
    expect(stdout).not.toContain('prompt');
    expect(stdout).not.toContain('RUNWIRE_CANARY_1');

    const stderr = errors.join('\n');
    expect(stderr).toContain('invalid bundle');
    expect(stderr).toContain('unrecognized_keys');
    expect(stderr).toContain('prompt');
    // Issue strings name keys only, never values.
    expect(stderr).not.toContain('RUNWIRE_CANARY_1');
  });

  test('human mode never prints the invalid bundle and exits 1', async () => {
    const invalid = { ...fakeBundle(), prompt: 'RUNWIRE_CANARY_1' };
    const { code, logs, errors } = await runDiscoverCaptured([invalid], false);

    expect(code).toBe(1);
    expect(logs).toEqual([]);
    expect(errors.join('\n')).toContain('unrecognized_keys');
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

  test.skipIf(process.platform === 'win32')(
    '--db ~/.runwire/runwire.db writes under $HOME, never a literal cwd/~ directory',
    async () => {
      const fakeHome = await mkdtemp(join(tmpdir(), 'runwire-cli-home-test-'));
      try {
        const proc = Bun.spawn(
          [
            process.execPath,
            CLI_SCRIPT,
            'import',
            '--db',
            '~/.runwire/runwire.db',
            '--home',
            'fixtures/claude-code/small/home',
          ],
          {
            cwd: REPO_ROOT,
            env: { ...process.env, HOME: fakeHome },
            stdout: 'pipe',
            stderr: 'pipe',
          },
        );
        const [stdout, stderr, code] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);

        expect(code).toBe(0);
        expect(stdout).toBe('');
        expect(stderr).toContain('imported=1');
        expect(existsSync(join(fakeHome, '.runwire', 'runwire.db'))).toBe(true);
        // The bug created this literal directory under cwd.
        expect(existsSync(join(REPO_ROOT, '~'))).toBe(false);
      } finally {
        await rm(fakeHome, { recursive: true, force: true });
      }
    },
  );

  test('opencode: a present-but-unreadable origin DB exits 1, retains prior rows and leaks no raw error', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'runwire-cli-opencode-readfail-test-'));
    const dbPath = join(tmpDir, 'runwire.db');
    const badHome = join(tmpDir, 'bad-home');
    try {
      const healthy = await run([
        'import',
        '--adapter',
        'opencode',
        '--db',
        dbPath,
        '--home',
        'fixtures/opencode/small/home',
      ]);
      expect(healthy.code).toBe(0);
      expect(healthy.stderr).toContain('imported=1');

      const opencodeDir = join(badHome, '.local', 'share', 'opencode');
      await mkdir(opencodeDir, { recursive: true });
      await writeFile(join(opencodeDir, 'opencode.db'), 'this is not a sqlite database\n');

      const failed = await run([
        'import',
        '--adapter',
        'opencode',
        '--db',
        dbPath,
        '--home',
        badHome,
      ]);
      expect(failed.code).toBe(1);
      expect(failed.stderr).toContain('source-read-failed');
      expect(failed.stderr).toContain('removed=0');
      // Privacy: the raw SQLite error and the temp path never reach stderr.
      expect(failed.stderr).not.toMatch(/not a database|SQLITE|malformed/i);
      expect(failed.stderr).not.toContain(badHome);

      const db = new Database(dbPath, { readonly: true });
      try {
        const rows = db
          .query("SELECT id FROM sessions WHERE id = 'opencode:current:ses_small'")
          .all();
        expect(rows).toHaveLength(1);
      } finally {
        db.close();
      }
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
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
