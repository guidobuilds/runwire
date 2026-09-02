import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The Projects and Harnesses grids must disclose what the "Automated"
 * preference removed from them — the defect this file exists to prevent is
 * exact and was measured live: with the preference at its default, `/projects`
 * dropped 184 of 204 cards and `/harnesses` narrowed 383 sessions to 65, and
 * the word "Automated" appeared nowhere on either page except the topbar
 * switch's own label. The docs claimed otherwise.
 *
 * These are ROUTE-level tests through the real generated route tree, not
 * component tests of `AutomatedDisclosure`. A component test would prove the
 * disclosure can render; only mounting the actual route proves it is on the
 * page — which is precisely the gap that shipped last time.
 *
 * The second thing pinned here is the **unit** of each number. A projects grid
 * hides *projects*, but `hiddenAutomated` counts *sessions*; the fixture keeps
 * them far apart (184 vs 318) so a swapped or reused count cannot pass.
 */

const HIDDEN_PROJECTS = 184;
const VISIBLE_PROJECTS = 20;
const HIDDEN_SESSIONS = 318;

const STATUS = {
  // `useHasData()` gates every index route on a completed scan that parsed
  // something; without this the routes render the doctor-like EmptyState and
  // the grid (and its disclosure) never mounts at all.
  lastReport: {
    startedAt: '2026-09-01T00:00:00.000Z',
    durationMs: 1,
    perAdapter: { 'claude-code': { discovered: 1, parsed: 1, failed: 0, skipped: 0 } },
    diagnostics: [],
  },
  adapters: [
    {
      id: 'claude-code',
      displayName: 'Claude Code',
      capabilities: ['timing', 'initiator'],
      probe: { installed: true, roots: ['/home/.claude'], notes: [] },
    },
  ],
};

function projectAggregate(name: string) {
  return {
    project: { key: `github.com/acme/${name}`, name, identity: 'remote' },
    sessionCount: 3,
    harnesses: ['claude-code'],
    aggregateUsage: {},
    latestActivityAt: '2026-09-01T00:00:00.000Z',
  };
}

function harnessAggregate() {
  return {
    harness: 'claude-code',
    sessionCount: 65,
    projects: ['github.com/acme/p0'],
    aggregateUsage: {},
    latestActivityAt: '2026-09-01T00:00:00.000Z',
  };
}

/** Mutated per test, before mounting. */
let projectsBody: unknown;
let harnessesBody: unknown;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function handle(pathname: string): Response {
  if (pathname === '/api/status') return jsonResponse(STATUS);
  if (pathname === '/api/projects') return jsonResponse(projectsBody);
  if (pathname === '/api/harnesses') return jsonResponse(harnessesBody);
  // Each card fetches its own sessions for the sparkline.
  if (pathname.startsWith('/api/projects/') || pathname.startsWith('/api/harnesses/')) {
    return jsonResponse({ summaries: [], rollups: {}, hiddenAutomated: 0 });
  }
  return jsonResponse({ error: 'not found' }, 404);
}

vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  return Promise.resolve(handle(new URL(url, 'http://localhost').pathname));
});

/**
 * `api/client.ts` binds `fetch` at module evaluation, so the route tree has to
 * be imported below the stub (lessons: `web-api-module-fetch-binding`).
 */
// biome-ignore lint/suspicious/noExplicitAny: the generated tree's type is not needed to mount it
let routeTree: any;

beforeAll(async () => {
  ({ routeTree } = await import('../routeTree.gen'));
});

function mountAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY, gcTime: 0 } },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

/** Absolute path to a repo-root-relative file, found by walking up from the Vitest cwd. */
function repoFile(relative: string): string {
  let dir = process.cwd();
  for (;;) {
    const candidate = join(dir, relative);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`could not find ${relative} above ${process.cwd()}`);
    dir = parent;
  }
}

/** The whole rendered page, so an assertion cannot miss text by querying the wrong node. */
function pageText(): string {
  return document.body.textContent ?? '';
}

beforeEach(() => {
  projectsBody = {
    projects: Array.from({ length: VISIBLE_PROJECTS }, (_, i) => projectAggregate(`p${i}`)),
    hiddenProjects: HIDDEN_PROJECTS,
    hiddenAutomated: HIDDEN_SESSIONS,
  };
  harnessesBody = {
    harnesses: [harnessAggregate()],
    hiddenHarnesses: 0,
    hiddenAutomated: HIDDEN_SESSIONS,
  };
});

afterEach(() => {
  cleanup();
});

describe('/projects discloses what the automated filter removed', () => {
  test('names the hidden projects and the uncounted sessions as separate quantities', async () => {
    mountAt('/projects');

    await waitFor(() => {
      expect(
        screen.getByText(
          `${HIDDEN_PROJECTS} of ${HIDDEN_PROJECTS + VISIBLE_PROJECTS} projects hidden · ${HIDDEN_SESSIONS} automated sessions not counted`,
        ),
      ).toBeTruthy();
    });
  });

  test('never mixes the units: no "184 sessions" and no "318 projects" anywhere on the page', async () => {
    mountAt('/projects');
    await waitFor(() => {
      expect(screen.getByText(/projects hidden/)).toBeTruthy();
    });

    const text = pageText();
    // The count of hidden PROJECTS must never be attached to the word session,
    // and the count of hidden SESSIONS must never be attached to the word
    // project. This is the specific mistake the disclosure invites.
    expect(text).not.toMatch(new RegExp(`${HIDDEN_PROJECTS}\\s+(automated\\s+)?sessions?`));
    expect(text).not.toMatch(new RegExp(`${HIDDEN_SESSIONS}\\s+projects?`));
  });

  test('says nothing at all when the filter removed nothing', async () => {
    projectsBody = {
      projects: [projectAggregate('p0')],
      hiddenProjects: 0,
      hiddenAutomated: 0,
    };
    mountAt('/projects');

    // Wait for the grid itself, so this is not just asserting on an empty page.
    await waitFor(() => {
      expect(screen.getByText('p0')).toBeTruthy();
    });
    expect(pageText()).not.toMatch(/hidden|not counted/i);
  });

  test('the copy names it noise, never cost or savings', async () => {
    // The premise that this feature reveals ~96% of the token mass was measured
    // and refuted: the hidden sessions are ~83% of the ROWS but only a couple of
    // percent of the tokens. Same pinned words as the session table's own
    // disclosure (SessionTable.test.tsx) — a second surface must not be allowed
    // to reintroduce the claim the first one rejected.
    mountAt('/projects');
    const node = await screen.findByText(/projects hidden/);
    const text = (node.textContent ?? '').toLowerCase();
    for (const forbidden of ['cost', 'spend', 'saving', '96%', '$']) {
      expect(text).not.toContain(forbidden.toLowerCase());
    }
  });
});

describe('/harnesses discloses what the automated filter removed', () => {
  test('discloses the uncounted sessions even though no harness card disappeared', async () => {
    mountAt('/harnesses');

    await waitFor(() => {
      expect(screen.getByText(`${HIDDEN_SESSIONS} automated sessions not counted`)).toBeTruthy();
    });
    // No harness vanished, so claiming one did would be false.
    expect(pageText()).not.toMatch(/harnesses? hidden/);
  });

  test('adds the card clause only when a harness really did disappear', async () => {
    harnessesBody = {
      harnesses: [harnessAggregate()],
      hiddenHarnesses: 1,
      hiddenAutomated: HIDDEN_SESSIONS,
    };
    mountAt('/harnesses');

    await waitFor(() => {
      expect(
        screen.getByText(
          `1 of 2 harnesses hidden · ${HIDDEN_SESSIONS} automated sessions not counted`,
        ),
      ).toBeTruthy();
    });
  });

  test('says nothing at all when the filter removed nothing', async () => {
    harnessesBody = { harnesses: [harnessAggregate()], hiddenHarnesses: 0, hiddenAutomated: 0 };
    mountAt('/harnesses');

    // `Claude Code` also appears in the page <title>, so anchor on the card's
    // own session count instead.
    await waitFor(() => {
      expect(screen.getByText(/65 sessions/)).toBeTruthy();
    });
    expect(pageText()).not.toMatch(/hidden|not counted/i);
  });

  test('the copy names it noise, never cost or savings', async () => {
    mountAt('/harnesses');
    const node = await screen.findByText(/automated sessions not counted/);
    const text = (node.textContent ?? '').toLowerCase();
    for (const forbidden of ['cost', 'spend', 'saving', '96%', '$']) {
      expect(text).not.toContain(forbidden.toLowerCase());
    }
  });
});

/**
 * The documentation feature's own guard.
 *
 * `docs/PRODUCT-UI.md` §4.7 used to promise a disclosure on Projects and
 * Harnesses that was never built, and the feature's stated verification was
 * `bun run lint` — a linter cannot see whether prose matches shipped behavior,
 * which is exactly how the claim survived. This closes that loop by reading the
 * doc and requiring the strings it advertises to be the strings the routes
 * above actually render: change the copy without the doc, or the doc without
 * the copy, and this goes red.
 *
 * The fixture numbers are the real measured ones (184 hidden of 204 projects,
 * 318 hidden sessions) precisely so one string can serve both purposes.
 */
describe('docs/PRODUCT-UI.md §4.7 describes the disclosure that actually ships', () => {
  // Walk up from the Vitest cwd (`packages/web`) to the repo root rather than
  // resolving against `import.meta.url`: under the happy-dom environment the
  // global `URL` is happy-dom's, and `fileURLToPath` rejects it.
  const doc = readFileSync(repoFile('docs/PRODUCT-UI.md'), 'utf8');

  /**
   * §4.7's per-screen table row for one screen. Scoped to the row rather than
   * matched against the whole document on purpose: the two rows quote
   * overlapping strings, so a whole-file `toContain` lets the Harnesses row say
   * anything at all as long as the Projects row still happens to quote the same
   * words (measured — a mutant that rewrote the Harnesses row survived that
   * weaker assertion).
   */
  function tableRow(screenName: string): string {
    const row = doc.split('\n').find((line) => line.startsWith(`| ${screenName} (§`));
    if (!row) throw new Error(`no §4.7 table row for ${screenName} in docs/PRODUCT-UI.md`);
    return row;
  }

  test('the projects copy on screen is the copy the doc advertises', async () => {
    mountAt('/projects');
    const rendered = (await screen.findByText(/projects hidden/)).textContent ?? '';
    expect(rendered).toBe(
      `${HIDDEN_PROJECTS} of ${HIDDEN_PROJECTS + VISIBLE_PROJECTS} projects hidden · ${HIDDEN_SESSIONS} automated sessions not counted`,
    );
    expect(tableRow('Projects')).toContain(rendered);
  });

  test('the harnesses copy on screen is the copy the doc advertises', async () => {
    mountAt('/harnesses');
    const rendered = (await screen.findByText(/automated sessions not counted/)).textContent ?? '';
    expect(rendered).toBe(`${HIDDEN_SESSIONS} automated sessions not counted`);
    expect(tableRow('Harnesses')).toContain(rendered);
  });

  test('the doc no longer claims the shell counts disclose anything', () => {
    // The status strip and sidebar totals genuinely do not disclose; the doc
    // has to say so rather than imply otherwise.
    expect(doc).toMatch(/Not disclosed, and deliberately so/);
  });
});
