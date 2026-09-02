import type {
  AdapterContext,
  RootsQuery,
  ScanReport,
  ScoutStore,
  SessionRollup,
  SessionSummary,
  SessionTrace,
} from '@scout/core';
import { Hono } from 'hono';
import { validator } from 'hono/validator';

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

/**
 * The one query param that narrows a root set: `?automated=exclude` drops
 * sessions Scout positively knows a machine started (see core's
 * `isMachineInitiated`).
 *
 * Absent — or any other value — means **include**, i.e. this API's default is
 * still "everything", unchanged from before this param existed. The product's
 * hide-by-default behavior is a client preference (`scout.prefs.v1`), not a
 * server default: an API that silently omitted 83% of a developer's sessions
 * unless you knew to opt out would be lying to every script that talks to it.
 */
const AUTOMATED_EXCLUDE = 'exclude';

function rootsQuery(automated: string | undefined): RootsQuery {
  return { excludeAutomated: automated === AUTOMATED_EXCLUDE };
}

/**
 * Declares `?automated` on a route's schema.
 *
 * This exists for the **typed client**, not for validation: `hc<AppType>` only
 * accepts a `query` argument for query keys the route's schema names, and for a
 * route that also has a path param (`/projects/:key/sessions`) an undeclared
 * `query` is a hard type error rather than a silently-ignored extra. Reading
 * `c.req.query('automated')` alone would compile on the server and be
 * unreachable from `packages/web`.
 *
 * The function is total and never rejects — an unknown value is simply not
 * `'exclude'`, which `rootsQuery` reads as "include everything".
 */
type AutomatedQuery = { automated?: string };
type SessionsQuery = AutomatedQuery & { ids?: string };

const automatedQueryValidator = validator(
  'query',
  (value): AutomatedQuery => ({
    automated: typeof value.automated === 'string' ? value.automated : undefined,
  }),
);

/**
 * `GET /sessions` carries Compare's `ids` on the same query object, so it has
 * to declare both keys — an undeclared one is invisible to `hc<AppType>`.
 *
 * The return types above are annotated (rather than inferred) so both keys stay
 * **optional** in the client's input type. Inferred, they would be required-
 * but-possibly-undefined, which forces every caller to spell out keys it does
 * not care about.
 */
const sessionsQueryValidator = validator(
  'query',
  (value): SessionsQuery => ({
    automated: typeof value.automated === 'string' ? value.automated : undefined,
    ids: typeof value.ids === 'string' ? value.ids : undefined,
  }),
);

/**
 * The single disclosure primitive: the roots a scope shows, and how many roots
 * the automated filter removed from *that same scope*.
 *
 * `hiddenAutomated` exists so the UI can say what it is not showing. The
 * approved model is "hidden means it counts nowhere" — it is excluded from
 * every aggregate, sessionCount and usage total — but a view that quietly drops
 * most of the rows with no visible trace is a different thing from a filter,
 * and this count is what keeps the difference honest. It is a disclosure of the
 * filter's own effect, not an aggregate over the hidden sessions.
 *
 * Both counts come from `store.getRoots` itself rather than from a second,
 * locally re-implemented predicate, so the number shown can never drift from
 * the rows actually removed. Every route that discloses anything goes through
 * this one function for exactly that reason — `/projects` and `/harnesses`
 * included, even though they serve aggregates rather than rows.
 */
function partitionRoots(
  store: ScoutStore,
  query: RootsQuery,
  pick: (s: SessionSummary) => boolean = () => true,
): { visible: SessionSummary[]; hiddenAutomated: number } {
  const all = store.getRoots({ excludeAutomated: false }).filter(pick);
  const visible = query.excludeAutomated ? store.getRoots(query).filter(pick) : all;
  return { visible, hiddenAutomated: all.length - visible.length };
}

/** A scoped root list plus its disclosure (see `partitionRoots`). */
function rootList(
  store: ScoutStore,
  query: RootsQuery,
  pick: (s: SessionSummary) => boolean = () => true,
): {
  summaries: SessionSummary[];
  rollups: Record<string, SessionRollup>;
  hiddenAutomated: number;
} {
  const { visible, hiddenAutomated } = partitionRoots(store, query, pick);
  return { ...summariesWithRollups(store, visible), hiddenAutomated };
}

/**
 * An aggregate list (`/projects`, `/harnesses`) plus the two numbers those
 * screens need to be honest about what the filter did to them. They are
 * different units and are reported separately on purpose — mixing them is how
 * a projects grid ends up claiming "184 sessions hidden" while what actually
 * vanished was 184 *projects*:
 *
 * - `hiddenGroups` — aggregates that disappeared **entirely** because every
 *   root claiming them was machine-started. A project is not a first-class
 *   record (see `ScoutStore.getProjects`), so it simply stops existing rather
 *   than showing `sessionCount: 0`; on real data this is 184 of 204 projects,
 *   the single largest thing this filter does anywhere in the product.
 * - `hiddenAutomated` — root **sessions** removed from the whole set these
 *   aggregates roll up, i.e. the sessions missing from every `sessionCount`
 *   and every usage total still on screen.
 *
 * Both are differences between the same `select`/`getRoots` seam called with
 * and without the filter, never a second predicate, so neither can drift from
 * what was actually removed.
 */
function aggregateList<T>(
  store: ScoutStore,
  query: RootsQuery,
  select: (q: RootsQuery) => T[],
): { items: T[]; hiddenGroups: number; hiddenAutomated: number } {
  const all = select({ excludeAutomated: false });
  const items = query.excludeAutomated ? select(query) : all;
  return {
    items,
    hiddenGroups: all.length - items.length,
    hiddenAutomated: partitionRoots(store, query).hiddenAutomated,
  };
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

    // Body is an object, not the bare `ProjectAggregate[]` this route used to
    // return, so the grid can disclose what the filter took out of it (§4.7):
    // with the preference on, real data drops 184 of 204 project cards.
    .get('/projects', automatedQueryValidator, (c) => {
      const query = rootsQuery(c.req.valid('query').automated);
      const { items, hiddenGroups, hiddenAutomated } = aggregateList(store, query, (q) =>
        store.getProjects(q),
      );
      return c.json({ projects: items, hiddenProjects: hiddenGroups, hiddenAutomated });
    })

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
    .get('/projects/:key/sessions', automatedQueryValidator, (c) => {
      const key = c.req.param('key');
      const query = rootsQuery(c.req.valid('query').automated);
      return c.json(rootList(store, query, (s) => s.project.key === key));
    })

    // Same object shape as `/projects` above, same reason. A harness only
    // disappears when *all* of its roots are machine-started (rarer than for a
    // project — today's single harness never does), but the sessions missing
    // from its `sessionCount` are the same 318 either way.
    .get('/harnesses', automatedQueryValidator, (c) => {
      const query = rootsQuery(c.req.valid('query').automated);
      const { items, hiddenGroups, hiddenAutomated } = aggregateList(store, query, (q) =>
        store.getHarnesses(q),
      );
      return c.json({ harnesses: items, hiddenHarnesses: hiddenGroups, hiddenAutomated });
    })

    .get('/harnesses/:id/sessions', automatedQueryValidator, (c) => {
      const id = c.req.param('id');
      const query = rootsQuery(c.req.valid('query').automated);
      return c.json(rootList(store, query, (s) => s.harness === id));
    })

    // Deliberately NOT narrowed by `?automated`: asking for one session by id
    // is an explicit choice, and a deep link, a bookmark or a Back button must
    // resolve a machine-started session even while the lists hide it.
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

    .get('/sessions', sessionsQueryValidator, (c) => {
      const { ids: idsParam, automated } = c.req.valid('query');
      if (idsParam) {
        // The `ids` branch ignores `?automated` ON PURPOSE. This is Compare's
        // endpoint, and every id in it is a session the user explicitly put in
        // the tray; applying the list filter here would delete columns the user
        // chose, in a view whose whole job is showing exactly what was chosen.
        // The tray also outlives a preference change (it persists in
        // localStorage), so "compare things the table refuses to list" is a
        // reachable, legitimate state, not an edge case.
        const summaries = parseIds(idsParam)
          .map((id) => store.getSession(id))
          .filter((s): s is SessionSummary => s !== undefined);
        const { rollups } = summariesWithRollups(store, summaries);
        return c.json({ summaries, rollups });
      }
      // No `ids` (missing or empty string): list every ROOT session, same
      // serializer shape as /projects/:key/sessions and /harnesses/:id/sessions
      // above.
      return c.json(rootList(store, rootsQuery(automated)));
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
