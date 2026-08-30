import type { Hono } from 'hono';

export type StartServerOptions = {
  app: Hono;
  port: number;
  /**
   * Required, not defaulted here: `Bun.serve()` defaults to `0.0.0.0` (all
   * interfaces) when `hostname` is omitted, which would be a real privacy
   * regression per ARCHITECTURE.md §8 ("bound to 127.0.0.1"). The caller
   * (the CLI's `serve` command) must pass '127.0.0.1' explicitly.
   */
  hostname: string;
};

export type StartedServer = {
  server: ReturnType<typeof Bun.serve>;
  url: string;
  stop: () => void;
};

/** Thin wrapper over `Bun.serve` — no CLI concerns (process.exit, EADDRINUSE UX) belong here. */
export function startServer({ app, port, hostname }: StartServerOptions): StartedServer {
  const server = Bun.serve({ fetch: app.fetch, port, hostname });
  return { server, url: server.url.toString(), stop: () => server.stop() };
}
