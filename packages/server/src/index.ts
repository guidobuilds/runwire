// M3 exports — Hono API on Bun.serve + createStore/createApp/startServer
// wiring (docs/ARCHITECTURE.md §4, §8). The M0 placeholder exports (kept
// additively through f2-t8 so the old CLI import stayed resolvable) are
// removed here now that f3-t6 has rewritten the CLI and nothing imports
// them anymore.
export { adapters } from './adapters';
export type { AppType } from './app';
export { createApp } from './app';
export type { ProductionContextOptions } from './context';
export { createProductionContext } from './context';
export type { ApiRoutes } from './routes';
export { buildApiRoutes } from './routes';
export type { StartedServer, StartServerOptions } from './serve';
export { startServer } from './serve';
export type { CreatedStore, CreateStoreOptions } from './store';
export { createStore } from './store';
