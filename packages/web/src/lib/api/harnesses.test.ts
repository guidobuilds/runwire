import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockHarnessOptions } from '@/mocks/handlers';
import { fetchHarnesses } from './harnesses';

describe('fetchHarnesses', () => {
  it('parses the harness list from GET /api/harnesses', async () => {
    const result = await fetchHarnesses();
    expect(result).toEqual(mockHarnessOptions);
  });

  it('requests exactly /api/harnesses with no query string', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockHarnessOptions), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetch);

    await fetchHarnesses();
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/harnesses');
  });

  afterEach(() => vi.unstubAllGlobals());
});
