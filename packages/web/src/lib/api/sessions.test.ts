import { describe, expect, it } from 'vitest';
import { mockChildSummary, mockSessionDetail, mockSessionSummary } from '@/mocks/handlers';
import { fetchSession, fetchSessions } from './sessions';

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
