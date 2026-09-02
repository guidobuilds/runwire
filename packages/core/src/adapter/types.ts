import type { ScoutEvent } from '../events/event';
import type { Diagnostic } from '../model/diagnostic';
import type { HarnessId } from '../model/harness';
import type { ToolCategory } from '../model/trace';
import type { Counts, Usage } from '../model/usage';
import type { Projection } from './projection';

export type Capability =
  | 'usage.perCall'
  | 'usage.cumulative'
  | 'usage.cacheWrite'
  | 'usage.reasoning'
  | 'timing'
  | 'model'
  | 'mode'
  | 'effort'
  | 'version'
  | 'turns'
  | 'toolCalls'
  | 'compactions'
  | 'subagents'
  | 'cost'
  | 'title'
  | 'git'
  | 'initiator'
  | 'trace.blocks'
  | 'trace.errors'
  | 'trace.harnessEvents'
  | 'trace.toolDurations';

export type SourceRef = {
  /** Unique within the harness. */
  sourceId: string;
  path: string;
  kind: 'root' | 'child';
  sizeBytes: number;
  mtimeMs: number;
  /** Cheap linkage known at discovery time (e.g. directory nesting). */
  parentHint?: string;
};

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
  /** Raw byte stream; scan/lines.ts wraps this with size-guard and truncation detection. */
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

export interface HarnessAdapter {
  id: HarnessId;
  displayName: string;
  /** Bump when the mapping changes. */
  adapterVersion: string;
  capabilities: readonly Capability[];
  /** The fields this adapter is permitted to read (docs/ARCHITECTURE.md §6). */
  allowlist: Projection;
  probe(ctx: AdapterContext): Promise<{ installed: boolean; roots: string[]; notes: string[] }>;
  /** Cheap: stat/readdir only, no parsing. */
  discover(ctx: AdapterContext): AsyncIterable<SourceRef>;
  /** Streaming. */
  parse(ref: SourceRef, ctx: AdapterContext): AsyncIterable<ScoutEvent>;
  /** Mapping note for the UI. */
  explain(field: keyof Usage | keyof Counts): string | undefined;
  /** Must be total: unknown tool name -> 'other'. */
  toolCategory(name: string): ToolCategory;
  /** The only names a `harnessEvent` from this adapter may carry. */
  harnessEventNames: readonly string[];
}

export type { Diagnostic };
