import { Database } from 'bun:sqlite';
import { stat as nodeStat, readdir } from 'node:fs/promises';
import type { FsStat, ScoutFs, SqliteReader } from './types';

/** Real ScoutFs over Bun/node:fs APIs. Read-only: no write/unlink is ever called. */
export function createBunFs(): ScoutFs {
  return {
    async stat(path): Promise<FsStat | undefined> {
      try {
        const s = await nodeStat(path);
        return { sizeBytes: s.size, mtimeMs: s.mtimeMs, isDirectory: s.isDirectory() };
      } catch {
        return undefined;
      }
    },

    async readdir(path): Promise<string[]> {
      try {
        return await readdir(path);
      } catch {
        return [];
      }
    },

    async readFile(path): Promise<string | undefined> {
      try {
        return await Bun.file(path).text();
      } catch {
        return undefined;
      }
    },

    openStream(path): ReadableStream<Uint8Array> {
      return Bun.file(path).stream();
    },

    openSqliteReadonly(path): SqliteReader {
      const db = new Database(path, { readonly: true });
      return {
        all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
          // biome-ignore lint/suspicious/noExplicitAny: bun:sqlite's binding type is narrower than our params; unused until an adapter needs SQLite.
          return db.query(sql).all(...(params as any[])) as T[];
        },
        close() {
          db.close();
        },
      };
    },
  };
}
