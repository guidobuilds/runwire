import type { AdapterContext, ScoutStore } from '@scout/core';
import { Hono } from 'hono';
import { buildApiRoutes } from './routes';
import { webDistHandler } from './static';

// Type-only mount, never invoked: gives `AppType` the exact chained shape
// `createApp` produces at the point `/api` is mounted (path-prefixed, so
// `hc<AppType>()` resolves real paths like `/api/status`), without needing a
// runtime store/ctx pair just to compute a type.
function mountApi(store: ScoutStore, ctx: AdapterContext) {
  return new Hono().route('/api', buildApiRoutes(store, ctx));
}

/** Captured before the catch-all/error handler are added below, so neither pollutes hc<AppType>'s shape. */
export type AppType = ReturnType<typeof mountApi>;

export type CreateAppOptions = {
  webDist?: string;
};

/**
 * Builds the full Hono app: `/api/*` routes, then a `GET /*` catch-all (disk
 * serve + SPA fallback when `opts.webDist` is set; otherwise the JSON 404
 * stub), and a defensive error handler.
 */
export function createApp(
  store: ScoutStore,
  ctx: AdapterContext,
  opts: CreateAppOptions = {},
): AppType {
  const api = mountApi(store, ctx);

  if (opts.webDist) {
    api.get('*', webDistHandler(opts.webDist));
  } else {
    api.get('*', (c) => c.json({ error: 'not found' }, 404));
  }

  api.onError((err, c) => {
    ctx.log.error(`unhandled request error: ${err instanceof Error ? err.message : String(err)}`);
    return c.json({ error: 'internal error' }, 500);
  });

  return api;
}
