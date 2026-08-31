import { afterAll, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdapterContext } from '@scout/core';
import { createBunFs, ScoutStore } from '@scout/core';
import { createFakeAdapter } from '@scout/core/test-kit';
import { createApp } from './app';

function fakeContext(): AdapterContext {
  return {
    home: '/fake',
    platform: 'linux',
    env: {},
    fs: createBunFs(),
    privacy: { titles: true },
    log: { info() {}, warn() {}, error() {} },
  };
}

function makeApp(webDist?: string) {
  const ctx = fakeContext();
  const store = new ScoutStore([createFakeAdapter()], ctx, { projectIdentity: 'cwd' });
  return createApp(store, ctx, webDist === undefined ? {} : { webDist });
}

const fixtureRoot = mkdtempSync(join(tmpdir(), 'scout-web-dist-'));
const webDist = join(fixtureRoot, 'dist');
const SENTINEL = 'SCOUT_SHOULD_NOT_SERVE_PACKAGE_JSON';
const OUTSIDE_SECRET = 'SCOUT_SHOULD_NOT_SERVE_OUTSIDE_SECRET';
mkdirSync(join(webDist, 'assets'), { recursive: true });
writeFileSync(join(webDist, 'index.html'), '<div id="root">scout-static-fixture</div>');
writeFileSync(join(webDist, 'assets', 'app-abc.js'), 'console.log("ok");');
writeFileSync(join(fixtureRoot, 'package.json'), `{"name":"${SENTINEL}"}`);
writeFileSync(join(fixtureRoot, 'secret.txt'), OUTSIDE_SECRET);

// Symlinks planted *inside* the dist dir: the escape vector a lexical
// `startsWith(root + sep)` guard cannot see (an HTTP client never sends a
// `..`; the filesystem does the escaping). `webDistLink` is the opposite
// case — a legitimately symlinked dist root, which must keep working.
const webDistLink = join(fixtureRoot, 'dist-via-symlink');
let symlinksSupported = true;
try {
  symlinkSync(join(fixtureRoot, 'secret.txt'), join(webDist, 'link-file.txt'));
  symlinkSync(fixtureRoot, join(webDist, 'linkdir'), 'dir');
  symlinkSync('/etc/passwd', join(webDist, 'link-passwd.txt'));
  symlinkSync(join(fixtureRoot, 'no-such-target'), join(webDist, 'dangling.txt'));
  symlinkSync(join(webDist, 'assets', 'app-abc.js'), join(webDist, 'link-inside.js'));
  symlinkSync(webDist, webDistLink, 'dir');
} catch {
  // Windows without developer mode / elevated shell cannot create symlinks.
  symlinksSupported = false;
}

/**
 * True only where `chmod 000` actually denies reads (POSIX, non-root).
 * Windows maps it to the read-only attribute and root ignores it, so the
 * unreadable-index.html case is skipped rather than asserted falsely.
 */
function chmodDeniesRead(): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'scout-chmod-probe-'));
  const file = join(dir, 'probe.txt');
  writeFileSync(file, 'probe');
  try {
    chmodSync(file, 0o000);
    readFileSync(file);
    return false;
  } catch {
    return true;
  } finally {
    chmodSync(file, 0o600);
    rmSync(dir, { recursive: true, force: true });
  }
}
const unreadableIsEnforced = chmodDeniesRead();

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('createApp({ webDist }) static serving', () => {
  test('GET / serves index.html with no-cache', async () => {
    const app = makeApp(webDist);
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toContain('<div id="root">');
  });

  test('GET /assets/app-abc.js is javascript with immutable cache', async () => {
    const app = makeApp(webDist);
    const res = await app.request('/assets/app-abc.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('javascript');
    expect(res.headers.get('cache-control') ?? '').toContain('immutable');
    expect(await res.text()).toContain('console.log');
  });

  test('GET /projects/github.com%2Forg%2Frepo falls back to index.html', async () => {
    const app = makeApp(webDist);
    const res = await app.request('/projects/github.com%2Forg%2Frepo');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">scout-static-fixture</div>');
  });

  test('GET /api/nope stays JSON 404', async () => {
    const app = makeApp(webDist);
    const res = await app.request('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not found' });
  });

  // Deep links whose last segment ends in a static-asset suffix. `ProjectRef.key`
  // is a normalized repo URL, so `/projects/<key>` legitimately ends in `.js`
  // for a huge slice of the JS ecosystem; these are SPA routes, not asset
  // requests, and must reach the router.
  test.each([
    '/projects/github.com%2Fmrdoob%2Fthree.js',
    '/projects/github.com%2Fchartjs%2FChart.js',
    '/projects/%2FUsers%2Fdev%2Fsite.css',
    '/projects/%2FUsers%2Fdev%2Fdata.json',
    '/sessions/session.json',
    '/harnesses/node.js',
  ])('SPA deep link %s falls back to index.html', async (path) => {
    const app = makeApp(webDist);
    const res = await app.request(path);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toContain('<div id="root">scout-static-fixture</div>');
  });

  test('percent-encoded dot segments are collapsed to an in-root path, so they are an SPA route and never the parent package.json', async () => {
    // Bun/WHATWG normalize `/assets/%2e%2e/%2e%2e/package.json` to
    // `/package.json` *before* the handler runs, so this vector never reaches
    // the containment check at all (lessons.md
    // `bun-url-dot-segment-normalization`). What matters is that it cannot
    // leak: it resolves inside the dist root, finds nothing, and gets the SPA
    // fallback. The encoded-slash case below is the real containment
    // assertion — do not delete it.
    const app = makeApp(webDist);
    const res = await app.request('/assets/%2e%2e/%2e%2e/package.json');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<div id="root">scout-static-fixture</div>');
    expect(body).not.toContain(SENTINEL);
  });

  test('encoded-slash traversal is JSON 404 and never reads outside the dist root', async () => {
    const app = makeApp(webDist);
    const res = await app.request('/assets/%2e%2e%2f%2e%2e%2fpackage.json');
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ error: 'not found' });
    expect(body).not.toContain(SENTINEL);
  });

  test('an escaping path is JSON 404 even when its target does not exist', async () => {
    // Rejected before any filesystem call, so an out-of-root path can never be
    // probed for existence through the 404-vs-SPA-fallback difference.
    const app = makeApp(webDist);
    const res = await app.request('/assets/%2e%2e%2f%2e%2e%2fno-such-file.txt');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not found' });
  });
});

describe('createApp without webDist', () => {
  test('GET / is the JSON 404 stub', async () => {
    const app = makeApp();
    const res = await app.request('/');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not found' });
  });
});

// Dispatch item 9 / audit-f8 blocker 2: containment must be decided on the
// *real* (symlink-resolved) path, not a lexical prefix. Every case below is a
// symlink already present inside the served dist — the only way to escape,
// since the HTTP layer cannot inject one.
describe.skipIf(!symlinksSupported)('symlink containment inside the dist root', () => {
  test('a file symlink pointing outside the root is JSON 404, not the target file', async () => {
    const app = makeApp(webDist);
    const res = await app.request('/link-file.txt');
    const body = await res.text();
    expect(body).not.toContain(OUTSIDE_SECRET);
    expect(res.status).toBe(404);
    expect(JSON.parse(body)).toEqual({ error: 'not found' });
  });

  test('a directory symlink does not grant arbitrary reads of the parent tree', async () => {
    const app = makeApp(webDist);
    for (const [path, sentinel] of [
      ['/linkdir/secret.txt', OUTSIDE_SECRET],
      ['/linkdir/package.json', SENTINEL],
    ] as const) {
      const res = await app.request(path);
      const body = await res.text();
      expect(body).not.toContain(sentinel);
      expect(res.status).toBe(404);
      expect(JSON.parse(body)).toEqual({ error: 'not found' });
    }
  });

  test.skipIf(!existsSync('/etc/passwd'))(
    'a symlink to an absolute system path is JSON 404',
    async () => {
      const app = makeApp(webDist);
      const res = await app.request('/link-passwd.txt');
      const body = await res.text();
      expect(body).not.toContain('root:');
      expect(res.status).toBe(404);
      expect(JSON.parse(body)).toEqual({ error: 'not found' });
    },
  );

  test('a dangling symlink is the SPA fallback, never a 500', async () => {
    const app = makeApp(webDist);
    const res = await app.request('/dangling.txt');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">scout-static-fixture</div>');
  });

  test('a symlink whose target stays inside the root is still served', async () => {
    // Guards against "fix" the cheap way, by rejecting every symlink.
    const app = makeApp(webDist);
    const res = await app.request('/link-inside.js');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('console.log');
  });

  test('a webDist that is itself a symlink serves normally', async () => {
    const app = makeApp(webDistLink);
    const index = await app.request('/');
    expect(index.status).toBe(200);
    expect(await index.text()).toContain('<div id="root">scout-static-fixture</div>');

    const asset = await app.request('/assets/app-abc.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control') ?? '').toContain('immutable');
    expect(await asset.text()).toContain('console.log');
  });

  test('a symlink escape through a symlinked webDist root is still JSON 404', async () => {
    const app = makeApp(webDistLink);
    const res = await app.request('/link-file.txt');
    const body = await res.text();
    expect(body).not.toContain(OUTSIDE_SECRET);
    expect(res.status).toBe(404);
  });
});

// audit-f8 quality 3: `vite build` empties dist before rewriting it, so a
// running `scout serve` can be asked for a page while index.html does not
// exist. That must not become a 500 carrying absolute paths.
describe('createApp({ webDist }) when the build is missing at request time', () => {
  test('a missing index.html is a small clean 503 that leaks no filesystem paths', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'scout-web-dist-empty-'));
    try {
      const app = makeApp(empty);
      for (const path of ['/', '/sessions/x']) {
        const res = await app.request(path);
        expect(res.status).toBe(503);
        const body = await res.text();
        expect(JSON.parse(body)).toEqual({ error: 'web build unavailable' });
        expect(body.length).toBeLessThan(200);
        expect(body).not.toContain(empty);
        expect(body).not.toContain('ENOENT');
        expect(body).not.toContain(process.cwd());
      }
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test('a webDist directory that no longer exists is the same clean 503', async () => {
    const gone = mkdtempSync(join(tmpdir(), 'scout-web-dist-gone-'));
    writeFileSync(join(gone, 'index.html'), '<div id="root">temporary</div>');
    const app = makeApp(gone);
    expect((await app.request('/')).status).toBe(200);

    rmSync(gone, { recursive: true, force: true });
    const res = await app.request('/');
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ error: 'web build unavailable' });
    expect(body).not.toContain(gone);
  });

  test.skipIf(!unreadableIsEnforced)(
    'an unreadable index.html is a clean 503, not a 500 with a stack trace',
    async () => {
      const locked = mkdtempSync(join(tmpdir(), 'scout-web-dist-locked-'));
      const index = join(locked, 'index.html');
      writeFileSync(index, '<div id="root">locked</div>');
      chmodSync(index, 0o000);
      try {
        const app = makeApp(locked);
        const res = await app.request('/');
        expect(res.status).toBe(503);
        const body = await res.text();
        expect(JSON.parse(body)).toEqual({ error: 'web build unavailable' });
        expect(body).not.toContain(locked);
      } finally {
        chmodSync(index, 0o600);
        rmSync(locked, { recursive: true, force: true });
      }
    },
  );
});
