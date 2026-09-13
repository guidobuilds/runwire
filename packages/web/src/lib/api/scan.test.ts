import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockImportReport } from '@/mocks/handlers';
import { runScan } from './scan';

describe('runScan', () => {
  it('parses the ImportReport from POST /api/scan', async () => {
    const result = await runScan();
    expect(result).toEqual(mockImportReport);
  });

  it('issues exactly POST /api/scan with the CSRF header', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockImportReport), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetch);

    await runScan();
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/scan');
    expect(fetch.mock.calls[0]?.[1]).toEqual({
      method: 'POST',
      headers: { 'X-Scout-Scan': '1' },
    });
  });

  afterEach(() => vi.unstubAllGlobals());
});
