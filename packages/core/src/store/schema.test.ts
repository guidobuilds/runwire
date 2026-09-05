import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { migrate } from './schema';

function columns(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

function hasIndex(db: Database, name: string): boolean {
  return (
    db.query(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`).get(name) !== null
  );
}

describe('migrate(): source_id/source_locator columns, backfill and UNIQUE index', () => {
  test('a fresh DB gets the source_id/source_locator columns and the UNIQUE index', () => {
    const db = new Database(':memory:');
    migrate(db);
    const cols = columns(db, 'sessions');
    expect(cols).toContain('source_id');
    expect(cols).toContain('source_locator');
    expect(hasIndex(db, 'idx_sessions_source_id')).toBe(true);
  });

  test('a pre-populated DB (rows with source_path, no source_id) is backfilled', () => {
    const db = new Database(':memory:');
    migrate(db);
    db.run(
      "INSERT INTO harnesses (id, display_name, adapter_version, capabilities) VALUES ('fake', 'Fake', '1.0.0', '[]')",
    );
    db.run(
      `INSERT INTO sessions (id, harness_id, project_key, depth, source_path, source_size, source_mtime)
       VALUES ('fake:s1', 'fake', NULL, 0, '/fake/s1.jsonl', 10, 1)`,
    );
    // Simulate a pre-migration row by NULLing the new columns.
    db.run('UPDATE sessions SET source_id = NULL, source_locator = NULL');

    migrate(db);

    const row = db
      .query('SELECT source_id, source_locator FROM sessions WHERE id = ?')
      .get('fake:s1') as { source_id: string | null; source_locator: string | null };
    expect(row.source_id).toBe('/fake/s1.jsonl');
    expect(row.source_locator).toBe('/fake/s1.jsonl');
  });

  test('running migrate() twice is a no-op (idempotent)', () => {
    const db = new Database(':memory:');
    migrate(db);
    db.run(
      "INSERT INTO harnesses (id, display_name, adapter_version, capabilities) VALUES ('fake', 'Fake', '1.0.0', '[]')",
    );
    db.run(
      `INSERT INTO sessions (id, harness_id, project_key, depth, source_path, source_size, source_mtime)
       VALUES ('fake:s1', 'fake', NULL, 0, '/fake/s1.jsonl', 10, 1)`,
    );
    migrate(db);
    migrate(db);
    const cols = columns(db, 'sessions');
    expect(cols).toContain('source_id');
    expect(hasIndex(db, 'idx_sessions_source_id')).toBe(true);
    const row = db
      .query('SELECT source_id, source_locator FROM sessions WHERE id = ?')
      .get('fake:s1') as { source_id: string | null; source_locator: string | null };
    expect(row.source_id).toBe('/fake/s1.jsonl');
  });

  test('a row that already has a distinct source_id is NOT overwritten by the backfill', () => {
    const db = new Database(':memory:');
    migrate(db);
    db.run(
      "INSERT INTO harnesses (id, display_name, adapter_version, capabilities) VALUES ('fake', 'Fake', '1.0.0', '[]')",
    );
    db.run(
      `INSERT INTO sessions (id, harness_id, project_key, depth, source_path, source_id, source_locator, source_size, source_mtime)
       VALUES ('fake:s1', 'fake', NULL, 0, '/fake/s1.jsonl', 'opencode:current:ses_1', '/db/opencode.db', 10, 1)`,
    );
    migrate(db);
    const row = db
      .query('SELECT source_id, source_locator FROM sessions WHERE id = ?')
      .get('fake:s1') as { source_id: string | null; source_locator: string | null };
    expect(row.source_id).toBe('opencode:current:ses_1');
    expect(row.source_locator).toBe('/db/opencode.db');
  });
});
