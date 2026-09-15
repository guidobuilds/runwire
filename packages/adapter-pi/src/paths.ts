// Paths built here are handed to RunwireFs (createBunFs or createMemoryFs), not
// used as opaque OS file paths directly - createMemoryFs's virtual layout is
// always '/'-joined regardless of host OS (packages/core/src/adapter/fs.memory.ts),
// and a real filesystem on Windows accepts '/' as a path separator just as
// readily as '\', so path.posix.join keeps both backends correct on every
// platform. node:path's OS-native join() would instead normalize to '\' on
// Windows, breaking any lookup against a memoryFs built with literal '/' keys.
import { join } from 'node:path/posix';
import type { AdapterContext } from '@runwire/core';

const JSONL_EXT = '.jsonl';

/**
 * Pi's agent directory (docs/adapters/pi.md §2). It is a mixed directory:
 * `sessions/` is the only in-scope subdirectory — `agents/`, `skills/`,
 * `extensions/`, `auth.json`, `models-store.json`, `settings.json` and
 * `gentle-agents/` all stay out (pi.md §2.1, D81).
 */
export function agentDir(ctx: AdapterContext): string {
  return ctx.env.PI_CODING_AGENT_DIR ?? join(ctx.home, '.pi', 'agent');
}

/**
 * The one directory the adapter ever scans. A recursive jsonl walk of
 * `agentDir` would pick up extension-run child sessions under e.g.
 * `gentle-agents/sessions/` and attribute them to Pi, so the boundary is
 * deliberately `<agentDir>/sessions` only (pi.md §2.1, D81).
 */
export function sessionsRoot(ctx: AdapterContext): string {
  return ctx.env.PI_CODING_AGENT_SESSION_DIR ?? join(agentDir(ctx), 'sessions');
}

export function isSessionFile(entry: string): boolean {
  return entry.endsWith(JSONL_EXT);
}

/**
 * `<ISO timestamp>_<uuidv7>.jsonl` -> `<uuidv7>`. The filename uuid is the
 * only identifier Pi never regenerates: `migrateV1ToV2` synthesizes random
 * entry ids in place, a headerless file gets a fresh random header on every
 * open, and `/fork`+`/clone` assign a new uuid to the copy (pi.md §5.3). The
 * regex is non-greedy, so it strips only through the first `_`.
 */
export function sessionIdFromRootFile(entry: string): string {
  return entry.slice(0, -JSONL_EXT.length).replace(/^.*?_/, '');
}

/**
 * Decodes a Pi project directory name (`--<cwd with /,: replaced by ->--`) back
 * to a cwd, used only as a fallback when the `session` header carries no cwd
 * (pi.md §2, §8). The encoding is LOSSY: a literal `-` in a real path segment
 * is indistinguishable from an encoded separator, so this can never be exact
 * and must never be used as the project key (only as a `cwd` value, diagnosed
 * with `cwd-from-dirname`).
 */
export function decodeProjectDirname(name: string): string {
  const decoded = name.replace(/^--/, '').replace(/--$/, '').replace(/-/g, '/');
  // The encoder strips the cwd's leading separator; re-add it.
  return `/${decoded}`;
}
