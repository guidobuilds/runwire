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
      path: '/',
      component: () => <p>sessions view</p>,
    }),
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
      path: '/sessions/$id',
      component: () => <p>session detail view</p>,
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

  test('renders the brand, sidebar nav, breadcrumb and both display toggles', async () => {
    mount();
    expect(await screen.findByText('projects view')).not.toBeNull();

    expect(screen.getByText('Scout')).not.toBeNull();
    expect(screen.getByText('LOCAL')).not.toBeNull();
    expect(screen.getByText('Local data only')).not.toBeNull();
    // D42: no saved-views shortcuts anywhere in the sidebar.
    expect(screen.queryByText('Recent failures')).toBeNull();
    expect(screen.queryByText('High token usage')).toBeNull();

    expect(screen.getByRole('link', { name: 'Sessions' })).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Projects' })).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Harnesses' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Settings' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Help' })).not.toBeNull();

    // Topbar breadcrumb reflects the current route.
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toBe('Projects');

    // The Inclusive/Exclusive segmented control (shadcn toggle-group), and Titles switch.
    expect(screen.getByRole('button', { name: 'Inclusive', pressed: true })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Exclusive', pressed: false })).not.toBeNull();
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

  test('the Inclusive/Exclusive segmented control writes through to the prefs store', async () => {
    mount();
    expect(await screen.findByText('projects view')).not.toBeNull();

    expect(screen.getByRole('button', { name: 'Inclusive', pressed: true })).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Exclusive' }));

    expect(screen.getByRole('button', { name: 'Exclusive', pressed: true })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Inclusive', pressed: false })).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(prefs.PREFS_STORAGE_KEY) ?? '{}')).toMatchObject({
      inclusive: false,
    });
  });

  test('clicking the already-pressed segment leaves exactly one option selected', async () => {
    mount();
    expect(await screen.findByText('projects view')).not.toBeNull();

    // A single-select segmented control must never collapse to "neither" —
    // guards against Base UI's own toggle-group semantics allowing the
    // active item to un-press itself down to an empty selection.
    fireEvent.click(screen.getByRole('button', { name: 'Inclusive' }));

    expect(screen.getByRole('button', { name: 'Inclusive', pressed: true })).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(prefs.PREFS_STORAGE_KEY) ?? '{}')).toMatchObject({
      inclusive: true,
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
    const sessions = screen.getByRole('link', { name: 'Sessions' });

    // `data-status` proves the link resolves to the matched route…
    expect(active.getAttribute('data-status')).toBe('active');
    expect(inactive.getAttribute('data-status')).not.toBe('active');
    // "Sessions" -> "/" must not be active-by-prefix on every other route.
    expect(sessions.getAttribute('data-status')).not.toBe('active');
    // …and the active styling is a class, since "which nav item am I on" has no
    // textual representation to assert instead.
    expect(active.getAttribute('class') ?? '').toContain('font-medium');
    expect(inactive.getAttribute('class') ?? '').not.toContain('font-medium');

    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toBe('Harnesses');
  });

  test('the Compare tray badge reacts live to prefs.compareTray changes, without remounting', async () => {
    mount();
    expect(await screen.findByText('projects view')).not.toBeNull();

    expect(screen.getByRole('button', { name: /Compare sessions/ }).textContent).toBe(
      'Compare sessions0',
    );

    prefs.setTray(['claude-code:aaa']);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Compare sessions/ }).textContent).toBe(
        'Compare sessions1',
      );
    });

    prefs.setTray(['claude-code:aaa', 'claude-code:bbb', 'claude-code:ccc']);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Compare sessions/ }).textContent).toBe(
        'Compare sessions3',
      );
    });
  });

  test('Inclusive and Titles persist in the prefs store across a simulated route change', async () => {
    const { router } = mount('/projects');
    expect(await screen.findByText('projects view')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Exclusive' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Titles' }));

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(prefs.PREFS_STORAGE_KEY) ?? '{}')).toMatchObject({
        inclusive: false,
        showTitles: false,
      });
    });

    // Navigate away (AppShell itself never unmounts -- it wraps every
    // route's <Outlet/> -- but the prefs store is a module-level singleton
    // read via useSyncExternalStore, not component state, so this proves the
    // toggles survive the trip through the *store*, not just one instance's
    // React state).
    await router.navigate({ to: '/harnesses' });
    expect(await screen.findByText('harnesses view')).not.toBeNull();

    // The store itself, not just this one rendered instance, still has both
    // values -- read straight from localStorage (what the store persists to),
    // independent of any single component's props/state.
    expect(JSON.parse(localStorage.getItem(prefs.PREFS_STORAGE_KEY) ?? '{}')).toMatchObject({
      inclusive: false,
      showTitles: false,
    });
    expect(screen.getByRole('button', { name: 'Exclusive', pressed: true })).not.toBeNull();
    expect(screen.getByRole('switch', { name: 'Titles' }).getAttribute('aria-checked')).toBe(
      'false',
    );

    await router.navigate({ to: '/projects' });
    expect(await screen.findByText('projects view')).not.toBeNull();

    expect(screen.getByRole('button', { name: 'Exclusive', pressed: true })).not.toBeNull();
    expect(screen.getByRole('switch', { name: 'Titles' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  test('Cmd+K opens the command palette from anywhere in the shell', async () => {
    mount();
    expect(await screen.findByText('projects view')).not.toBeNull();

    expect(screen.queryByPlaceholderText('Search loaded sessions…')).toBeNull();

    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(await screen.findByPlaceholderText('Search loaded sessions…')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Search loaded sessions…')).toBeNull();
    });
  });

  // f9 integration-hardening (a11y audit item 1): "focus order runs sidebar
  // -> topbar -> content in DOM order". Native (non-scripted) Tab order is
  // determined by DOM document order for elements with no explicit
  // `tabIndex` -- confirmed by reading AppShell.tsx directly, zero `tabIndex`
  // props anywhere in the file -- so this is a real, load-bearing structural
  // assertion (via `Node.compareDocumentPosition`, not a hand-maintained
  // list) rather than a restatement of the source layout.
  test('focus order runs sidebar -> topbar -> content, in real DOM document order', async () => {
    mount();
    expect(await screen.findByText('projects view')).not.toBeNull();

    const aside = document.querySelector('aside');
    const header = document.querySelector('header');
    const main = document.querySelector('main');
    expect(aside).not.toBeNull();
    expect(header).not.toBeNull();
    expect(main).not.toBeNull();

    // DOCUMENT_POSITION_FOLLOWING (4): `b` comes after `a` in tree order.
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(
      // biome-ignore lint/style/noNonNullAssertion: presence asserted above
      aside!.compareDocumentPosition(header!) & FOLLOWING,
    ).toBeTruthy();
    expect(
      // biome-ignore lint/style/noNonNullAssertion: presence asserted above
      header!.compareDocumentPosition(main!) & FOLLOWING,
    ).toBeTruthy();

    // Every focusable element actually inside each region also respects that
    // region ordering -- not just the three container elements themselves.
    const FOCUSABLE = 'a[href], button:not([disabled]), input, [role="switch"]';
    const asideFocusables = [...(aside?.querySelectorAll(FOCUSABLE) ?? [])];
    const headerFocusables = [...(header?.querySelectorAll(FOCUSABLE) ?? [])];
    const mainFocusables = [...(main?.querySelectorAll(FOCUSABLE) ?? [])];
    expect(asideFocusables.length).toBeGreaterThan(0);
    expect(headerFocusables.length).toBeGreaterThan(0);

    const lastAside = asideFocusables.at(-1);
    const firstHeader = headerFocusables[0];
    expect(
      // biome-ignore lint/style/noNonNullAssertion: length checked above
      lastAside!.compareDocumentPosition(firstHeader!) & FOLLOWING,
    ).toBeTruthy();

    if (mainFocusables.length > 0) {
      const lastHeader = headerFocusables.at(-1);
      const firstMain = mainFocusables[0];
      expect(
        // biome-ignore lint/style/noNonNullAssertion: length checked above
        lastHeader!.compareDocumentPosition(firstMain!) & FOLLOWING,
      ).toBeTruthy();
    }

    // No element anywhere in the shell opts out of document-order tabbing
    // (a positive tabIndex would reorder it ahead of everything else).
    for (const el of [...asideFocusables, ...headerFocusables, ...mainFocusables]) {
      const tabIndexAttr = el.getAttribute('tabindex');
      if (tabIndexAttr !== null) {
        expect(Number(tabIndexAttr)).toBeLessThanOrEqual(0);
      }
    }
  });
});
