import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * `api/client.ts` binds `fetch` at module-evaluation time, and every top-level
 * `import` is hoisted above `vi.stubGlobal` — so `api/queries` is imported
 * dynamically inside each test, below the stub, and nothing statically
 * imported here may reach `api/*` (lessons: `web-api-module-fetch-binding`,
 * `vitest-fetch-stub-loses-to-esm-import-hoisting`).
 */

/** Every URL the recording network layer was actually asked for. */
const requested: string[] = [];
/** Path params the fake route matcher decoded out of those URLs. */
const received: Record<string, string> = {};

/**
 * Mirrors how Hono matches a `:param` segment: the value occupies exactly one
 * path segment, so a raw `/` inside it makes the request match no route. This
 * is what gives the encoding assertions teeth beyond string comparison — an
 * unencoded key produces the same 404 that a live `scout serve` returns
 * (measured in `build-log-f5.md`).
 */
const ROUTES: ReadonlyArray<{ pattern: RegExp; param: string; body: unknown }> = [
  {
    pattern: /^\/api\/projects\/([^/]+)\/sessions$/,
    param: 'projectKey',
    body: { summaries: [], rollups: [] },
  },
  {
    pattern: /^\/api\/harnesses\/([^/]+)\/sessions$/,
    param: 'harnessId',
    body: { summaries: [], rollups: [] },
  },
  {
    pattern: /^\/api\/sessions\/([^/]+)$/,
    param: 'sessionId',
    body: { summary: null, rollup: null, subtree: [], diagnostics: [] },
  },
];

function toPathname(url: string): string {
  return new URL(url, 'http://localhost').pathname;
}

function recordingFetch(input: RequestInfo | URL): Promise<Response> {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  requested.push(url);
  const pathname = toPathname(url);
  for (const route of ROUTES) {
    const match = route.pattern.exec(pathname);
    if (match?.[1] !== undefined) {
      // Hono decodes `c.req.param()` for the handler; do the same, so the test
      // can assert the value the server would actually see.
      received[route.param] = decodeURIComponent(match[1]);
      return Promise.resolve(
        new Response(JSON.stringify(route.body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
  }
  return Promise.resolve(
    new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

vi.stubGlobal('fetch', recordingFetch);

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/**
 * Three keys chosen for the three ways a verbatim interpolation breaks: a `/`
 * splits the value across path segments (every real `ProjectRef.key` is a repo
 * URL or a filesystem path, so this is every row, not an edge case); a literal
 * `%` starts a bogus escape; a space and a non-ASCII character are simply not
 * legal in a URL path.
 */
const HOSTILE_KEYS = ['github.com/org/repo', '100% real', 'my project/ünïcode'] as const;

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  requested.length = 0;
  for (const key of Object.keys(received)) delete received[key];
});

/**
 * `hc<AppType>`'s `replaceUrlParam` interpolates path params **verbatim**
 * (`hono/dist/client/utils.js`), so the encoding has to be applied by the
 * layer that builds the request. Doing it at a route call site leaves every
 * other caller of the same hook broken, which is why these assertions target
 * `api/queries.ts` directly and never render a route.
 */
describe('path-param encoding in the api layer', () => {
  test.each(HOSTILE_KEYS)('useProjectSessions encodes the project key %j', async (key) => {
    const { useProjectSessions } = await import('./queries');
    const { result } = renderHook(() => useProjectSessions(key), { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(requested).toHaveLength(1);
    // The raw string handed to `fetch`, then the same string normalised — the
    // first would catch an encoding `new URL` would quietly repair.
    expect(requested[0] ?? '').toContain(`/api/projects/${encodeURIComponent(key)}/sessions`);
    expect(toPathname(requested[0] ?? '')).toBe(
      `/api/projects/${encodeURIComponent(key)}/sessions`,
    );
    expect(received.projectKey).toBe(key);
  });

  test.each(HOSTILE_KEYS)('useHarnessSessions encodes the harness id %j', async (id) => {
    const { useHarnessSessions } = await import('./queries');
    const { result } = renderHook(() => useHarnessSessions(id), { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(requested[0] ?? '').toContain(`/api/harnesses/${encodeURIComponent(id)}/sessions`);
    expect(toPathname(requested[0] ?? '')).toBe(
      `/api/harnesses/${encodeURIComponent(id)}/sessions`,
    );
    expect(received.harnessId).toBe(id);
  });

  test.each(HOSTILE_KEYS)('useSession encodes the session id %j', async (id) => {
    const { useSession } = await import('./queries');
    const { result } = renderHook(() => useSession(id), { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(requested[0] ?? '').toContain(`/api/sessions/${encodeURIComponent(id)}`);
    expect(toPathname(requested[0] ?? '')).toBe(`/api/sessions/${encodeURIComponent(id)}`);
    expect(received.sessionId).toBe(id);
  });

  test('the query key stays the raw value, so callers cache by identity', async () => {
    const { queryKeys } = await import('./queries');
    expect(queryKeys.projectSessions('github.com/org/repo')).toEqual([
      'projects',
      'github.com/org/repo',
      'sessions',
    ]);
  });

  test('a real session id reaches the server unchanged', async () => {
    const { useSession } = await import('./queries');
    const id = 'claude-code:c018a32e-6244-4c1c-9776-6564c58334a1';
    const { result } = renderHook(() => useSession(id), { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(received.sessionId).toBe(id);
  });
});

/*
 * The route call sites used to be pinned here as **source text**
 * (`toContain('useProjectSessions(key)')` + `not.toContain('encodeURIComponent')`).
 * That pin is gone: it read raw source including comments, so it misfired in
 * both directions — a rename that keeps the double encode
 * (`rawKey.replace(/\//g, '%2F')`) slipped past it, and merely naming the
 * encoder in a comment turned it red (verification-f5-encoding.md residual R4).
 *
 * `src/routes/param-encoding.test.tsx` replaces it with the behaviour: both
 * routes mounted under the real `RouterProvider` through the generated route
 * tree, driven with hostile keys against a fake network that routes `:param`
 * the way Hono does.
 */
