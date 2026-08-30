import type { FsStat, ScoutFs, SqliteReader } from './types';

export type MemoryFile = { content: string; mtimeMs?: number };

export type MemoryFsInit = {
  /** Absolute paths -> content. Directories are inferred from path prefixes. */
  files?: Record<string, string | MemoryFile>;
};

function normalize(path: string): string {
  return path.replace(/\/+$/, '') || '/';
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i <= 0 ? '/' : path.slice(0, i);
}

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

/** In-memory ScoutFs for tests: no real filesystem I/O. */
export function createMemoryFs(init: MemoryFsInit = {}): ScoutFs {
  const files = new Map<string, MemoryFile>();
  for (const [path, value] of Object.entries(init.files ?? {})) {
    const norm = normalize(path);
    files.set(norm, typeof value === 'string' ? { content: value } : value);
  }

  function encoder() {
    return new TextEncoder();
  }

  return {
    async stat(path): Promise<FsStat | undefined> {
      const norm = normalize(path);
      const file = files.get(norm);
      if (file) {
        return {
          sizeBytes: encoder().encode(file.content).byteLength,
          mtimeMs: file.mtimeMs ?? 0,
          isDirectory: false,
        };
      }
      const isDir = [...files.keys()].some((p) => p.startsWith(`${norm}/`));
      return isDir ? { sizeBytes: 0, mtimeMs: 0, isDirectory: true } : undefined;
    },

    async readdir(path): Promise<string[]> {
      const norm = normalize(path);
      const prefix = `${norm}/`;
      const entries = new Set<string>();
      for (const p of files.keys()) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        entries.add(rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : rest);
      }
      return [...entries];
    },

    async readFile(path): Promise<string | undefined> {
      return files.get(normalize(path))?.content;
    },

    openStream(path): ReadableStream<Uint8Array> {
      const content = files.get(normalize(path))?.content ?? '';
      const bytes = encoder().encode(content);
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
    },

    openSqliteReadonly(): SqliteReader {
      throw new Error(
        'createMemoryFs: openSqliteReadonly is not supported; no adapter uses it in M1',
      );
    },
  };
}

export const memoryFsPaths = { dirname, basename };
