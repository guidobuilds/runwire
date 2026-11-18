import { describe, expect, test } from 'bun:test';
import { type LanesResponse, openStore } from '@runwire/core';
import { createServer } from './createServer';

async function withServer(run: (base: string) => Promise<void>): Promise<void> {
  const { db } = openStore(':memory:');
  db.run(`INSERT INTO harnesses VALUES ('h', 'Harness', '1', '[]', NULL)`);
  for (const [id, parent] of [
    ['root/encoded', null],
    ['child', 'root/encoded'],
    ['outside', null],
  ]) {
    db.run(
      `INSERT INTO sessions (id, harness_id, parent_id, source_path, title)
       VALUES (?, 'h', ?, ?, 'SECRET_TITLE')`,
      [id ?? null, parent ?? null, `SECRET_PATH:${id}`],
    );
    db.run(
      `INSERT INTO steps (session_id, seq, kind, at, output)
       VALUES (?, 0, 'call', '2026-01-01T00:00:00.000Z', 1)`,
      [id ?? null],
    );
  }
  const server = createServer({ db, host: '127.0.0.1', port: 0 });
  try {
    await run(`http://127.0.0.1:${server.port}/api/sessions/root%2Fencoded/profile/lanes`);
  } finally {
    await server.stop(true);
    db.close();
  }
}

describe('profile lanes endpoint', () => {
  test('serves metadata JSON with default tree, explicit tree and own scope; missing is 404', async () => {
    await withServer(async (url) => {
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
      const tree = (await response.json()) as LanesResponse & { view: string };
      expect(tree.view).toBe('lanes');
      expect(tree.sessionId).toBe('root/encoded');
      expect(tree.scope).toBe('tree');
      expect(tree.agents.map((a) => a.id)).toEqual(['root/encoded', 'child']);
      expect(tree.callCount).toBe(2);
      expect(JSON.stringify(tree)).not.toContain('SECRET');
      expect(await (await fetch(`${url}?scope=tree`)).json()).toEqual(tree);
      const ownResponse = await fetch(`${url}?scope=own`);
      expect(ownResponse.status).toBe(200);
      const own = (await ownResponse.json()) as LanesResponse;
      expect(own.scope).toBe('own');
      expect(own.agents.map((a) => a.id)).toEqual(['root/encoded']);
      expect(own.callCount).toBe(1);
      const missing = await fetch(url.replace('root%2Fencoded', 'missing'));
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: 'session not found' });
    });
  });

  test('resolves model windows through the injected overrides loader at request time', async () => {
    const { db } = openStore(':memory:');
    db.run(`INSERT INTO harnesses VALUES ('h', 'Harness', '1', '[]', NULL)`);
    db.run(
      `INSERT INTO sessions (id, harness_id, source_path, title) VALUES ('s1', 'h', 'p1', 'SECRET_TITLE')`,
    );
    db.run(`INSERT INTO models (id, provider, name) VALUES (1, 'openai', 'gpt-6.1-sol')`);
    db.run(
      `INSERT INTO steps (session_id, seq, kind, at, output, model_id) VALUES ('s1', 0, 'call', '2026-01-01T00:00:00.000Z', 1, 1)`,
    );
    let loads = 0;
    const server = createServer({
      db,
      host: '127.0.0.1',
      port: 0,
      modelOverrides: () => {
        loads++;
        return [{ provider: 'openai', model: 'gpt-6.1-sol', contextWindow: 777_000 }];
      },
    });
    try {
      const first = (await (
        await fetch(
          'http://127.0.0.1:' + String(server.port) + '/api/sessions/s1/profile/lanes?scope=own',
        )
      ).json()) as LanesResponse;
      const second = (await (
        await fetch(
          'http://127.0.0.1:' + String(server.port) + '/api/sessions/s1/profile/lanes?scope=own',
        )
      ).json()) as LanesResponse;
      expect(loads).toBe(2);
      expect(first.models).toEqual([{ name: 'gpt-6.1-sol', contextWindow: 777_000, tier: 'high' }]);
      expect(second.models).toEqual(first.models);
    } finally {
      await server.stop(true);
      db.close();
    }
  });

  test('strictly rejects invalid, duplicate and unsupported query params without changing data', async () => {
    await withServer(async (url) => {
      const baseline = await fetch(url);
      expect(baseline.status).toBe(200);
      const before = await baseline.json();
      for (const [query, parameter] of [
        ['scope=', 'scope'],
        ['scope=bad', 'scope'],
        ['scope=own&scope=tree', 'scope'],
        ['limit=1', 'limit'],
        ['offset=0', 'offset'],
        ['view=lanes', 'view'],
        ['field=output', 'field'],
        ['q=hello', 'q'],
      ]) {
        const response = await fetch(`${url}?${query}`);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'invalid query parameter', parameter });
      }
      expect(await (await fetch(url)).json()).toEqual(before);
      for (const view of ['models', 'context']) {
        const response = await fetch(`${url.replace('/lanes', `/${view}`)}?scope=own`);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: 'invalid query parameter',
          parameter: 'scope',
        });
      }
      for (const view of ['spawns', 'signals', 'timeline', 'events']) {
        const response = await fetch(`${url.replace('/lanes', `/${view}`)}?scope=own`);
        expect(response.status).toBe(200);
      }
    });
  });

  test('preserves profile method and malformed-id errors', async () => {
    await withServer(async (url) => {
      expect((await fetch(url)).status).toBe(200);
      const response = await fetch(url, { method: 'POST' });
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('GET');
      expect(await response.json()).toEqual({ error: 'method not allowed' });
      const invalid = await fetch(url.replace('root%2Fencoded', '%ZZ'));
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ error: 'invalid id' });
    });
  });
});
