import { describe, expect, test } from 'vitest';
import { ApiError, createApiClient, type FetchImpl, unwrap } from './client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api client', () => {
  test('GET /api/projects is requested and the parsed array is returned', async () => {
    const recorded: Array<{ url: string; method: string }> = [];
    const projects = [{ key: 'github.com/org/repo', sessionCount: 2 }];
    const fetchImpl: FetchImpl = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      recorded.push({ url, method: init?.method ?? 'GET' });
      return jsonResponse(projects);
    };

    const client = createApiClient(fetchImpl);
    const data = await unwrap(await client.api.projects.$get({ query: {} }));

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.method).toBe('GET');
    expect(recorded[0]?.url).toContain('/api/projects');
    expect(data).toEqual(projects);
  });

  test('unwrap throws ApiError with status 404 and the body error message', async () => {
    const res = jsonResponse({ error: 'session not found' }, 404);
    await expect(unwrap(res)).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'session not found',
    });
    await expect(unwrap(jsonResponse({ error: 'session not found' }, 404))).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});
