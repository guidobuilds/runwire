export type FsStat = { sizeBytes: number; mtimeMs: number; isDirectory: boolean };

export interface SqliteReader {
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  close(): void;
}

/** Read-only filesystem/DB abstraction adapters use instead of node:fs directly. */
export interface ScoutFs {
  stat(path: string): Promise<FsStat | undefined>;
  readdir(path: string): Promise<string[]>;
  readFile(path: string): Promise<string | undefined>;
  /** Raw byte stream; adapter/lines.ts wraps this with size-guard and truncation detection. */
  openStream(path: string): ReadableStream<Uint8Array>;
  openSqliteReadonly(path: string): SqliteReader;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export type AdapterContext = {
  /** User home; overridable for tests and `--home`. */
  home: string;
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  fs: ScoutFs;
  privacy: { titles: boolean };
  log: Logger;
};
