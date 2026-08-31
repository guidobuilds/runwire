import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Route as compareRoute, useCompareIds } from '../routes/compare';

/*
 * StatusStrip lives inside the shell and issues real queries, so `fetch` is
 * stubbed with a request that never settles — the strip stays in its loading
 * shape and nothing leaves the process. Installed before the dynamic imports
 * because `api/client.ts` captures `fetch` at module-evaluation time
 * (lessons.md `web-api-module-fetch-binding`).
 */
vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));

const prefs = await import('../state/prefs');
const { AppShell } = await import('./AppShell');

/** What a component under `/compare` saw on its last render. */
let compareReceived: string[] | null = null;

function CompareProbe() {
  compareReceived = useCompareIds();
  return <p>compare view</p>;
}

/**
 * A memory router shaped like the real one but with stub leaf components. The
 * generated `routeTree.gen.ts` is deliberately not used: it would pull in every
 * sibling feature's route module and make this test fail for their reasons.
 */
function mount(initialPath = '/projects') {
  const rootRoute = createRootRoute({ component: AppShell });
  const routeTree = rootRoute.addChildren([
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/projects',
      component: () => <p>projects view</p>,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/harnesses',
      component: () => <p>harnesses view</p>,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/compare',
      // The REAL validator off the real route object, and a probe that reads
      // the search the way a component does. A copy of the parse, or a leaf
      // that reads nothing, cannot see whether the tray survives the trip.
      validateSearch: compareRoute.options.validateSearch,
      component: CompareProbe,
    }),
  ]);

  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });

  const view = render(
    <QueryClientProvider client={client}>
      {/* The ad-hoc tree is not the registered router type; only its shape matters here. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return { router, view };
}

describe('AppShell', () => {
  afterEach(() => {
    cleanup();
    compareReceived = null;
    prefs.clearTray();
    prefs.setInclusive(true);
    prefs.setShowTitles(true);
  });

  test('renders the brand, both nav destinations and both display toggles', async () => {
    mount();
    expect(await screen.findByText('projects view')).not.toBeNull();

    expect(screen.getByText('Scout')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Projects' })).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Harnesses' })).not.toBeNull();
    expect(screen.getByRole('switch', { name: 'Inclusive' })).not.toBeNull();
    expect(screen.getByRole('switch', { name: 'Titles' })).not.toBeNull();
    // The status strip is part of the shell, not of any single view.
    expect(screen.getByRole('button', { name: 'Rescan' })).not.toBeNull();
  });

  test('the Compare badge shows the tray size', async () => {
    prefs.setTray(['claude-code:aaa', 'claude-code:bbb']);
    mount();
    expect(await screen.findByText('projects view')).not.toBeNull();

    const compare = screen.getByRole('button', { name: /Compare sessions/ });
    expect(compare.textContent).toBe('Compare sessions2');
  });

  test('Compare sessions delivers the tray ids, in tray order, to the compare route', async () => {
    prefs.setTray(['claude-code:bbb', 'claude-code:aaa']);
    const { router } = mount();
    expect(await screen.findByText('projects view')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Compare sessions/ }));

    expect(await screen.findByText('compare view')).not.toBeNull();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/compare');
    });

    // What the component reads, which is the whole point of the button. The
    // earlier version of this test asserted `location.search` — a field
    // `buildLocation` fills in and no component ever reads — and stayed green
    // through a defect that delivered an empty selection
    // (verification-f4-f6.md FINDING F4-1).
    await waitFor(() => {
      expect(compareReceived).toEqual(['claude-code:bbb', 'claude-code:aaa']);
    });

    // Order is the compare column order (design.md §4) and must survive the trip
    // through the URL, which is design.md §8's `ids=a,b` and not a JSON list.
    expect(decodeURIComponent(router.state.location.searchStr)).toBe(
      '?ids=claude-code:bbb,claude-code:aaa',
    );
  });

  test('an empty tray still opens /compare, with no selection', async () => {
    const { router } = mount();
    expect(await screen.findByText('projects view')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Compare sessions/ }));

    expect(await screen.findByText('compare view')).not.toBeNull();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/compare');
    });
    expect(router.state.location.searchStr).toBe('');
    expect(compareReceived).toEqual([]);
  });

  test('the Inclusive toggle writes through to the prefs store', async () => {
    mount();
    expect(await screen.findByText('projects view')).not.toBeNull();

    const inclusive = screen.getByRole('switch', { name: 'Inclusive' });
    expect(inclusive.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(inclusive);

    expect(screen.getByRole('switch', { name: 'Inclusive' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(JSON.parse(localStorage.getItem(prefs.PREFS_STORAGE_KEY) ?? '{}')).toMatchObject({
      inclusive: false,
    });
  });

  test('the Titles toggle writes through to the prefs store', async () => {
    mount();
    expect(await screen.findByText('projects view')).not.toBeNull();

    fireEvent.click(screen.getByRole('switch', { name: 'Titles' }));

    expect(screen.getByRole('switch', { name: 'Titles' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(JSON.parse(localStorage.getItem(prefs.PREFS_STORAGE_KEY) ?? '{}')).toMatchObject({
      showTitles: false,
    });
  });

  test('the nav link for the current route is marked active', async () => {
    mount('/harnesses');
    expect(await screen.findByText('harnesses view')).not.toBeNull();

    const active = screen.getByRole('link', { name: 'Harnesses' });
    const inactive = screen.getByRole('link', { name: 'Projects' });

    // `data-status` proves the link resolves to the matched route…
    expect(active.getAttribute('data-status')).toBe('active');
    expect(inactive.getAttribute('data-status')).not.toBe('active');
    // …and the active styling is a class, since "which nav item am I on" has no
    // textual representation to assert instead.
    expect(active.getAttribute('class') ?? '').toContain('font-medium');
    expect(inactive.getAttribute('class') ?? '').not.toContain('font-medium');
  });
});
