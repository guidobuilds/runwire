import type { Projection } from '../adapter/projection';
import type { AdapterContext } from '../adapter/types';
import type { Capability } from './capabilities';
import type { SessionBundle, SourceRef } from './types';

/**
 * The effective source id -> what core already stored for it (ARCHITECTURE §3).
 * The key is the EFFECTIVE source id (`sourceId ?? sourcePath`), so a
 * DB-backed adapter that separates `sourceId` from `sourcePath` still keys
 * its known map by the identity it emits.
 */
export type Known = Map<string, { size: number; mtime: number }>;

export interface HarnessAdapter {
  id: string;
  displayName: string;
  /** Bump when a mapping changes. */
  adapterVersion: string;
  capabilities: readonly Capability[];
  /** The fields this adapter is permitted to read (ARCHITECTURE §7). */
  allowlist: Projection;
  probe(ctx: AdapterContext): Promise<{ installed: boolean; roots: string[]; notes: string[] }>;
  /** One fully computed SessionBundle per source, streamed. */
  discover(ctx: AdapterContext, known: Known): AsyncIterable<SessionBundle>;
  /**
   * Optional explicit existence check (ARCHITECTURE §3 / design §2.6). When
   * undefined, CORE falls back to `fs.stat(sourceLocator ?? sourceId)`, which
   * is the current filesystem heuristic the Claude adapter relies on. A
   * DB-backed adapter returns `true` (retain) on any DB open/read/stat error
   * and only `false` (delete) on a CONFIRMED absent source.
   */
  sourceExists?(ctx: AdapterContext, source: SourceRef): Promise<boolean>;
}
