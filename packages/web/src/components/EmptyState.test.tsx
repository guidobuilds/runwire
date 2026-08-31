import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { StatusResponse } from '../api/types';

/*
 * One test deliberately leaves `['status']` unseeded to exercise the loading
 * branch, which makes the real query run. Without a stub it reaches happy-dom's
 * origin and prints an ECONNREFUSED unhandled rejection, so `fetch` is replaced
 * with a request that never settles — the query then stays pending for the
 * whole test. The stub must be installed before `api/client.ts` is imported,
 * because that module captures `fetch` at evaluation time (lessons.md
 * `web-api-module-fetch-binding`), hence the dynamic imports below: a top-level
 * `import { queryKeys } from '../api/queries'` would be hoisted above the stub
 * and pull in the real `fetch`-bound client.
 */
vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));

const { queryKeys } = await import('../api/queries');
const { EmptyState, useHasData } = await import('./EmptyState');

type Report = NonNullable<StatusResponse['lastReport']>;

function report(parsed: number): Report {
  return {
    startedAt: '2026-08-31T12:00:00.000Z',
    durationMs: 42,
    perAdapter: {
      'claude-code': { discovered: parsed, parsed, reused: 0, failed: 0, durationMs: 40 },
    },
    diagnostics: [],
  };
}

const NOT_INSTALLED: StatusResponse = {
  lastReport: report(0),
  adapters: [
    {
      id: 'claude-code',
      displayName: 'Claude Code',
      capabilities: [],
      probe: { installed: false, roots: [], notes: ['no ~/.claude found'] },
    },
  ],
};

function mount(ui: ReactNode, status: StatusResponse | undefined) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  if (status) client.setQueryData(queryKeys.status, status);
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/** Renders the hook's answer as on-screen text so a test can assert on it. */
function HasDataProbe() {
  return <p>hasData: {String(useHasData())}</p>;
}

describe('EmptyState', () => {
  afterEach(() => {
    cleanup();
  });

  test('lists each adapter probe and the scout doctor hint', () => {
    const view = mount(<EmptyState />, NOT_INSTALLED);
    const text = view.baseElement.textContent ?? '';

    expect(screen.getByText('Claude Code')).not.toBeNull();
    expect(screen.getByText('not installed')).not.toBeNull();
    expect(screen.getByText('no ~/.claude found')).not.toBeNull();
    expect(text).toContain('Roots: none');
    expect(text).toContain('Run scout doctor for details');
  });

  test('an installed adapter with roots is reported as installed', () => {
    const view = mount(<EmptyState />, {
      lastReport: report(0),
      adapters: [
        {
          id: 'claude-code',
          displayName: 'Claude Code',
          capabilities: [],
          probe: { installed: true, roots: ['/home/dev/.claude/projects'], notes: [] },
        },
      ],
    });

    expect(screen.getByText('installed')).not.toBeNull();
    expect(view.baseElement.textContent ?? '').toContain('Roots: /home/dev/.claude/projects');
  });
});

describe('useHasData', () => {
  afterEach(() => {
    cleanup();
  });

  test('false when no scan has completed', () => {
    mount(<HasDataProbe />, { lastReport: null, adapters: [] });
    expect(screen.getByText('hasData: false')).not.toBeNull();
  });

  test('false when every adapter parsed zero sources', () => {
    mount(<HasDataProbe />, NOT_INSTALLED);
    expect(screen.getByText('hasData: false')).not.toBeNull();
  });

  test('true once any adapter parsed something', () => {
    mount(<HasDataProbe />, { lastReport: report(3), adapters: [] });
    expect(screen.getByText('hasData: true')).not.toBeNull();
  });

  test('true while status is still loading, so the doctor view never flashes', () => {
    mount(<HasDataProbe />, undefined);
    expect(screen.getByText('hasData: true')).not.toBeNull();
  });
});
