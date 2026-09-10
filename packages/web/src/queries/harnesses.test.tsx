import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { mockHarnessOptions } from '@/mocks/handlers';
import { harnessesQueryOptions, useHarnesses } from './harnesses';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {children}
    </QueryClientProvider>
  );
}

describe('useHarnesses', () => {
  it('resolves with the mocked harness options from GET /api/harnesses', async () => {
    const { result } = renderHook(() => useHarnesses(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockHarnessOptions);
  });

  it('never goes stale (staleTime Infinity)', () => {
    expect(harnessesQueryOptions().staleTime).toBe(Infinity);
  });
});
