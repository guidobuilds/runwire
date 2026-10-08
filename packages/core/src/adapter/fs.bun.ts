import { Database } from 'bun:sqlite';
import type { Stats } from 'node:fs';
import { stat as nodeStat, readdir } from 'node:fs/promises';
import type { FsStat, RunwireFs, SqliteReader } from './types';

/**
 * The read primitives `createBunFs` wraps. The parameter exists only so tests
 * can raise a deterministic `EACCES`/`EIO` without depending on filesystem
 * permissions, which a privileged CI user bypasses; production always uses
 * `defaultIo`.
 */
export type BunFsIo = {
  stat(path: string): Promise<Stats>;
  readdir(path: string): Promise<string[]>;
  readFileText(path: string): Promise<string>;
};

const defaultIo: BunFsIo = {
  stat: nodeStat,
  readdir,
  readFileText: (path) => Bun.file(path).text(),
};

/**
 * `ENOENT`/`ENOTDIR` mean "there is no such source"; every other code
 * (`EACCES`, `EIO`, ...) is a real read failure. Collapsing both to
 * undefined/[] would let a permission or I/O error look like a vanished
 * source, so discovery would report an incomplete tree as complete and core
 * could prune history it simply failed to read.
 */
function isAbsenceError(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Real RunwireFs over Bun/node:fs APIs. Read-only: no write/unlink is ever called. */
export function createBunFs(io: BunFsIo = defaultIo): RunwireFs {
  return {
    async stat(path): Promise<FsStat | undefined> {
      try {
        const s = await io.stat(path);
        return { sizeBytes: s.size, mtimeMs: s.mtimeMs, isDirectory: s.isDirectory() };
      } catch (e) {
        if (isAbsenceError(e)) return undefined;
        throw e;
      }
    },

    async readdir(path): Promise<string[]> {
      try {
        return await io.readdir(path);
      } catch (e) {
        if (isAbsenceError(e)) return [];
        throw e;
      }
    },

    async readFile(path): Promise<string | undefined> {
      try {
        return await io.readFileText(path);
      } catch (e) {
        if (isAbsenceError(e)) return undefined;
        throw e;
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
