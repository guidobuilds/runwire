import type {
  AdapterContext,
  ScanReport,
  ScoutStore,
  SessionRollup,
  SessionSummary,
  SessionTrace,
} from '@scout/core';
import { comparability } from '@scout/core';
import { Hono } from 'hono';

function summariesWithRollups(
  store: ScoutStore,
  summaries: SessionSummary[],
): { summaries: SessionSummary[]; rollups: Record<string, SessionRollup> } {
  const rollups: Record<string, SessionRollup> = {};
  for (const s of summaries) {
    const rollup = store.getRollup(s.id);
    if (rollup) rollups[s.id] = rollup;
  }
  return { summaries, rollups };
}

function parseIds(idsParam: string): string[] {
  return idsParam
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/**
 * All ARCHITECTURE.md §8 `/api/*` routes, method-chained on one Hono
 * instance (required for `hc<AppType>` inference — see app.ts). `ctx` is
 * needed alongside `store` because `GET /api/status` calls each adapter's
 * live `probe(ctx)`, and `ScoutStore` does not expose the `AdapterContext`
 * it was constructed with (deliberately private — see build-log-f2.md for
 * why this two-argument signature deviates from design.md's `buildApiRoutes(store)`).
 */
export function buildApiRoutes(store: ScoutStore, ctx: AdapterContext) {
  // Per-app-instance request coalescing (design.md §3): a second POST
  // /api/rescan while one is already in flight awaits and returns the same
  // promise's result instead of starting a parallel scan. Scoped to this
  // closure (one per buildApiRoutes call / one per running app) rather than
  // truly module-level, so separate ScoutStore/app instances in tests never
  // share in-flight state.
  let rescanInFlight: Promise<ScanReport> | undefined;

  const api = new Hono()
    .get('/status', async (c) => {
      const adapters = store.getAdapters();
      const adapterStatuses = await Promise.all(
        adapters.map(async (adapter) => ({
          id: adapter.id,
          displayName: adapter.displayName,
          capabilities: adapter.capabilities,
          probe: await adapter.probe(ctx),
        })),
      );
      return c.json({ lastReport: store.getLastReport() ?? null, adapters: adapterStatuses });
    })

    .post('/rescan', async (c) => {
      if (!rescanInFlight) {
        rescanInFlight = store.rescan().finally(() => {
          rescanInFlight = undefined;
        });
      }
      const report = await rescanInFlight;
      return c.json(report);
    })

    .get('/projects', (c) => c.json(store.getProjects()))

    .get('/projects/:key/sessions', (c) => {
      const key = decodeURIComponent(c.req.param('key'));
      const roots = store.getRoots().filter((s) => s.project.key === key);
      return c.json(summariesWithRollups(store, roots));
    })

    .get('/harnesses', (c) => c.json(store.getHarnesses()))

    .get('/harnesses/:id/sessions', (c) => {
      const id = decodeURIComponent(c.req.param('id'));
      const roots = store.getRoots().filter((s) => s.harness === id);
      return c.json(summariesWithRollups(store, roots));
    })

    .get('/sessions/:id', (c) => {
      const id = c.req.param('id');
      const summary = store.getSession(id);
      if (!summary) return c.json({ error: 'session not found' }, 404);
      const rollup = store.getRollup(id);
      const subtreeSummaries = store.getSubtree(id);
      const diagnostics = subtreeSummaries.flatMap((s) => s.diagnostics);
      return c.json({
        summary,
        rollup,
        subtree: summariesWithRollups(store, subtreeSummaries),
        diagnostics,
      });
    })

    .get('/sessions', (c) => {
      const idsParam = c.req.query('ids');
      if (!idsParam) return c.json({ error: 'ids is required' }, 400);
      const summaries = parseIds(idsParam)
        .map((id) => store.getSession(id))
        .filter((s): s is SessionSummary => s !== undefined);
      const { rollups } = summariesWithRollups(store, summaries);
      const adaptersById = new Map(store.getAdapters().map((a) => [a.id, a]));
      return c.json({ summaries, rollups, comparability: comparability(summaries, adaptersById) });
    })

    .get('/sessions/:id/trace', async (c) => {
      const trace = await store.getTrace(c.req.param('id'));
      if (!trace) return c.json({ error: 'trace not found' }, 404);
      return c.json(trace);
    })

    .get('/traces', async (c) => {
      const idsParam = c.req.query('ids');
      if (!idsParam) return c.json({ error: 'ids is required' }, 400);
      const ids = parseIds(idsParam);
      const entries = await Promise.all(
        ids.map(async (id) => [id, await store.getTrace(id)] as const),
      );
      const traces: Record<string, SessionTrace> = {};
      for (const [id, trace] of entries) if (trace) traces[id] = trace;
      return c.json({ traces });
    })

    .get('/diagnostics', (c) => c.json(store.getDiagnostics()));

  return api;
}

export type ApiRoutes = ReturnType<typeof buildApiRoutes>;
