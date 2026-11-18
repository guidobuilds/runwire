import { join } from 'node:path/posix';
import type { AdapterContext } from '@runwire/core';

export function gentleHome(ctx: AdapterContext): string {
  return ctx.env.GENTLE_PI_AGENT_HOME ?? join(ctx.home, '.gentle-shell', 'agent');
}

export function userPiHome(ctx: AdapterContext): string {
  return ctx.env.GENTLE_SHELL_USER_PI_HOME ?? join(ctx.home, '.pi', 'agent');
}

export function gentleParentsRoot(ctx: AdapterContext): string {
  return join(gentleHome(ctx), 'sessions');
}

export type ChildRoot = { home: 'gentle' | 'userPi'; root: string };

export function childrenRoots(ctx: AdapterContext): ChildRoot[] {
  return [
    { home: 'gentle' as const, root: join(gentleHome(ctx), 'gentle-agents', 'sessions') },
    { home: 'userPi' as const, root: join(userPiHome(ctx), 'gentle-agents', 'sessions') },
  ];
}

export function ledgerRoots(ctx: AdapterContext): string[] {
  return [
    join(gentleHome(ctx), 'gentle-agents', 'tasks'),
    join(userPiHome(ctx), 'gentle-agents', 'tasks'),
  ];
}

export function sharesParentRoot(ctx: AdapterContext): boolean {
  return gentleHome(ctx) === userPiHome(ctx);
}
