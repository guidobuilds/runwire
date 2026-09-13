import { Database } from 'bun:sqlite';
import { chmodSync, existsSync } from 'node:fs';
import { migrate } from './schema';

export type Store = { db: Database; close: () => void };

/**
 * Restricts an existing path to owner-only `0o600`, leaving it untouched if it
 * does not exist (the `-wal`/`-shm` sidecars are created lazily). No-op on
 * Windows, where POSIX mode bits do not apply (SEC-03).
 */
function chmodPrivate(path: string): void {
  if (process.platform === 'win32' || !existsSync(path)) return;
  chmodSync(path, 0o600);
}

/**
 * `path` may be a real filesystem path or `':memory:'`. Sets
 * `PRAGMA foreign_keys = ON` (required for the child-table cascades; plan
 * P20 keeps `sessions.parent_id`/`steps.child_id` themselves unconstrained)
 * and `PRAGMA journal_mode = WAL` for file-backed databases before applying
 * `migrate`.
 *
 * File-backed stores are chmodded to `0o600` (db plus WAL sidecars) so the
 * copied harness metadata is not readable by other local users (SEC-03).
 */
export function openStore(path: string): Store {
  const fileBacked = path !== ':memory:';
  const db = new Database(path);
  if (fileBacked) {
    // `new Database(path)` creates the file under the process umask (often
    // 0o644); chmod immediately to close the window.
    chmodPrivate(path);
  }
  db.exec('PRAGMA foreign_keys = ON;');
  if (fileBacked) {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  migrate(db);
  if (fileBacked) {
    // The WAL sidecars appear on the first write, i.e. during `migrate`.
    chmodPrivate(`${path}-wal`);
    chmodPrivate(`${path}-shm`);
  }
  return { db, close: () => db.close() };
}
