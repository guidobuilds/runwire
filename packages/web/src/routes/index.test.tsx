import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import type { SessionRollup, SessionSummary } from '../api/types';

/**
 * The Sessions landing route (`/`, f5) end to end, through the real generated
 * route tree: it must call `GET /api/sessions` with NO `ids` (the new no-ids
 * branch, packages/server/src/routes.ts) and render every returned root
 * session regardless of project or harness -- proving the M4
 * `beforeLoad: () => redirect({ to: '/projects' })` stub is really gone and
 * `/` renders `SessionTable` fed by `useAllSessions()`, not a copy of
 * `useProjectSessions`/`useCompareSessions`.
 */

const STATUS = {
  lastReport: null,
  adapters: [
    {
      id: 'claude-code',
      displayName: 'Claude Code',
      capabilities: ['timing'],
      probe: { installed: true, roots: ['/home/.claude'], notes: [] },
    },
    {
      id: 'codex',
      displayName: 'Codex',
      capabilities: ['timing'],
      probe: { installed: true, roots: ['/home/.codex'], notes: [] },
    },
  ],
};

function summary(
  id: string,
  harness: 'claude-code' | 'codex',
  projectName: string,
  output: number,
): SessionSummary {
  return {
    id,
    harness,
    depth: 0,
    title: { value: `title for ${id}`, contentDerived: true },
    project: { key: `github.com/acme/${projectName}`, name: projectName, identity: 'remote' },
    cwd: { first: '/tmp', all: ['/tmp'] },
    timing: {
      startedAt: { value: '2026-08-30T10:00:00.000Z', confidence: 'high', source: 'fake#1' },
    },
    model: { primary: undefined, all: [], changes: 0 },
    flags: {},
    usage: { output: { value: output, confidence: 'high', source: 'fake#1' } },
    counts: {},
    children: [],
    source: { path: `/tmp/${id}.jsonl`, sizeBytes: 1, mtimeMs: 0 },
    diagnostics: [],
  } as unknown as SessionSummary;
}

// Two sessions, deliberately spanning two different projects AND two
// different harnesses -- the one shape a scoped route (/projects/$key,
// /harnesses/$id) could never legitimately return in a single response.
const ALPHA = summary('claude-code:alpha', 'claude-code', 'one', 10);
const BETA = summary('codex:beta', 'codex', 'two', 20);

const ROLLUPS: Record<string, SessionRollup> = {};

/** Every URL the app actually requested, in order. */
const requested: string[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function handle(pathname: string, search: string): Response {
  if (pathname === '/api/status') return jsonResponse(STATUS);
  if (pathname === '/api/projects') return jsonResponse([]);
  if (pathname === '/api/harnesses') return jsonResponse([]);
  if (pathname === '/api/sessions') {
    // The landing route must hit this with NO ids -- a stray `ids=` here
    // would mean `/` is silently reusing Compare's query instead of
    // `useAllSessions()`.
    if (search.includes('ids=')) {
      return jsonResponse({ error: 'unexpected ids on the landing query' }, 400);
    }
    return jsonResponse({ summaries: [ALPHA, BETA], rollups: ROLLUPS });
  }
  return jsonResponse({ error: 'not found' }, 404);
}

vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  requested.push(url);
  const parsed = new URL(url, 'http://localhost');
  return Promise.resolve(handle(parsed.pathname, parsed.search));
});

/**
 * The route tree pulls in `api/client.ts`, which binds `fetch` at module
 * evaluation, so it must be imported below the stub above (lessons:
 * `web-api-module-fetch-binding`), the same ordering `param-encoding.test.tsx`
 * uses.
 */
// biome-ignore lint/suspicious/noExplicitAny: the generated tree's type is not needed to mount it
let routeTree: any;

beforeAll(async () => {
  ({ routeTree } = await import('../routeTree.gen'));
});

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY, gcTime: 0 } },
  });
}

function mountAtRoot() {
  const client = makeClient();
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return { client, router };
}

afterEach(() => {
  cleanup();
  requested.length = 0;
});

describe('/ renders the unscoped Sessions landing (f5)', () => {
  test('calls GET /api/sessions with no ids and renders every root session, across projects and harnesses', async () => {
    mountAtRoot();

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sessions');
    });

    await waitFor(() => {
      const sessionsCalls = requested.filter(
        (url) => new URL(url, 'http://localhost').pathname === '/api/sessions',
      );
      expect(sessionsCalls).toHaveLength(1);
      expect(sessionsCalls[0]).not.toContain('ids=');
    });

    await waitFor(() => {
      const body = screen.getAllByRole('rowgroup')[1];
      expect(body).toBeDefined();
      expect(within(body as HTMLElement).getAllByRole('row')).toHaveLength(2);
    });

    // Both projects and both harnesses are visible in one table -- the
    // unscoped landing, not a copy of a scoped route. Scoped to the table
    // body: the same project/harness names also appear as filter options.
    const body = screen.getAllByRole('rowgroup')[1] as HTMLElement;
    expect(within(body).getByText('one')).toBeTruthy();
    expect(within(body).getByText('two')).toBeTruthy();
    expect(within(body).getByText('Claude Code')).toBeTruthy();
    expect(within(body).getByText('Codex')).toBeTruthy();
  });

  test('the old M4 redirect to /projects is gone: the route stays at /', async () => {
    const { router } = mountAtRoot();

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).not.toBeNull();
    });

    expect(router.state.location.pathname).toBe('/');
    expect(requested.some((url) => url.includes('/api/projects/'))).toBe(false);
  });
});
