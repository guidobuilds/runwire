import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { mockSessionDetail, mockSessionSummary } from '@/mocks/handlers';
import { useSession, useSessions } from './sessions';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useSessions', () => {
  it('resolves with the mocked paged session list', async () => {
    const { result } = renderHook(() => useSessions(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items).toEqual([mockSessionSummary]);
    expect(result.current.data?.total).toBe(1);
  });
});

describe('useSession', () => {
  it('resolves with the mocked session detail', async () => {
    const { result } = renderHook(() => useSession('sess-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockSessionDetail);
  });
});
