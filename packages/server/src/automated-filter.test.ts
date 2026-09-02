import { describe, expect, test } from 'bun:test';
import type {
  AdapterContext,
  HarnessAdapter,
  HarnessId,
  InitiatorKind,
  ScoutEvent,
  SourceRef,
} from '@scout/core';
import { createBunFs, ScoutStore } from '@scout/core';
import { createApp } from './app';

/**
 * `?automated=exclude` across every `/api` route that lists or counts root
 * sessions — and, just as load-bearing, the two routes that must keep resolving
 * a hidden session (`/sessions?ids=`, `/sessions/:id`).
 *
 * An in-file adapter rather than `@scout/core/test-kit`'s shared fake: this
 * fixture exists to pin exact per-scope counts, and the shared double is edited
 * by other dispatches (.forge/lessons.md, `fake-adapter-shared-fixture`).
 */

type Root = { sourceId: string; cwd: string; kind?: InitiatorKind; surface: string };

const HUMAN = 'p-human';
const MACHINE_IN_MIXED = 'p-machine';
const MACHINE_ONLY_1 = 'q-machine-1';
const MACHINE_ONLY_2 = 'q-machine-2';

/** `/repos/mixed` keeps one visible root; `/repos/ghost` has none at all. */
const ROOTS: Root[] = [
  { sourceId: HUMAN, cwd: '/repos/mixed', kind: 'human', surface: 'cli' },
  { sourceId: MACHINE_IN_MIXED, cwd: '/repos/mixed', kind: 'machine', surface: 'sdk-py' },
  { sourceId: MACHINE_ONLY_1, cwd: '/repos/ghost', kind: 'machine', surface: 'sdk-cli' },
  { sourceId: MACHINE_ONLY_2, cwd: '/repos/ghost', kind: 'machine', surface: 'sdk-cli' },
];

function adapter(): HarnessAdapter {
  return {
    id: 'fake' as HarnessId,
    displayName: 'Initiator probe',
    adapterVersion: '1.0.0',
    capabilities: ['timing', 'initiator'],
    allowlist: { kind: true, sourceId: true, role: true },
    explain: () => undefined,
    toolCategory: () => 'other' as const,
    harnessEventNames: [],
    async probe() {
      return { installed: true, roots: [], notes: [] };
    },
    async *discover() {
      for (const r of ROOTS) {
        yield {
          sourceId: r.sourceId,
          path: `/probe/${r.sourceId}.json`,
          kind: 'root' as const,
          sizeBytes: 10,
          mtimeMs: 1,
        };
      }
    },
    async *parse(ref: SourceRef): AsyncIterable<ScoutEvent> {
      const root = ROOTS.find((r) => r.sourceId === ref.sourceId);
      if (!root) return;
      yield {
        kind: 'meta',
        sourceId: root.sourceId,
        role: 'root',
        cwd: root.cwd,
        at: '2026-01-01T00:00:00Z',
      };
      if (root.kind) {
        yield {
          kind: 'initiator',
          initiatorKind: root.kind,
          surface: root.surface,
          confidence: 'high',
        };
      }
      yield { kind: 'observed', at: '2026-01-01T00:05:00Z' };
    },
  };
}

type ListBody = { summaries: Array<{ id: string }>; hiddenAutomated: number };

type ProjectsBody = {
  projects: Array<{ project: { key: string; name: string }; sessionCount: number }>;
  hiddenProjects: number;
  hiddenAutomated: number;
};

type HarnessesBody = {
  harnesses: Array<{ harness: string; sessionCount: number }>;
  hiddenHarnesses: number;
  hiddenAutomated: number;
};

async function scannedApp() {
  const ctx: AdapterContext = {
    home: '/home/u',
    platform: 'linux',
    env: {},
    fs: createBunFs(),
    privacy: { titles: true },
    log: { info() {}, warn() {}, error() {} },
  };
  const store = new ScoutStore([adapter()], ctx, { projectIdentity: 'cwd' });
  await store.rescan();
  return createApp(store, ctx);
}

async function json<T>(app: Awaited<ReturnType<typeof scannedApp>>, path: string): Promise<T> {
  const res = await app.request(path);
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

/** The project key `projectIdentity: 'cwd'` derives, discovered from the API itself. */
async function projectKey(
  app: Awaited<ReturnType<typeof scannedApp>>,
  name: string,
): Promise<string> {
  const { projects } = await json<ProjectsBody>(app, '/api/projects');
  const found = projects.find((p) => p.project.name === name);
  if (!found) throw new Error(`no project named ${name}`);
  return found.project.key;
}

describe('GET /api/sessions — the unscoped list', () => {
  test('no `automated` param is unchanged behavior: every root, nothing hidden', async () => {
    const app = await scannedApp();
    const body = await json<ListBody>(app, '/api/sessions');
    expect(body.summaries.length).toBe(4);
    expect(body.hiddenAutomated).toBe(0);
  });

  test('`automated=exclude` hides the machine roots and says how many', async () => {
    const app = await scannedApp();
    const body = await json<ListBody>(app, '/api/sessions?automated=exclude');
    expect(body.summaries.map((s) => s.id)).toEqual([`fake:${HUMAN}`]);
    expect(body.hiddenAutomated).toBe(3);
  });

  test('anything other than the literal `exclude` includes everything', async () => {
    const app = await scannedApp();
    // The API default is "everything". A typo, a stale client, or a truthiness
    // bug must fail towards showing too much, never towards silently hiding a
    // developer's sessions.
    for (const value of ['include', 'true', '1', 'Exclude', '']) {
      const body = await json<ListBody>(app, `/api/sessions?automated=${value}`);
      expect(body.summaries.length).toBe(4);
      expect(body.hiddenAutomated).toBe(0);
    }
  });
});

describe('the aggregate routes follow the same filter', () => {
  test('GET /api/projects drops a project whose roots are 100% machine', async () => {
    const app = await scannedApp();

    const all = await json<ProjectsBody>(app, '/api/projects');
    expect(all.projects.map((p) => p.project.name).sort()).toEqual(['ghost', 'mixed']);

    const filtered = await json<ProjectsBody>(app, '/api/projects?automated=exclude');
    expect(filtered.projects.map((p) => p.project.name)).toEqual(['mixed']);
    expect(filtered.projects[0]?.sessionCount).toBe(1);
  });

  test('GET /api/harnesses narrows sessionCount', async () => {
    const app = await scannedApp();
    expect((await json<HarnessesBody>(app, '/api/harnesses')).harnesses[0]?.sessionCount).toBe(4);
    expect(
      (await json<HarnessesBody>(app, '/api/harnesses?automated=exclude')).harnesses[0]
        ?.sessionCount,
    ).toBe(1);
  });
});

/**
 * The aggregate routes returned bare arrays until this fix, so `/projects` and
 * `/harnesses` had nothing to disclose with — on real data `/projects` dropped
 * 184 of 204 cards with no trace on screen.
 *
 * The fixture is deliberately built so the two counts in one body are
 * *different numbers* (1 hidden project vs 3 hidden sessions): swapping the
 * units, which is the mistake this disclosure invites, cannot pass here.
 */
describe('the aggregate routes disclose what the filter removed', () => {
  test('GET /api/projects reports hidden projects and hidden sessions separately', async () => {
    const app = await scannedApp();

    const all = await json<ProjectsBody>(app, '/api/projects');
    expect(all.hiddenProjects).toBe(0);
    expect(all.hiddenAutomated).toBe(0);

    const filtered = await json<ProjectsBody>(app, '/api/projects?automated=exclude');
    // One whole project (`ghost`) stopped existing...
    expect(filtered.hiddenProjects).toBe(1);
    // ...while three root sessions left the counts of the projects that remain.
    expect(filtered.hiddenAutomated).toBe(3);
  });

  test('GET /api/harnesses discloses hidden sessions even when no harness disappears', async () => {
    const app = await scannedApp();

    const all = await json<HarnessesBody>(app, '/api/harnesses');
    expect(all.hiddenHarnesses).toBe(0);
    expect(all.hiddenAutomated).toBe(0);

    const filtered = await json<HarnessesBody>(app, '/api/harnesses?automated=exclude');
    // The single harness survives (it still has one human root), so the only
    // honest thing to say is how many sessions its `sessionCount` lost.
    expect(filtered.harnesses).toHaveLength(1);
    expect(filtered.hiddenHarnesses).toBe(0);
    expect(filtered.hiddenAutomated).toBe(3);
  });

  test('the disclosed counts equal the rows the filter actually removed', async () => {
    const app = await scannedApp();
    // Sourced from the same seam, so this can never be a coincidence of two
    // predicates agreeing today: recompute both from the unfiltered bodies.
    const allProjects = await json<ProjectsBody>(app, '/api/projects');
    const filteredProjects = await json<ProjectsBody>(app, '/api/projects?automated=exclude');
    expect(filteredProjects.hiddenProjects).toBe(
      allProjects.projects.length - filteredProjects.projects.length,
    );

    const allSessions = await json<ListBody>(app, '/api/sessions');
    const filteredSessions = await json<ListBody>(app, '/api/sessions?automated=exclude');
    expect(filteredProjects.hiddenAutomated).toBe(
      allSessions.summaries.length - filteredSessions.summaries.length,
    );

    const filteredHarnesses = await json<HarnessesBody>(app, '/api/harnesses?automated=exclude');
    expect(filteredHarnesses.hiddenAutomated).toBe(filteredProjects.hiddenAutomated);
  });

  test('anything other than `exclude` discloses nothing on the aggregate routes too', async () => {
    const app = await scannedApp();
    for (const value of ['include', 'true', '1', 'Exclude', '']) {
      const projects = await json<ProjectsBody>(app, `/api/projects?automated=${value}`);
      expect(projects.projects).toHaveLength(2);
      expect(projects.hiddenProjects).toBe(0);
      expect(projects.hiddenAutomated).toBe(0);

      const harnesses = await json<HarnessesBody>(app, `/api/harnesses?automated=${value}`);
      expect(harnesses.hiddenHarnesses).toBe(0);
      expect(harnesses.hiddenAutomated).toBe(0);
    }
  });
});

describe('the scoped list routes report a per-scope hidden count', () => {
  test('GET /api/projects/:key/sessions', async () => {
    const app = await scannedApp();
    const mixed = await projectKey(app, 'mixed');
    const ghost = await projectKey(app, 'ghost');

    const mixedBody = await json<ListBody>(
      app,
      `/api/projects/${encodeURIComponent(mixed)}/sessions?automated=exclude`,
    );
    expect(mixedBody.summaries.map((s) => s.id)).toEqual([`fake:${HUMAN}`]);
    // 1, not 3: the count describes this scope, not the whole machine.
    expect(mixedBody.hiddenAutomated).toBe(1);

    // A project reachable only by deep link once it has dropped out of the
    // rollup: an empty list that explains itself, not a 404.
    const ghostBody = await json<ListBody>(
      app,
      `/api/projects/${encodeURIComponent(ghost)}/sessions?automated=exclude`,
    );
    expect(ghostBody.summaries).toEqual([]);
    expect(ghostBody.hiddenAutomated).toBe(2);
  });

  test('GET /api/harnesses/:id/sessions', async () => {
    const app = await scannedApp();
    const body = await json<ListBody>(app, '/api/harnesses/fake/sessions?automated=exclude');
    expect(body.summaries.map((s) => s.id)).toEqual([`fake:${HUMAN}`]);
    expect(body.hiddenAutomated).toBe(3);
  });
});

describe('the explicit-choice routes are never filtered', () => {
  test('GET /api/sessions?ids= resolves hidden sessions even with automated=exclude', async () => {
    const app = await scannedApp();
    // Compare's endpoint. Filtering here would delete columns the user put in
    // the tray by hand — and the tray persists in localStorage, so comparing
    // sessions the table refuses to list is a reachable state, not a hypothetical.
    const ids = `fake:${MACHINE_IN_MIXED},fake:${MACHINE_ONLY_1}`;
    const body = await json<{ summaries: Array<{ id: string }> }>(
      app,
      `/api/sessions?ids=${encodeURIComponent(ids)}&automated=exclude`,
    );
    expect(body.summaries.map((s) => s.id)).toEqual([
      `fake:${MACHINE_IN_MIXED}`,
      `fake:${MACHINE_ONLY_1}`,
    ]);
  });

  test('GET /api/sessions/:id resolves a hidden session (deep link / Back button)', async () => {
    const app = await scannedApp();
    const res = await app.request(`/api/sessions/fake:${MACHINE_ONLY_2}?automated=exclude`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summary: { id: string } };
    expect(body.summary.id).toBe(`fake:${MACHINE_ONLY_2}`);
  });

  test('a hidden session still has a trace', async () => {
    const app = await scannedApp();
    const res = await app.request(`/api/sessions/fake:${MACHINE_ONLY_2}/trace?automated=exclude`);
    expect(res.status).toBe(200);
  });
});
