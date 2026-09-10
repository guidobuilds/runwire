import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mockChildSummary,
  mockSessionDetail,
  mockSessionSummary,
  mockSessionsStats,
} from '@/mocks/handlers';
import { fetchSession, fetchSessions, fetchSessionsStats } from './sessions';

describe('fetchSessions', () => {
  it('parses the paged session list from GET /sessions', async () => {
    const result = await fetchSessions();
    expect(result.total).toBe(1);
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(0);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(mockSessionSummary);
  });
});

describe('fetchSessionsStats', () => {
  it('parses the full-filtered-set aggregates from GET /api/sessions/stats', async () => {
    const result = await fetchSessionsStats();
    expect(result).toEqual(mockSessionsStats);
  });
});

describe('fetchSession', () => {
  it('unwraps the { session } envelope from GET /sessions/:id', async () => {
    const result = await fetchSession('sess-1');
    expect(result.id).toBe(mockSessionDetail.id);
    expect(result.parent).toBeNull();
    expect(result.children).toEqual([mockChildSummary]);
  });

  it('throws ApiError with the 404 body on an unknown id', async () => {
    await expect(fetchSession('does-not-exist')).rejects.toMatchObject({
      status: 404,
      error: 'session not found',
    });
  });
});

describe('session API URLs are /api-prefixed', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('requests GET /api/sessions and GET /api/sessions/{id} with the id encoded exactly once', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [], total: 0, limit: 50, offset: 0 }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetch);

    await fetchSessions({ limit: 10 });
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/sessions?limit=10');

    fetch.mockResolvedValue(
      new Response(JSON.stringify({ session: { id: 'x' } }), { status: 200 }),
    );
    await fetchSession('a/b%25');
    expect(fetch.mock.calls[1]?.[0]).toBe('/api/sessions/a%2Fb%2525');
  });

  it('serializes q/harness/durationMin/costOnly/sort and omits undefined fields', async () => {
    // A fresh Response per call: a Response body can only be read once.
    const fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ items: [], total: 0, limit: 50, offset: 0 }), {
          status: 200,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);

    await fetchSessions({
      durationMin: 30,
      costOnly: true,
      sort: '-duration',
      harness: 'a,b',
      q: 'refactor',
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      '/api/sessions?harness=a%2Cb&q=refactor&durationMin=30&costOnly=true&sort=-duration',
    );

    // `costOnly: false` is a real filter value, not "unset" — it must be sent.
    await fetchSessions({ costOnly: false });
    expect(fetch.mock.calls[1]?.[0]).toBe('/api/sessions?costOnly=false');

    // Omitted fields contribute no key at all (strict-400 contract).
    await fetchSessions();
    expect(fetch.mock.calls[2]?.[0]).toBe('/api/sessions');
  });

  it('requests GET /api/sessions/stats with filters only (no limit/offset/sort)', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(mockSessionsStats), { status: 200 })),
      );
    vi.stubGlobal('fetch', fetch);

    // The stats query builder never emits pagination/sort; this pins the URL
    // shape the endpoint's strict validator expects.
    await fetchSessionsStats({
      durationMin: 30,
      costOnly: true,
      harness: 'a,b',
      q: 'refactor',
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      '/api/sessions/stats?harness=a%2Cb&q=refactor&durationMin=30&costOnly=true',
    );

    await fetchSessionsStats();
    expect(fetch.mock.calls[1]?.[0]).toBe('/api/sessions/stats');
  });
});
