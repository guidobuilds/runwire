import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import type { SessionRollup, SessionSummary } from '../api/types';

/**
 * The full loop for a path param, through the **real** generated route tree:
 * browser URL -> `useParams()` -> the api hook -> the request that leaves ->
 * the record that comes back -> the rows on screen.
 *
 * This exists because the guard it replaces was a source-text assertion on the
 * call shape (`toContain('useProjectSessions(key)')` +
 * `not.toContain('encodeURIComponent')`). An adversary defeated it with a
 * rename that keeps the bug — `const key = rawKey.replace(/\//g, '%2F')` — and
 * the whole suite stayed green (verification-f5-encoding.md residual R4). It
 * also misfired the other way: writing the banned word in a comment turned the
 * suite red.
 *
 * Two halves have to disagree for the bug to exist, so both are real here:
 * TanStack Router percent-encodes on the way out and hands the **raw** value
 * back to the component, while `hc<AppType>` interpolates path params
 * verbatim, so `api/queries.ts` owns the encoding. The network is faked, but
 * the fake **routes** — a `:param` occupies exactly one path segment, exactly
 * as Hono matches it — so an unencoded `/` produces the same "no such route"
 * a live `scout serve` produces, and a doubly-encoded key produces the same
 * 200-with-nothing.
 */

// ---------------------------------------------------------------------------
// Fixture: every key owns exactly ONE session, and the keys come in pairs that
// a wrong decode confuses (`a/b` vs `a%2Fb`, `A` vs `%41`, `%41` vs `%2541`).
// A mis-encoded request therefore returns the WRONG record or none, never a
// harmless empty list that a green test could be mistaken for.
// ---------------------------------------------------------------------------

const PROJECT_KEYS = [
  'github.com/org/repo',
  '/repos/a/b',
  '/repos/a%2Fb',
  '/repos/A',
  '/repos/%41',
  '/repos/%2541',
  '/repos/100% real/repo',
  '/repos/50%',
  '/repos/p q',
  '/repos/café-プロ',
  '/repos/a+b',
  '/repos/a#b',
  '/repos/a?b',
  '/repos/a&b=c',
  '/repos/a;b',
  '/repos/a\\b',
  '/repos/trailing.',
  '/repos/trail ',
  '/repos/ lead',
] as const;

/** Harness ids that are not plain slugs, including two that own no sessions. */
const HARNESS_IDS = ['claude-code', 'claude/code', 'claude code', '100% claude'] as const;

const CAPABILITIES = [
  'usage.perCall',
  'usage.cumulative',
  'usage.cacheWrite',
  'usage.reasoning',
  'timing',
  'mode',
  'effort',
  'version',
  'turns',
  'toolCalls',
  'compactions',
  'subagents',
  'cost',
  'title',
  'git',
];

function sessionIdFor(key: string): string {
  return `claude-code:sess-${PROJECT_KEYS.indexOf(key as (typeof PROJECT_KEYS)[number])}`;
}

function makeSummary(key: string): SessionSummary {
  const id = sessionIdFor(key);
  return {
    id,
    harness: 'claude-code',
    depth: 0,
    title: { value: `run for ${id}`, contentDerived: true },
    project: { key, name: key, identity: 'remote' },
    cwd: { first: '/tmp/work', all: ['/tmp/work'] },
    timing: {
      startedAt: {
        value: '2026-08-30T10:00:00.000Z',
        confidence: 'high',
        source: 'fake/meta#1',
      },
    },
    model: { primary: undefined, all: [], changes: 0 },
    flags: {},
    usage: {},
    counts: {},
    children: [],
    source: { path: `/tmp/${id}.jsonl`, sizeBytes: 10, mtimeMs: 0 },
    diagnostics: [],
  } as unknown as SessionSummary;
}

const SUMMARY_BY_KEY = new Map<string, SessionSummary>(
  PROJECT_KEYS.map((key) => [key, makeSummary(key)]),
);

const ROLLUPS: Record<string, SessionRollup> = {};

const STATUS = {
  lastReport: null,
  adapters: [
    {
      id: 'claude-code',
      displayName: 'Claude Code',
      capabilities: CAPABILITIES,
      probe: { installed: true, roots: ['/home/.claude'], notes: [] },
    },
  ],
};

// ---------------------------------------------------------------------------
// The fake network. It ROUTES: `[^/]+` mirrors a Hono `:param`, and the handler
// reads `decodeURIComponent(segment)` exactly as `c.req.param()` hands it over.
// ---------------------------------------------------------------------------

/** Every URL the app actually asked for, in order. */
const requested: string[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function handle(pathname: string): Response {
  if (pathname === '/api/status') return jsonResponse(STATUS);
  if (pathname === '/api/projects') return jsonResponse([]);
  if (pathname === '/api/harnesses') return jsonResponse([]);

  const project = /^\/api\/projects\/([^/]+)\/sessions$/.exec(pathname);
  if (project?.[1] !== undefined) {
    const key = decodeURIComponent(project[1]);
    const summary = SUMMARY_BY_KEY.get(key);
    // Unknown key: 200 with nothing, which is what the real server returns —
    // so a mis-encoded request is a page with no rows, not an error page.
    return jsonResponse({ summaries: summary ? [summary] : [], rollups: ROLLUPS });
  }

  const harness = /^\/api\/harnesses\/([^/]+)\/sessions$/.exec(pathname);
  if (harness?.[1] !== undefined) {
    const id = decodeURIComponent(harness[1]);
    const summaries = id === 'claude-code' ? [...SUMMARY_BY_KEY.values()] : [];
    return jsonResponse({ summaries, rollups: ROLLUPS });
  }

  const session = /^\/api\/sessions\/([^/]+)$/.exec(pathname);
  if (session?.[1] !== undefined) {
    return jsonResponse({ summary: null, rollup: null, subtree: [], diagnostics: [] }, 404);
  }

  return jsonResponse({ error: 'not found' }, 404);
}

vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  requested.push(url);
  return Promise.resolve(handle(new URL(url, 'http://localhost').pathname));
});

/**
 * The route tree pulls in `api/client.ts`, which binds `fetch` at module
 * evaluation, and every top-level import is hoisted above `vi.stubGlobal` — so it
 * is imported here, below the stub (lessons: `web-api-module-fetch-binding`,
 * `vitest-fetch-stub-loses-to-esm-import-hoisting`). Only `import type` above
 * may reach `api/*`, since types are erased.
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

/** The href the app itself would produce for a typed `params` navigation. */
function hrefFor(to: string, params: Record<string, string>): string {
  return createRouter({ routeTree }).buildLocation({ to, params } as never).href;
}

async function mountAt(href: string) {
  const client = makeClient();
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [href] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return { client, router };
}

/**
 * The route header's own text, read raw. `getByText` normalises whitespace, so
 * it cannot tell `/repos/trail ` from `/repos/trail`, and "N sessions" appears
 * in the toolbar too — this reads the one element the route renders.
 */
function headerText(): string {
  const heading = screen.getByRole('heading', { level: 1 });
  return heading.closest('header')?.textContent ?? '';
}

function bodyRowLabels(): string[] {
  const groups = screen.queryAllByRole('rowgroup');
  const body = groups[1];
  if (!body) return [];
  return within(body)
    .getAllByRole('row')
    .map((row) => within(row).getAllByRole('cell')[1]?.textContent?.trim() ?? '');
}

afterEach(() => {
  cleanup();
  requested.length = 0;
});

describe('/projects/$key carries the raw key end to end', () => {
  test.each(PROJECT_KEYS)(
    '%j reaches the server as itself and renders its own row',
    async (key) => {
      const href = hrefFor('/projects/$key', { key });

      // The browser URL is singly encoded and decodes back to the key.
      expect(decodeURIComponent(href.replace('/projects/', ''))).toBe(key);

      await mountAt(href);
      await waitFor(
        () => {
          expect(screen.getByRole('heading', { level: 1 })).not.toBeNull();
        },
        { timeout: 4000 },
      );

      const apiCalls = requested.filter((url) => url.includes('/api/projects/'));
      expect(apiCalls).toHaveLength(1);

      // The one path segment, decoded the way Hono decodes `c.req.param()`.
      const segment = (apiCalls[0] ?? '')
        .replace('/api/projects/', '')
        .replace('/sessions', '')
        .split('?')[0];
      expect(decodeURIComponent(segment ?? '')).toBe(key);

      // ...and the record that came back is the one this key owns, shown against
      // the raw key. A neighbouring key would render a different session id.
      await waitFor(() => {
        expect(bodyRowLabels()).toEqual([`run for ${sessionIdFor(key)}`]);
      });
      expect(headerText()).toContain(`1 sessions · ${key}`);
    },
  );
});

describe('/harnesses/$id carries the raw id end to end', () => {
  test.each(HARNESS_IDS)('%j reaches the server as itself', async (id) => {
    const href = hrefFor('/harnesses/$id', { id });
    expect(decodeURIComponent(href.replace('/harnesses/', ''))).toBe(id);

    await mountAt(href);
    await waitFor(
      () => {
        expect(screen.getByRole('heading', { level: 1 })).not.toBeNull();
      },
      { timeout: 4000 },
    );

    const apiCalls = requested.filter((url) => url.includes('/api/harnesses/'));
    expect(apiCalls).toHaveLength(1);
    const segment = (apiCalls[0] ?? '')
      .replace('/api/harnesses/', '')
      .replace('/sessions', '')
      .split('?')[0];
    expect(decodeURIComponent(segment ?? '')).toBe(id);

    const expected = id === 'claude-code' ? PROJECT_KEYS.length : 0;
    await waitFor(() => {
      expect(headerText()).toContain(`${expected} sessions`);
    });
    // An unknown harness has no display name, so the heading is the raw id.
    if (id !== 'claude-code') expect(headerText()).toContain(id);
  });
});

describe('/sessions/$id carries the raw id end to end', () => {
  test.each([
    'claude-code:c018a32e-6244-4c1c-9776-6564c58334a1',
    'claude-code:id/slash',
    'claude-code:id%2Fslash',
    'claude-code:id 100% x',
  ])('%j reaches the server as itself', async (id) => {
    const href = hrefFor('/sessions/$id', { id });
    expect(decodeURIComponent(href.replace('/sessions/', ''))).toBe(id);

    await mountAt(href);
    await waitFor(
      () => {
        expect(requested.some((url) => url.includes('/api/sessions/'))).toBe(true);
      },
      { timeout: 4000 },
    );

    const apiCalls = requested.filter((url) => url.includes('/api/sessions/'));
    expect(apiCalls).toHaveLength(1);
    const segment = (apiCalls[0] ?? '').replace('/api/sessions/', '').split('?')[0];
    expect(decodeURIComponent(segment ?? '')).toBe(id);
  });
});

/**
 * The prose half of this guard.
 *
 * `routes/projects.$key.tsx` and `routes/harnesses.$id.tsx` each end their
 * "hand the value over raw" comment with the name of the test that pins it.
 * That sentence went false the moment the pin moved here out of
 * `api/queries.test.tsx` (verification-f4-fix.md F4F-2) — the named file was
 * still on disk, so nothing was red, and only a human reading two files at once
 * could notice.
 *
 * What is asserted is the **link**, not a call shape: whatever file a route
 * names must exist AND must itself name that route. A pin that moves again
 * leaves a red test rather than a stale sentence. This is not the source-text
 * ban that R4 replaced — it cannot misfire on the presence or absence of an
 * identifier in the route body, only on a reference that no longer resolves.
 *
 * Read through `process.cwd()`: under happy-dom `import.meta.url` is an http
 * URL, so the usual `new URL('./x', import.meta.url)` idiom ENOENTs.
 */
describe('the pin these two routes name resolves to a guard that covers them', () => {
  test.each(['projects.$key.tsx', 'harnesses.$id.tsx'])(
    '%s names a pin that exists and knows about it',
    (routeFile) => {
      const routeSource = readFileSync(resolve(process.cwd(), 'src/routes', routeFile), 'utf8');
      const named = [...routeSource.matchAll(/pinned by `([^`]+)`/g)].map((match) => match[1]);

      expect(named.length).toBeGreaterThan(0);
      for (const pin of named) {
        const pinPath = resolve(process.cwd(), 'src', pin ?? '');
        expect(existsSync(pinPath)).toBe(true);
        expect(readFileSync(pinPath, 'utf8')).toContain(routeFile);
      }
    },
  );
});
