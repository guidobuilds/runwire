import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './client';
import {
  fetchSessionProfileContext,
  fetchSessionProfileMergedEvents,
  fetchSessionProfileModels,
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
  sort: 'time',
  dir: 'asc',
  items: [
    {
      streamId: 'root',
      sessionId: 'root',
      seq: 1,
      at: '2026-09-01T10:00:00.000Z',
      error: null,
      kind: 'compaction',
      trigger: 'auto',
      action: 'compaction',
      subject: 'auto',
    },
    {
      streamId: 'root',
      sessionId: 'root',
      seq: 2,
      at: '2026-09-01T10:01:00.000Z',
      error: null,
      kind: 'tool',
      category: 'mcp',
      toolName: 'mcp__engram__mem_save',
      mcpServer: 'engram',
      mcpTool: 'mem_save',
      model: 'claude-sonnet-5',
      action: 'mcp',
      subject: 'mcp__engram__mem_save',
    },
    {
      streamId: 'root',
      sessionId: 'root',
      seq: 3,
      at: '2026-09-01T10:02:00.000Z',
      error: null,
      kind: 'tool',
      category: 'exec',
      toolName: 'bash',
      action: 'exec',
      subject: 'bash',
      model: null,
    },
  ],
  total: 3,
  limit: 50,
  offset: 0,
  excludedNullAtCount: 3,
};

const modelsResponse = {
  sessionId: 'root',
  session: {
    outputTokens: 700,
    models: [
      { model: 'claude-sonnet-5', outputTokens: 700, share: 1 },
      { model: 'claude-haiku-4', outputTokens: 0, share: 0 },
    ],
  },
  descendants: {
    outputTokens: 300,
    models: [{ model: 'claude-opus-4', outputTokens: 300, share: 1 }],
  },
};

afterEach(() => vi.unstubAllGlobals());

describe('session profile API', () => {
  it('encodes a slash and literal percent in the opaque id once', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await fetchSessionProfileSpawns('root/a%25', { scope: 'tree' });
    expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/root%2Fa%2525/profile/spawns?scope=tree',
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
      '/api/sessions/root/profile/signals?scope=tree',
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
      '/api/sessions/root/profile/timeline?scope=tree&field=output',
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
      sort: 'time',
      dir: 'asc',
      limit: 50,
      offset: 0,
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/root/profile/events?scope=tree&sort=time&dir=asc&limit=50&offset=0',
      expect.any(Object),
    );
    expect(result.items[0]).toMatchObject({
      kind: 'compaction',
      trigger: 'auto',
      action: 'compaction',
      subject: 'auto',
    });
    expect(result.excludedNullAtCount).toBe(3);
  });

  it('serializes kind/action filters as CSV, plus status/model/q', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(mergedEventsResponse), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await fetchSessionProfileMergedEvents('root', {
      scope: 'tree',
      kind: ['tool', 'call'],
      action: ['read'],
      status: 'error',
      model: 'claude-sonnet-5',
      q: 'ne edle',
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/root/profile/events?scope=tree&kind=tool%2Ccall&action=read&status=error&model=claude-sonnet-5&q=ne+edle',
      expect.any(Object),
    );
  });

  it('passes tool model through as a string and defaults an absent model to null', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(mergedEventsResponse), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const result = await fetchSessionProfileMergedEvents('root', { scope: 'tree' });
    expect(result.items[1]).toMatchObject({ kind: 'tool', model: 'claude-sonnet-5' });
    expect(result.items[2]).toMatchObject({ kind: 'tool', model: null });
  });

  it('retains a complete stored MCP pair on a tool event', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(mergedEventsResponse), { status: 200 })),
    );
    const result = await fetchSessionProfileMergedEvents('root', { scope: 'tree' });
    expect(result.items[1]).toMatchObject({
      kind: 'tool',
      mcpServer: 'engram',
      mcpTool: 'mem_save',
    });
  });

  it('degrades missing, partial, empty or malformed MCP metadata to nulls', async () => {
    const tool = mergedEventsResponse.items[1];
    const variants: Record<string, unknown> = {
      missing: { ...tool, mcpServer: undefined, mcpTool: undefined },
      partialServer: { ...tool, mcpServer: 'server-only', mcpTool: null },
      partialTool: { ...tool, mcpServer: null, mcpTool: 'tool-only' },
      empty: { ...tool, mcpServer: '', mcpTool: '' },
      malformed: { ...tool, mcpServer: 7, mcpTool: true },
    };
    for (const [name, item] of Object.entries(variants)) {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ ...mergedEventsResponse, items: [item] }), {
            status: 200,
          }),
        ),
      );
      const result = await fetchSessionProfileMergedEvents('root', { scope: 'tree' });
      expect(result.items[0], name).toMatchObject({
        kind: 'tool',
        mcpServer: null,
        mcpTool: null,
      });
    }
  });

  it('defaults the MCP pair to nulls on a non-MCP tool event', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(mergedEventsResponse), { status: 200 })),
    );
    const result = await fetchSessionProfileMergedEvents('root', { scope: 'tree' });
    expect(result.items[2]).toMatchObject({
      kind: 'tool',
      action: 'exec',
      mcpServer: null,
      mcpTool: null,
    });
  });

  it('rejects a malformed merged events response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ...mergedEventsResponse, sort: 'nope' }), {
          status: 200,
        }),
      ),
    );
    await expect(fetchSessionProfileMergedEvents('root')).rejects.toBeInstanceOf(TypeError);
  });

  it('rejects a merged event missing its semantic action/subject', async () => {
    const { action: _action, ...withoutAction } = mergedEventsResponse.items[0];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ...mergedEventsResponse, items: [withoutAction] }), {
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
      '/api/sessions/root%2Fa%2525/profile/signals',
      expect.any(Object),
    );
  });

  it('fetches model usage with no query string and encodes the opaque id once', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(modelsResponse), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await fetchSessionProfileModels('root/a%25');
    expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/root%2Fa%2525/profile/models',
      expect.any(Object),
    );
    expect(fetch.mock.calls[0]?.[0]).not.toContain('?');
  });

  it('normalizes the models response into the view shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(modelsResponse), { status: 200 })),
    );
    const result = await fetchSessionProfileModels('root');
    expect(result).toEqual({
      view: 'models',
      sessionId: 'root',
      session: {
        outputTokens: 700,
        models: [
          { model: 'claude-sonnet-5', outputTokens: 700, share: 1 },
          { model: 'claude-haiku-4', outputTokens: 0, share: 0 },
        ],
      },
      descendants: {
        outputTokens: 300,
        models: [{ model: 'claude-opus-4', outputTokens: 300, share: 1 }],
      },
    });
  });

  it('rejects a models entry missing a numeric share', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...modelsResponse,
            session: {
              outputTokens: 700,
              models: [{ model: 'claude-sonnet-5', outputTokens: 700 }],
            },
          }),
          { status: 200 },
        ),
      ),
    );
    await expect(fetchSessionProfileModels('root')).rejects.toBeInstanceOf(TypeError);
  });

  it('rejects a models response without a string sessionId', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ...modelsResponse, sessionId: 42 }), { status: 200 }),
        ),
    );
    await expect(fetchSessionProfileModels('root')).rejects.toBeInstanceOf(TypeError);
  });

  it('rejects a models group without numeric outputTokens', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ...modelsResponse, descendants: { models: [] } }), {
          status: 200,
        }),
      ),
    );
    await expect(fetchSessionProfileModels('root')).rejects.toBeInstanceOf(TypeError);
  });

  const contextResponse = {
    sessionId: 'root',
    own: {
      observedCalls: 2,
      promptInput: 300,
      avgPromptInput: 150,
      p95PromptInput: 200,
      peakPromptInput: 200,
      cacheReadShare: 0.25,
    },
    tree: {
      observedCalls: 3,
      promptInput: 400,
      avgPromptInput: 400 / 3,
      p95PromptInput: 200,
      peakPromptInput: 200,
      cacheReadShare: 0.1,
    },
    descendants: [
      {
        id: 'root/child',
        parentId: 'root',
        relativeDepth: 1,
        agentType: 'worker',
        startedAt: '2026-09-01T10:05:00.000Z',
        durationMs: 600000,
        modelPrimary: 'claude-sonnet-5',
        costUsd: 0.12,
        metrics: {
          observedCalls: 1,
          promptInput: 100,
          avgPromptInput: 100,
          p95PromptInput: 100,
          peakPromptInput: 100,
          cacheReadShare: null,
        },
      },
    ],
  };

  it('fetches context with no query string and encodes the opaque id once', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(contextResponse), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await fetchSessionProfileContext('root/a%25');
    expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/root%2Fa%2525/profile/context',
      expect.any(Object),
    );
    expect(fetch.mock.calls[0]?.[0]).not.toContain('?');
  });

  it('normalizes the context response into the view shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(contextResponse), { status: 200 })),
    );
    const result = await fetchSessionProfileContext('root');
    expect(result).toEqual({ view: 'context', ...contextResponse });
  });

  it('preserves null metrics and null descendant metadata', async () => {
    const nullMetrics = {
      observedCalls: 0,
      promptInput: null,
      avgPromptInput: null,
      p95PromptInput: null,
      peakPromptInput: null,
      cacheReadShare: null,
    };
    const body = {
      ...contextResponse,
      own: nullMetrics,
      tree: nullMetrics,
      descendants: [
        {
          ...contextResponse.descendants[0],
          agentType: null,
          durationMs: null,
          modelPrimary: null,
          costUsd: null,
          metrics: nullMetrics,
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })),
    );
    const result = await fetchSessionProfileContext('root');
    expect(result.own).toEqual(nullMetrics);
    expect(result.descendants[0]).toMatchObject({
      agentType: null,
      durationMs: null,
      modelPrimary: null,
      costUsd: null,
      metrics: nullMetrics,
    });
  });

  it('rejects a context response with a non-nullable metric', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...contextResponse,
            own: { ...contextResponse.own, peakPromptInput: 'x' },
          }),
          { status: 200 },
        ),
      ),
    );
    await expect(fetchSessionProfileContext('root')).rejects.toBeInstanceOf(TypeError);
  });

  it('rejects a context response whose descendants is not an array', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ...contextResponse, descendants: null }), { status: 200 }),
        ),
    );
    await expect(fetchSessionProfileContext('root')).rejects.toBeInstanceOf(TypeError);
  });

  it('rejects a context descendant with a missing id', async () => {
    const broken = {
      ...contextResponse,
      descendants: [{ ...contextResponse.descendants[0], id: 7 }],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(broken), { status: 200 })),
    );
    await expect(fetchSessionProfileContext('root')).rejects.toBeInstanceOf(TypeError);
  });

  it('surfaces API errors for the context endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'session not found' }), { status: 404 }),
        ),
    );
    await expect(fetchSessionProfileContext('missing')).rejects.toBeInstanceOf(ApiError);
  });
});
