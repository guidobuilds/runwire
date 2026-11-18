import { Database } from 'bun:sqlite';
import { chmodSync, existsSync } from 'node:fs';
import { migrate } from './schema';

export type Store = { db: Database; close: () => void };

function chmodPrivate(path: string): void {
  if (process.platform === 'win32' || !existsSync(path)) return;
  chmodSync(path, 0o600);
}

export function openStore(path: string): Store {
  const fileBacked = path !== ':memory:';
  const db = new Database(path);
  if (fileBacked) {
    chmodPrivate(path);
  }
  db.exec('PRAGMA foreign_keys = ON;');
  if (fileBacked) {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  migrate(db);
  if (fileBacked) {
    chmodPrivate(`${path}-wal`);
    chmodPrivate(`${path}-shm`);
  }
  return { db, close: () => db.close() };
}
