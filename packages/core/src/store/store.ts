import { Database } from 'bun:sqlite';
import { migrate } from './schema';

export type Store = { db: Database; close: () => void };

/**
 * `path` may be a real filesystem path or `':memory:'`. Sets
 * `PRAGMA foreign_keys = ON` (required for the child-table cascades; plan
 * P20 keeps `sessions.parent_id`/`steps.child_id` themselves unconstrained)
 * and `PRAGMA journal_mode = WAL` for file-backed databases before applying
 * `migrate`.
 */
export function openStore(path: string): Store {
  const db = new Database(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  migrate(db);
  return { db, close: () => db.close() };
}
