import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './client';
import {
  fetchSessionProfileMergedEvents,
  fetchSessionProfileSignals,
  fetchSessionProfileSpawns,
  fetchSessionProfileTimeline,
} from './session-profile';

const signalsResponse = {
  sessionId: 'root',
  scope: 'tree',
  compactions: { auto: 2, manual: 1, unknown: 0 },
  modelChanges: 1,
  toolCalls: { total: 5, mcp: 2 },
  mcpServers: ['plugin_engram_engram'],
  skillCalls: 1,
  skillNames: ['skill-doctor'],
};

const timelineResponse = {
  sessionId: 'root',
  scope: 'tree',
  field: 'output',
  series: [
    {
      model: 'claude-sonnet-5',
      totals: {
        uncachedInput: 100,
        cachedInput: 0,
        cacheWrite: 0,
        output: 50,
        reasoningOutput: null,
      },
      callsWithField: {
        uncachedInput: 1,
        cachedInput: 1,
        cacheWrite: 1,
        output: 1,
        reasoningOutput: 0,
      },
      callCount: 1,
    },
  ],
  points: [
    {
      at: '2026-09-01T10:00:00.000Z',
      delta: [50],
      cumulative: [50],
      totalDelta: 50,
      totalCumulative: 50,
    },
  ],
  spawns: [{ at: '2026-09-01T10:05:00.000Z', parentId: 'root', childId: 'child' }],
  excludedNullAtCount: 2,
  timeDomain: { start: '2026-09-01T10:00:00.000Z', end: '2026-09-01T10:05:00.000Z' },
};

const mergedEventsResponse = {
  sessionId: 'root',
  scope: 'tree',
  filter: 'signals',
  items: [
    {
      streamId: 'root',
      sessionId: 'root',
      seq: 1,
      at: '2026-09-01T10:00:00.000Z',
      error: null,
      kind: 'compaction',
      trigger: 'auto',
    },
  ],
  total: 1,
  limit: 50,
  offset: 0,
  excludedNullAtCount: 3,
};

afterEach(() => vi.unstubAllGlobals());

describe('session profile API', () => {
  it('encodes a slash and literal percent in the opaque id once', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await fetchSessionProfileSpawns('root/a%25', { scope: 'tree' });
    expect(fetch).toHaveBeenCalledWith(
      '/api/session-profiles/root%2Fa%2525?view=spawns&scope=tree',
      expect.any(Object),
    );
  });

  it('passes cancellation to apiFetch and returns API errors', async () => {
    const controller = new AbortController();
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: 'session not found' }), { status: 404 }),
      );
    vi.stubGlobal('fetch', fetch);
    await expect(
      fetchSessionProfileSpawns('missing', {}, controller.signal),
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ signal: controller.signal });
  });

  it('fetches signals with the exact query-string convention', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(signalsResponse), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const result = await fetchSessionProfileSignals('root', { scope: 'tree' });
    expect(fetch).toHaveBeenCalledWith(
      '/api/session-profiles/root?view=signals&scope=tree',
      expect.any(Object),
    );
    expect(result).toMatchObject({ view: 'signals', sessionId: 'root', modelChanges: 1 });
  });

  it('rejects a malformed signals response', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ...signalsResponse, compactions: null }), { status: 200 }),
        ),
    );
    await expect(fetchSessionProfileSignals('root')).rejects.toBeInstanceOf(TypeError);
  });

  it('fetches the timeline with the exact query-string convention', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(timelineResponse), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const result = await fetchSessionProfileTimeline('root', { scope: 'tree', field: 'output' });
    expect(fetch).toHaveBeenCalledWith(
      '/api/session-profiles/root?view=timeline&scope=tree&field=output',
      expect.any(Object),
    );
    expect(result.points[0]).toMatchObject({ at: '2026-09-01T10:00:00.000Z', totalDelta: 50 });
    expect(result.spawns[0]).toMatchObject({ childId: 'child' });
  });

  it('rejects a malformed timeline response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ...timelineResponse, points: [{ at: 'x' }] }), {
          status: 200,
        }),
      ),
    );
    await expect(fetchSessionProfileTimeline('root')).rejects.toBeInstanceOf(TypeError);
  });

  it('fetches merged events with the exact query-string convention', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(mergedEventsResponse), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const result = await fetchSessionProfileMergedEvents('root', {
      scope: 'tree',
      filter: 'signals',
      limit: 50,
      offset: 0,
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/session-profiles/root?view=merged&scope=tree&filter=signals&limit=50&offset=0',
      expect.any(Object),
    );
    expect(result.items[0]).toMatchObject({ kind: 'compaction', trigger: 'auto' });
    expect(result.excludedNullAtCount).toBe(3);
  });

  it('rejects a malformed merged events response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ...mergedEventsResponse, filter: 'nope' }), {
          status: 200,
        }),
      ),
    );
    await expect(fetchSessionProfileMergedEvents('root')).rejects.toBeInstanceOf(TypeError);
  });

  it('encodes the opaque id once and surfaces API errors', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: 'session not found' }), { status: 404 }),
      );
    vi.stubGlobal('fetch', fetch);
    await expect(fetchSessionProfileSignals('root/a%25')).rejects.toBeInstanceOf(ApiError);
    expect(fetch).toHaveBeenCalledWith(
      '/api/session-profiles/root%2Fa%2525?view=signals',
      expect.any(Object),
    );
  });
});
