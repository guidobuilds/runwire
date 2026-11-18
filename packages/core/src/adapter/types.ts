export type FsStat = { sizeBytes: number; mtimeMs: number; isDirectory: boolean };

export interface SqliteReader {
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  close(): void;
}

export interface RunwireFs {
  stat(path: string): Promise<FsStat | undefined>;
  readdir(path: string): Promise<string[]>;
  readFile(path: string): Promise<string | undefined>;
  openStream(path: string): ReadableStream<Uint8Array>;
  openSqliteReadonly(path: string): SqliteReader;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export type AdapterContext = {
  home: string;
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  fs: RunwireFs;
  privacy: { titles: boolean };
  log: Logger;
};
