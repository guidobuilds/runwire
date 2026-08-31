import { describe, expect, test } from 'bun:test';
import type { AdapterContext, HarnessAdapter, HarnessId, ScoutEvent, SourceRef } from '@scout/core';
import { createBunFs, ScoutStore } from '@scout/core';
import { createApp } from './app';

/**
 * Path-param encoding for the two `/api` routes that take a user-controlled
 * key (`/projects/:key/sessions`, `/harnesses/:id/sessions`).
 *
 * `c.req.param()` is already decoded by hono (4.13.5
 * `HonoRequest#getDecodedParam` -> `tryDecodeURIComponent`), so the routes must
 * use its value as-is. They used to `decodeURIComponent` it a second time,
 * which threw `URIError` (HTTP 500) for any key holding a literal `%` and
 * silently resolved `a%2Fb` to `a/b`. Every case below is a discriminator: the
 * fixture deliberately contains *both* members of each wrong-decode pair
 * (`a%2Fb` + `a/b`, `%41` + `A`), so a re-introduced decode returns the wrong
 * project's sessions rather than an empty list.
 *
 * A dedicated in-file adapter is used rather than `@scout/core/test-kit`'s
 * shared `createFakeAdapter`: these project keys exist only to be nasty, and
 * per .forge/lessons.md the shared fixture is edited by other dispatches.
 */

/** Index in this list == the `sN` sourceId of the session in that project. */
const PROJECT_CWDS = [
  '/repos/100% real/repo', // literal `%` next to a space: `decodeURIComponent` throws here
  '/repos/50%', // trailing `%` with nothing after it: also throws
  '/repos/a%2Fb', // the key whose text contains an encoded slash
  '/repos/a/b', // ...and the project a second decode wrongly selected instead
  '/repos/%41', // a key whose text is a valid percent-escape
  '/repos/A', // ...and what a second decode turns it into
  '/repos/café-プロ', // non-ASCII, must survive UTF-8 percent-encoding
  '/repos/plain', // control, and the target a double-encoded URL must NOT reach
  '/repos/c++ tools', // `+` is a space only in QUERY strings, never in a path
] as const;

function probeAdapter(harnessId: string): HarnessAdapter {
  const refs: SourceRef[] = PROJECT_CWDS.map((_cwd, i) => ({
    sourceId: `s${i}`,
    path: `/probe/s${i}.json`,
    kind: 'root' as const,
    sizeBytes: 10,
    mtimeMs: 1,
  }));

  return {
    id: harnessId as HarnessId, // ids with a `%` are not in the HarnessId union by design
    displayName: `Probe (${harnessId})`,
    adapterVersion: '1.0.0',
    capabilities: ['timing'],
    allowlist: { kind: true, sourceId: true, role: true },
    async probe() {
      return { installed: true, roots: [], notes: [] };
    },
    async *discover() {
      for (const ref of refs) yield ref;
    },
    async *parse(ref: SourceRef): AsyncIterable<ScoutEvent> {
      const index = Number(ref.sourceId.slice(1));
      yield {
        kind: 'meta',
        sourceId: ref.sourceId,
        role: 'root',
        cwd: PROJECT_CWDS[index],
        at: '2026-01-01T00:00:00Z',
      };
      yield { kind: 'observed', at: '2026-01-01T00:10:00Z' };
    },
    explain() {
      return undefined;
    },
    toolCategory() {
      return 'other';
    },
    harnessEventNames: [],
  };
}

type ProbeApp = {
  app: ReturnType<typeof createApp>;
  /** Everything `createApp`'s `onError` logged: non-empty means something threw. */
  errors: string[];
};

async function probeApp(harnessId = 'fake'): Promise<ProbeApp> {
  const errors: string[] = [];
  const ctx: AdapterContext = {
    home: '/probe',
    platform: 'linux',
    env: {},
    fs: createBunFs(),
    privacy: { titles: true },
    log: {
      info() {},
      warn() {},
      error(message) {
        errors.push(message);
      },
    },
  };
  // `projectIdentity: 'cwd'` makes ProjectRef.key the cwd verbatim, which is
  // what lets the fixture pin exact key text.
  const store = new ScoutStore([probeAdapter(harnessId)], ctx, { projectIdentity: 'cwd' });
  await store.rescan();
  return { app: createApp(store, ctx), errors };
}

type SessionsResult = { status: number; text: string; ids: string[] };

async function sessionsAt(probe: ProbeApp, url: string): Promise<SessionsResult> {
  const res = await probe.app.request(url);
  const text = await res.text();
  let ids: string[] = [];
  try {
    const body = JSON.parse(text) as { summaries?: Array<{ id: string }> };
    ids = (body.summaries ?? []).map((s) => s.id);
  } catch {
    // Non-JSON body: `ids` stays empty and `text` carries the evidence.
  }
  return { status: res.status, text, ids };
}

/** A response body must never carry an exception name, a stack frame or a path. */
function expectNoLeak(text: string) {
  expect(text).not.toContain('URIError');
  expect(text).not.toContain('malformed');
  expect(text).not.toContain('    at ');
  expect(text).not.toContain('/Users/');
  expect(text).not.toContain(import.meta.dir);
}

function projectUrl(key: string): string {
  return `/api/projects/${encodeURIComponent(key)}/sessions`;
}

describe('GET /api/projects/:key/sessions — the decoded param is used as-is', () => {
  test('a key containing a literal % resolves instead of throwing URIError (was HTTP 500)', async () => {
    const probe = await probeApp();

    const withSpace = await sessionsAt(probe, projectUrl('/repos/100% real/repo'));
    expect(withSpace.status).toBe(200);
    expect(withSpace.ids).toEqual(['fake:s0']);

    const trailing = await sessionsAt(probe, projectUrl('/repos/50%'));
    expect(trailing.status).toBe(200);
    expect(trailing.ids).toEqual(['fake:s1']);

    // Nothing threw: onError never ran, so neither response is a masked 500.
    expect(probe.errors).toEqual([]);
  });

  test('a key containing %2F is not silently turned into a key containing /', async () => {
    const probe = await probeApp();

    const encodedSlash = await sessionsAt(probe, projectUrl('/repos/a%2Fb'));
    expect(encodedSlash.status).toBe(200);
    expect(encodedSlash.ids).toEqual(['fake:s2']);

    // The project a second decode used to select. Both exist, so the bug was a
    // wrong answer with a 200, not an empty list.
    const realSlash = await sessionsAt(probe, projectUrl('/repos/a/b'));
    expect(realSlash.status).toBe(200);
    expect(realSlash.ids).toEqual(['fake:s3']);

    expect(encodedSlash.ids).not.toEqual(realSlash.ids);
    expect(probe.errors).toEqual([]);
  });

  test('a key that is a valid percent-escape is not decoded a second time into A', async () => {
    const probe = await probeApp();

    const percentEscape = await sessionsAt(probe, projectUrl('/repos/%41'));
    expect(percentEscape.status).toBe(200);
    expect(percentEscape.ids).toEqual(['fake:s4']); // the `%41` project
    expect(percentEscape.ids).not.toEqual(['fake:s5']); // NOT the `A` project

    const literalA = await sessionsAt(probe, projectUrl('/repos/A'));
    expect(literalA.ids).toEqual(['fake:s5']);
    expect(probe.errors).toEqual([]);
  });

  test('a non-ASCII key round-trips through UTF-8 percent-encoding', async () => {
    const probe = await probeApp();

    const result = await sessionsAt(probe, projectUrl('/repos/café-プロ'));
    expect(result.status).toBe(200);
    expect(result.ids).toEqual(['fake:s6']);
    expect(probe.errors).toEqual([]);
  });

  test('a key holding + keeps the + (that is a space only in a query string)', async () => {
    const probe = await probeApp();

    // `encodeURIComponent` escapes `+` as `%2B`, and hono's `+` -> space rule
    // (`_decodeURI`) applies to query params only -- a path param must not
    // pick it up.
    const escaped = await sessionsAt(probe, projectUrl('/repos/c++ tools'));
    expect(escaped.status).toBe(200);
    expect(escaped.ids).toEqual(['fake:s8']);

    // A literal `+` in a path segment is a literal `+`, so this URL names the
    // same key and must resolve to the same session. If anything ever applied
    // `+` -> space here the key would read `/repos/c   tools` and miss.
    const literalPlus = await sessionsAt(probe, '/api/projects/%2Frepos%2Fc++%20tools/sessions');
    expect(literalPlus.status).toBe(200);
    expect(literalPlus.ids).toEqual(['fake:s8']);

    expect(probe.errors).toEqual([]);
  });

  test('a double-encoded key does not match the key it would decode to', async () => {
    const probe = await probeApp();

    const singleEncoded = await sessionsAt(probe, projectUrl('/repos/plain'));
    expect(singleEncoded.ids).toEqual(['fake:s7']);

    // `%252Frepos%252Fplain` names the key `%2Frepos%2Fplain`, which no project
    // has. Under the double decode it reached `/repos/plain` and returned s7.
    const doubleEncoded = await sessionsAt(
      probe,
      `/api/projects/${encodeURIComponent(encodeURIComponent('/repos/plain'))}/sessions`,
    );
    expect(doubleEncoded.status).toBe(200);
    expect(doubleEncoded.ids).toEqual([]);
    expect(probe.errors).toEqual([]);
  });

  test('an empty key is a clean JSON 404 with no leak', async () => {
    const probe = await probeApp();

    const result = await sessionsAt(probe, '/api/projects//sessions');
    expect(result.status).toBe(404);
    expect(JSON.parse(result.text)).toEqual({ error: 'not found' });
    expectNoLeak(result.text);
    expect(probe.errors).toEqual([]);
  });

  test('malformed percent-encoding is a clean JSON miss, never a 500 and never a leak', async () => {
    const probe = await probeApp();

    // `%zz` is not hex, `%` has nothing after it, `%C0%80` is overlong UTF-8.
    // Hono's `tryDecodeURIComponent` hands each one back as raw text; the
    // route then simply matches no project. All three were HTTP 500 before.
    for (const raw of ['%zz', '%', '%C0%80', 'a%2', '%E0%A4%A']) {
      const result = await sessionsAt(probe, `/api/projects/${raw}/sessions`);
      expect(`${raw} -> ${result.status}`).toBe(`${raw} -> 200`);
      expect(`${raw} -> ${JSON.stringify(result.ids)}`).toBe(`${raw} -> []`);
      expectNoLeak(result.text);
    }
    expect(probe.errors).toEqual([]);
  });
});

describe('GET /api/harnesses/:id/sessions — the same param rule', () => {
  test('a harness id containing a literal % resolves and is not decoded into another id', async () => {
    // `fak%65` decodes to `fake` under a second `decodeURIComponent`, so the
    // pair discriminates exactly the way the project-key pairs do.
    const probe = await probeApp('fak%65');

    const real = await sessionsAt(probe, `/api/harnesses/${encodeURIComponent('fak%65')}/sessions`);
    expect(real.status).toBe(200);
    expect(real.ids.length).toBe(PROJECT_CWDS.length);
    expect(real.ids).toContain('fak%65:s0');

    const decodedForm = await sessionsAt(probe, '/api/harnesses/fake/sessions');
    expect(decodedForm.status).toBe(200);
    expect(decodedForm.ids).toEqual([]);

    expect(probe.errors).toEqual([]);
  });

  test('malformed percent-encoding in a harness id is a clean JSON miss', async () => {
    const probe = await probeApp();

    for (const raw of ['%zz', '%']) {
      const result = await sessionsAt(probe, `/api/harnesses/${raw}/sessions`);
      expect(`${raw} -> ${result.status}`).toBe(`${raw} -> 200`);
      expect(result.ids).toEqual([]);
      expectNoLeak(result.text);
    }
    expect(probe.errors).toEqual([]);
  });
});

describe('GET /api/sessions/:id — never decoded twice either', () => {
  test('a session id containing a literal % resolves, and its trace does too', async () => {
    // Session ids are `${harness}:${sourceId}`, so a `%`-bearing harness id
    // puts a literal `%` in the id these two routes take.
    const probe = await probeApp('fak%65');
    const encoded = encodeURIComponent('fak%65:s0');

    const res = await probe.app.request(`/api/sessions/${encoded}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summary: { id: string; project: { key: string } } };
    expect(body.summary.id).toBe('fak%65:s0');
    expect(body.summary.project.key).toBe('/repos/100% real/repo');

    const traceRes = await probe.app.request(`/api/sessions/${encoded}/trace`);
    expect(traceRes.status).toBe(200);
    const trace = (await traceRes.json()) as { id: string };
    expect(trace.id).toBe('fak%65:s0');

    expect(probe.errors).toEqual([]);
  });

  test('a malformed session id is a clean JSON 404, not a 500', async () => {
    const probe = await probeApp();

    for (const raw of ['%zz', '%']) {
      const res = await probe.app.request(`/api/sessions/${raw}`);
      const text = await res.text();
      expect(`${raw} -> ${res.status}`).toBe(`${raw} -> 404`);
      expect(JSON.parse(text)).toEqual({ error: 'session not found' });
      expectNoLeak(text);
    }
    expect(probe.errors).toEqual([]);
  });
});
