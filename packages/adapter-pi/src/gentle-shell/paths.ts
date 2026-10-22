// Like pi/paths.ts: every path here feeds RunwireFs (stat/readdir/readFile), so
// it stays '/'-joined via path.posix regardless of host OS.
import { join } from 'node:path/posix';
import type { AdapterContext } from '@runwire/core';

/**
 * The active Gentle Shell agent home (gentle-shell.md §2). The launcher creates
 * `~/.gentle-shell/agent` (shape A) and `pi install`/`--link` reuse the user's
 * Pi home (shapes B/C). `GENTLE_PI_AGENT_HOME` mirrors Gentle Shell's own env.
 */
export function gentleHome(ctx: AdapterContext): string {
  return ctx.env.GENTLE_PI_AGENT_HOME ?? join(ctx.home, '.gentle-shell', 'agent');
}

/**
 * The user's original Pi home, where shapes B/C parent sessions live
 * (gentle-shell.md §1.1). Mirrors `USER_PI_HOME_ENV` in gentle-stats.ts.
 */
export function userPiHome(ctx: AdapterContext): string {
  return ctx.env.GENTLE_SHELL_USER_PI_HOME ?? join(ctx.home, '.pi', 'agent');
}

/** Parent sessions of the isolated home (shape A). Owned by this adapter. */
export function gentleParentsRoot(ctx: AdapterContext): string {
  return join(gentleHome(ctx), 'sessions');
}

export type ChildRoot = { home: 'gentle' | 'userPi'; root: string };

/**
 * Every `gentle-agents/sessions` tree in scope (gentle-shell.md §2, decision 1):
 * only Gentle Shell writes that directory, so children are attributable in both
 * homes. The flat children never overlap with the Pi parent root.
 */
export function childrenRoots(ctx: AdapterContext): ChildRoot[] {
  return [
    { home: 'gentle' as const, root: join(gentleHome(ctx), 'gentle-agents', 'sessions') },
    { home: 'userPi' as const, root: join(userPiHome(ctx), 'gentle-agents', 'sessions') },
  ];
}

/**
 * The ledger directories in scope, one per agent home (gentle-shell.md §2.2).
 * Link metadata only; the ledger is the only parent→child bridge.
 */
export function ledgerRoots(ctx: AdapterContext): string[] {
  return [
    join(gentleHome(ctx), 'gentle-agents', 'tasks'),
    join(userPiHome(ctx), 'gentle-agents', 'tasks'),
  ];
}

/**
 * Whether the gentle home IS the user Pi home (shape C, `--link`). When true,
 * the parent root is skipped: those sessions are Pi's (decision 1, S3/S7) and
 * the two adapters must never scan the same parent root (gentle-shell.md §9).
 */
export function sharesParentRoot(ctx: AdapterContext): boolean {
  return gentleHome(ctx) === userPiHome(ctx);
}
