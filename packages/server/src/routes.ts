import type {
  AdapterContext,
  ScanReport,
  ScoutStore,
  SessionRollup,
  SessionSummary,
  SessionTrace,
} from '@scout/core';
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

    // `c.req.param()` returns an ALREADY-DECODED value: hono 4.13.5's
    // `HonoRequest#getDecodedParam` runs `tryDecodeURIComponent` on the raw
    // segment (`hono/dist/request.js` -> `hono/dist/utils/url.js`). Never
    // `decodeURIComponent` it again -- that shipped here until this fix and
    // was wrong three ways: a key holding a literal `%` (`100% real/repo`,
    // `50%`) threw `URIError` -> HTTP 500; `a%2Fb` silently became `a/b` and
    // `%41` became `A`, i.e. a wrong lookup with a 200; and a double-encoded
    // URL matched a key it does not name. `tryDecodeURIComponent` also never
    // throws (it falls back to per-escape decoding, then to the raw text), so
    // reading the param as-is is what keeps malformed input a plain miss
    // instead of a 500.
    .get('/projects/:key/sessions', (c) => {
      const key = c.req.param('key');
      const roots = store.getRoots().filter((s) => s.project.key === key);
      return c.json(summariesWithRollups(store, roots));
    })

    .get('/harnesses', (c) => c.json(store.getHarnesses()))

    .get('/harnesses/:id/sessions', (c) => {
      const id = c.req.param('id');
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
      if (idsParam) {
        const summaries = parseIds(idsParam)
          .map((id) => store.getSession(id))
          .filter((s): s is SessionSummary => s !== undefined);
        const { rollups } = summariesWithRollups(store, summaries);
        return c.json({ summaries, rollups });
      }
      // No `ids` (missing or empty string): list every ROOT session, same
      // serializer shape as /projects/:key/sessions and /harnesses/:id/sessions
      // above.
      return c.json(summariesWithRollups(store, store.getRoots()));
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
