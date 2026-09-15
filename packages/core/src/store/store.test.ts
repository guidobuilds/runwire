import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from './schema';
import { openStore } from './store';

function insertBaseSession(db: Database, id: string, opts: { parentId?: string } = {}) {
  db.exec(
    'INSERT OR IGNORE INTO harnesses (id, display_name, adapter_version, capabilities) VALUES (?, ?, ?, ?)',
    ['fake', 'Fake', '1.0.0', '[]'],
  );
  db.exec('INSERT OR IGNORE INTO projects (key, name, identity) VALUES (?, ?, ?)', [
    'k',
    'k',
    'cwd',
  ]);
  db.exec(
    `INSERT INTO sessions (id, harness_id, project_key, parent_id, depth, source_path, source_size, source_mtime)
     VALUES (?, 'fake', 'k', ?, 0, ?, 1, 1)`,
    [id, opts.parentId ?? null, `/fake/${id}.jsonl`],
  );
}

describe('openStore', () => {
  test('returns a db and close(), works on :memory:', () => {
    const store = openStore(':memory:');
    expect(store.db).toBeDefined();
    const rows = store.db.query('SELECT name FROM sqlite_master WHERE type = ?').all('table');
    expect(Array.isArray(rows)).toBe(true);
    store.close();
  });

  test('foreign_keys pragma is on', () => {
    const store = openStore(':memory:');
    const row = store.db.query('PRAGMA foreign_keys').get() as { foreign_keys: number };
    expect(row.foreign_keys).toBe(1);
    store.close();
  });
});

describe('openStore file permissions (SEC-03)', () => {
  test.skipIf(process.platform === 'win32')(
    'restricts a new file and its WAL sidecars to owner-only (0o600)',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'runwire-store-'));
      const path = join(dir, 'runwire.db');
      const store = openStore(path);
      try {
        for (const p of [path, `${path}-wal`, `${path}-shm`]) {
          if (!existsSync(p)) continue;
          expect(statSync(p).mode & 0o077).toBe(0);
        }
        expect(statSync(path).mode & 0o077).toBe(0);
      } finally {
        store.close();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  test.skipIf(process.platform === 'win32')('tightens a pre-existing lax file on open', () => {
    const dir = mkdtempSync(join(tmpdir(), 'runwire-store-'));
    const path = join(dir, 'runwire.db');
    // Simulates a DB created before SEC-03 under umask 022.
    writeFileSync(path, '');
    chmodSync(path, 0o644);
    const store = openStore(path);
    try {
      expect(statSync(path).mode & 0o077).toBe(0);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test(':memory: still opens without touching the filesystem', () => {
    const store = openStore(':memory:');
    expect(store.db).toBeDefined();
    store.close();
  });
});

describe('migrate', () => {
  test('creates every §5 table, index and view', () => {
    const db = new Database(':memory:');
    migrate(db);
    const names = (
      db.query('SELECT name FROM sqlite_master WHERE type IN (?, ?)').all('table', 'view') as {
        name: string;
      }[]
    ).map((r) => r.name);
    for (const t of [
      'harnesses',
      'projects',
      'sessions',
      'steps',
      'session_tool_counts',
      'diagnostics',
      'rollups',
      'project_aggregates',
      'harness_aggregates',
    ]) {
      expect(names).toContain(t);
    }
    db.close();
  });

  test('running migrate twice is a no-op', () => {
    const db = new Database(':memory:');
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
    db.close();
  });

  test('migrate adds skill_name to a legacy steps table and the second run is a no-op', () => {
    const db = new Database(':memory:');
    // A pre-skill-name `steps` table (the legacy shape, no skill_name column).
    db.exec(
      'CREATE TABLE steps (session_id TEXT, seq INTEGER, kind TEXT, PRIMARY KEY (session_id, seq))',
    );
    expect(
      (db.query('PRAGMA table_info(steps)').all() as { name: string }[]).some(
        (c) => c.name === 'skill_name',
      ),
    ).toBe(false);
    migrate(db);
    const colsAfter = db.query('PRAGMA table_info(steps)').all() as { name: string }[];
    expect(colsAfter.some((c) => c.name === 'skill_name')).toBe(true);
    expect(() => migrate(db)).not.toThrow();
    db.close();
  });
});

describe('parent_id has no FK (plan P20)', () => {
  test('inserting a session whose parent_id does not exist succeeds', () => {
    const store = openStore(':memory:');
    expect(() => insertBaseSession(store.db, 'orphan', { parentId: 'ghost-parent' })).not.toThrow();
    const row = store.db.query('SELECT parent_id FROM sessions WHERE id = ?').get('orphan') as {
      parent_id: string;
    };
    expect(row.parent_id).toBe('ghost-parent');
    store.close();
  });
});

describe('cascades', () => {
  test('deleting a session cascades to steps, session_tool_counts, diagnostics and rollups', () => {
    const store = openStore(':memory:');
    const { db } = store;
    insertBaseSession(db, 's1');
    db.exec("INSERT INTO steps (session_id, seq, kind) VALUES ('s1', 0, 'turn')");
    db.exec(
      "INSERT INTO session_tool_counts (session_id, category, count) VALUES ('s1', 'read', 1)",
    );
    db.exec(
      "INSERT INTO diagnostics (session_id, level, code, message) VALUES ('s1', 'info', 'x', 'x')",
    );
    db.exec(
      "INSERT INTO rollups (session_id, uncached_input, cached_input, cache_write, output, reasoning_output, api_calls, tool_calls, compactions, descendants) VALUES ('s1', 1, 1, 1, 1, 1, 1, 1, 1, 0)",
    );

    db.exec("DELETE FROM sessions WHERE id = 's1'");

    expect(db.query('SELECT * FROM steps WHERE session_id = ?').all('s1').length).toBe(0);
    expect(
      db.query('SELECT * FROM session_tool_counts WHERE session_id = ?').all('s1').length,
    ).toBe(0);
    expect(db.query('SELECT * FROM diagnostics WHERE session_id = ?').all('s1').length).toBe(0);
    expect(db.query('SELECT * FROM rollups WHERE session_id = ?').all('s1').length).toBe(0);
    store.close();
  });

  test('control: a fresh connection without the foreign_keys pragma does not cascade', () => {
    const db = new Database(':memory:');
    // No `PRAGMA foreign_keys = ON` here - this is the negative control.
    migrate(db);
    insertBaseSession(db, 's1');
    db.exec("INSERT INTO steps (session_id, seq, kind) VALUES ('s1', 0, 'turn')");

    db.exec("DELETE FROM sessions WHERE id = 's1'");

    const remaining = db.query('SELECT * FROM steps WHERE session_id = ?').all('s1');
    expect(remaining.length).toBe(1);
    db.close();
  });
});
