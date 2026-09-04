import type { Projection } from '../adapter/projection';
import type { AdapterContext } from '../adapter/types';
import type { Capability } from './capabilities';
import type { SessionBundle } from './types';

/** sourcePath -> what core already stored for it (ARCHITECTURE §3). */
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
}
