import type { Projection } from '../adapter/projection';
import type { AdapterContext } from '../adapter/types';
import type { Capability } from './capabilities';
import type { SessionBundle, SourceRef } from './types';

export type Known = Map<string, { size: number; mtime: number }>;

export interface HarnessAdapter {
  id: string;
  displayName: string;
  adapterVersion: string;
  capabilities: readonly Capability[];
  allowlist: Projection;
  probe(ctx: AdapterContext): Promise<{ installed: boolean; roots: string[]; notes: string[] }>;
  discover(ctx: AdapterContext, known: Known): AsyncIterable<SessionBundle>;
  sourceExists?(ctx: AdapterContext, source: SourceRef): Promise<boolean>;
}
