import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/*
 * `src/api/client.ts` creates its module-level `api` with `fetch` captured at
 * module-evaluation time, so a fake installed after the import is never used
 * (lessons.md `web-api-module-fetch-binding`). The stub therefore goes in
 * first and the component is pulled in with a dynamic import afterwards.
 */

type Recorded = { url: string; method: string };

const requests: Recorded[] = [];

let statusBody: unknown = { lastReport: null, adapters: [] };
let projectsBody: unknown = [];
let rescanStatus = 200;
/** When set, the rescan response waits for `openRescanGate()`. */
let rescanGate: Promise<void> | undefined;
let openRescanGate: (() => void) | undefined;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  requests.push({ url, method: init?.method ?? 'GET' });

  if (url.includes('/api/rescan')) {
    if (rescanGate) await rescanGate;
    if (rescanStatus !== 200) return json({ error: 'scan crashed' }, rescanStatus);
    return json({
      startedAt: new Date().toISOString(),
      durationMs: 5,
      perAdapter: {},
      diagnostics: [],
    });
  }
  // `projectsBody` stays the bare aggregate array each test cares about; the
  // route's envelope (added so the Projects grid can disclose what the
  // automated filter removed) is wrapped on here.
  if (url.includes('/api/projects'))
    return json({ projects: projectsBody, hiddenProjects: 0, hiddenAutomated: 0 });
  if (url.includes('/api/status')) return json(statusBody);
  return json({ error: 'unexpected request' }, 404);
});

const { StatusStrip } = await import('./StatusStrip');

function projectAggregate(key: string, sessionCount: number) {
  return {
    project: { key, name: key, identity: 'cwd' },
    sessionCount,
    harnesses: ['claude-code'],
    aggregateUsage: {},
  };
}

function mount(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

describe('StatusStrip', () => {
  beforeEach(() => {
    requests.length = 0;
    statusBody = { lastReport: null, adapters: [] };
    projectsBody = [];
    rescanStatus = 200;
    rescanGate = undefined;
    openRescanGate = undefined;
  });

  afterEach(() => {
    cleanup();
  });

  test('shows the relative last-scan time and the summed root session count', async () => {
    statusBody = {
      lastReport: {
        startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        durationMs: 100,
        perAdapter: {
          'claude-code': { discovered: 4, parsed: 4, reused: 0, failed: 0, durationMs: 9 },
        },
        diagnostics: [],
      },
      adapters: [],
    };
    projectsBody = [projectAggregate('a', 2), projectAggregate('b', 5)];

    mount(<StatusStrip />);

    expect(await screen.findByText('Last scan 2 hours ago')).not.toBeNull();
    expect(await screen.findByText('7 root sessions')).not.toBeNull();
  });

  test('with no completed scan the strip says never', async () => {
    projectsBody = [projectAggregate('a', 1)];
    mount(<StatusStrip />);
    expect(await screen.findByText('Last scan never')).not.toBeNull();
  });

  test('Rescan posts to /api/rescan and the refreshed project counts appear', async () => {
    projectsBody = [projectAggregate('a', 2)];
    mount(<StatusStrip />);

    expect(await screen.findByText('2 root sessions')).not.toBeNull();

    // The second scan finds more sessions; the strip must show the new number,
    // which only happens if the rescan actually invalidated the projects query.
    projectsBody = [projectAggregate('a', 2), projectAggregate('c', 7)];
    fireEvent.click(screen.getByRole('button', { name: 'Rescan' }));

    expect(await screen.findByText('9 root sessions')).not.toBeNull();
    expect(
      requests.filter((r) => r.url.includes('/api/rescan') && r.method === 'POST'),
    ).toHaveLength(1);
    expect(requests.filter((r) => r.url.includes('/api/projects'))).toHaveLength(2);
  });

  test('the button reads Scanning… and is disabled while the rescan is in flight', async () => {
    projectsBody = [projectAggregate('a', 1)];
    rescanGate = new Promise<void>((resolve) => {
      openRescanGate = resolve;
    });

    mount(<StatusStrip />);
    expect(await screen.findByText('1 root sessions')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Rescan' }));

    const pending = await screen.findByRole('button', { name: 'Scanning…' });
    expect((pending as HTMLButtonElement).disabled).toBe(true);

    openRescanGate?.();
    await waitFor(() => {
      expect(screen.queryByText('Scanning…')).toBeNull();
    });
    expect(screen.getByRole('button', { name: 'Rescan' })).not.toBeNull();
  });

  test('a failing rescan reports the error in place and leaves the button usable', async () => {
    projectsBody = [projectAggregate('a', 1)];
    rescanStatus = 500;

    mount(<StatusStrip />);
    expect(await screen.findByText('1 root sessions')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Rescan' }));

    expect(await screen.findByText('Rescan failed: scan crashed')).not.toBeNull();
    expect((screen.getByRole('button', { name: 'Rescan' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
