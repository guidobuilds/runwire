import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { Context } from 'hono';

const JSON_404 = { error: 'not found' } as const;
const UNAVAILABLE = { error: 'web build unavailable' } as const;
const ASSET_CACHE = 'public, max-age=31536000, immutable';
const NO_CACHE = 'no-cache';

function json404(c: Context) {
  return c.json(JSON_404, 404);
}

/**
 * The dist dir (or its index.html) is gone or unreadable *right now* — the
 * window `vite build` opens every time it empties `packages/web/dist` under a
 * running `scout serve`. Deliberate, tiny, and path-free: streaming a
 * `Bun.file` that does not exist fails while the body is written, which
 * bypasses `onError` and hands the client Bun's 66 KB error page with
 * absolute paths and the server cwd in it.
 */
function unavailable(c: Context) {
  return c.json(UNAVAILABLE, 503);
}

function underRoot(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(root + sep);
}

type Resolution =
  | { kind: 'file'; path: string }
  | { kind: 'escape' }
  /** Missing, dangling symlink, a directory, or unreadable. */
  | { kind: 'absent' };

/**
 * Containment decided on the **real** path. A lexical `startsWith` check only
 * sees what the URL says; a symlink inside the dist dir (file *or* directory)
 * escapes it silently and the whole target tree becomes readable. `realpath`
 * is what makes "never read outside the root" true for symlink targets too.
 *
 * Residual TOCTOU, stated accurately: there is no synchronous open below.
 * `Bun.file()` opens nothing, so the window is not the usual check-then-open
 * syscall gap -- it runs from the `realpathSync` here until the response body
 * is actually read/streamed, i.e. past this handler's return and past Hono's
 * middleware chain. Closing it needs an fd-based read (`open()` + `fstat` +
 * read from the fd). Left open deliberately: the precondition is write access
 * to the served dist, which already implies full control of what is served,
 * and a live 4000-request race (228 flips) escaped 0 times -- see
 * `.forge/m4-web-app/verification-f8-fix.md` section 1.4.
 */
function resolveUnder(candidate: string, realRoot: string): Resolution {
  let real: string;
  try {
    real = realpathSync(candidate);
  } catch {
    return { kind: 'absent' };
  }
  if (!underRoot(real, realRoot)) {
    return { kind: 'escape' };
  }
  try {
    if (!statSync(real).isFile()) {
      return { kind: 'absent' };
    }
    accessSync(real, constants.R_OK);
  } catch {
    return { kind: 'absent' };
  }
  return { kind: 'file', path: real };
}

/**
 * Disk-serve a Vite `dist` directory with SPA fallback (design.md §10):
 * an existing file under the root is served, unknown `/api/*` stays JSON 404,
 * everything else falls back to `index.html`. `webDist` is resolved to an
 * absolute path so behavior does not depend on process cwd.
 *
 * There is deliberately no extension/suffix heuristic: `ProjectRef.key` is a
 * normalized repo URL, so shipped SPA routes like
 * `/projects/github.com%2Fmrdoob%2Fthree.js` end in `.js` and must reach the
 * router, not 404.
 */
export function webDistHandler(webDist: string) {
  const root = resolve(webDist);
  return (c: Context) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(c.req.path);
    } catch {
      return json404(c);
    }

    if (decoded === '/api' || decoded.startsWith('/api/')) {
      return json404(c);
    }

    // Re-resolved per request, not captured once: `webDist` may legitimately
    // be reached through a symlink (macOS `/var` → `/private/var`), and it can
    // disappear mid-build under a running server.
    let realRoot: string;
    try {
      realRoot = realpathSync(root);
    } catch {
      return unavailable(c);
    }

    const relative = decoded.replace(/^\/+/, '');
    const candidate = resolve(root, relative);
    // Cheap lexical pre-filter so a URL-level traversal never even stats a
    // path outside the root. Encoded slashes (`%2e%2e%2f`) are the vector that
    // survives WHATWG normalization and lands here; see app.test.ts.
    if (!underRoot(candidate, root)) {
      return json404(c);
    }

    const target = resolveUnder(candidate, realRoot);
    if (target.kind === 'escape') {
      return json404(c);
    }
    if (target.kind === 'file') {
      const cacheControl =
        decoded === '/assets' || decoded.startsWith('/assets/') ? ASSET_CACHE : NO_CACHE;
      return new Response(Bun.file(target.path), {
        headers: { 'Cache-Control': cacheControl },
      });
    }

    const index = resolveUnder(join(root, 'index.html'), realRoot);
    if (index.kind !== 'file') {
      return unavailable(c);
    }
    return new Response(Bun.file(index.path), {
      headers: { 'Cache-Control': NO_CACHE },
    });
  };
}
