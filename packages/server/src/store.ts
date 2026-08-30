import type { AdapterContext } from '@scout/core';
import { ScoutStore } from '@scout/core';
import { adapters } from './adapters';
import { createProductionContext } from './context';

export type CreateStoreOptions = {
  home?: string;
  titles?: boolean;
  projectIdentity?: 'repo' | 'cwd';
};

export type CreatedStore = { store: ScoutStore; ctx: AdapterContext };

/**
 * The one call site that wires the harness registry + a real AdapterContext
 * into a ScoutStore (ScoutStore itself is fully implemented already in
 * packages/core/src/scan/store.ts — this is wiring, not a new store).
 *
 * Returns `{ store, ctx }` rather than a bare `ScoutStore` (a deliberate
 * deviation from design.md's `createStore(opts): ScoutStore` — see
 * build-log-f2.md): `ScoutStore` deliberately keeps its `AdapterContext`
 * private, but `GET /api/status`'s live `adapter.probe(ctx)` calls need the
 * exact same context the store was scanned with (e.g. the same `--home`),
 * so callers (createApp, the CLI's serve/scan/doctor commands) need both.
 */
export function createStore(opts: CreateStoreOptions = {}): CreatedStore {
  const ctx = createProductionContext(opts);
  const store = new ScoutStore(adapters, ctx, { projectIdentity: opts.projectIdentity });
  return { store, ctx };
}
