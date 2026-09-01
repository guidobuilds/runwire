import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

    // Scoped to the real Sidebar's root (`data-slot="sidebar"` -- shadcn's
    // own marker; there is no `<aside>` anymore, confirmed by reading the
    // installed ui/sidebar.tsx). Scoping matters because shadcn's real
    // `BreadcrumbPage` also renders with `role="link"` (aria-disabled, not a
    // real link), and the breadcrumb text is always one of these three nav
    // labels -- an unscoped `getByRole('link', ...)` finds both.
    const sidebar = document.querySelector('[data-slot="sidebar"]') as HTMLElement;
    expect(sidebar).not.toBeNull();
    expect(within(sidebar).getByRole('link', { name: 'Sessions' })).not.toBeNull();
    expect(within(sidebar).getByRole('link', { name: 'Projects' })).not.toBeNull();
    expect(within(sidebar).getByRole('link', { name: 'Harnesses' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Settings' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Help' })).not.toBeNull();

    // Topbar breadcrumb reflects the current route. shadcn's real
    // `Breadcrumb` sets `aria-label="breadcrumb"` (lower-case) itself --
    // confirmed by reading the installed ui/breadcrumb.tsx, not assumed.
    expect(screen.getByRole('navigation', { name: 'breadcrumb' }).textContent).toBe('Projects');

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

    // Scoped for the same reason as the test above -- shadcn's `BreadcrumbPage`
    // also has role="link", and the breadcrumb text at this route is
    // "Harnesses" too, which would otherwise collide with the nav link.
    const sidebar = document.querySelector('[data-slot="sidebar"]') as HTMLElement;
    const active = within(sidebar).getByRole('link', { name: 'Harnesses' });
    const inactive = within(sidebar).getByRole('link', { name: 'Projects' });
    const sessions = within(sidebar).getByRole('link', { name: 'Sessions' });

    // `data-status` proves the link resolves to the matched route -- TanStack
    // Router's own attribute on the rendered <a>, computed by the <Link>
    // itself and unaffected by being passed in as SidebarMenuButton's
    // `render` element (Base UI clones it with merged props, but Link's own
    // route-match logic runs independently of that).
    expect(active.getAttribute('data-status')).toBe('active');
    expect(inactive.getAttribute('data-status')).not.toBe('active');
    // "Sessions" -> "/" must not be active-by-prefix on every other route.
    expect(sessions.getAttribute('data-status')).not.toBe('active');
    // …and the active styling is driven by SidebarMenuButton's own `isActive`
    // prop, which surfaces as a `data-active` attribute (Base UI's
    // useRender state -> data-attribute convention). It is NOT a "font-medium"
    // substring in `class`: the real component's variant classlist always
    // contains the literal static string "data-active:font-medium" (a
    // Tailwind attribute-variant selector), on every menu button whether or
    // not it is active, so a `class` substring check would now pass
    // unconditionally and prove nothing.
    expect(active.getAttribute('data-active')).toBe('');
    expect(inactive.getAttribute('data-active')).toBeNull();

    expect(screen.getByRole('navigation', { name: 'breadcrumb' }).textContent).toBe('Harnesses');
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
  // `tabIndex` -- true for everything AppShell.tsx itself renders; the one
  // exception is shadcn's own `SidebarRail` (tabIndex={-1}), which only
  // removes it from the sequential tab order rather than reordering it, so
  // the guard against a *positive* tabIndex below still catches the only way
  // order could actually be subverted. This is a real, load-bearing
  // structural assertion (via `Node.compareDocumentPosition`, not a
  // hand-maintained list) rather than a restatement of the source layout.
  test('focus order runs sidebar -> topbar -> content, in real DOM document order', async () => {
    mount();
    expect(await screen.findByText('projects view')).not.toBeNull();

    // shadcn's real `Sidebar` never renders an `<aside>` -- desktop mode is a
    // plain `<div data-slot="sidebar">` (confirmed by reading the installed
    // ui/sidebar.tsx; mobile mode swaps in a Sheet instead, still under the
    // same `data-slot="sidebar"` marker). `SidebarInset` is itself the
    // page's one `<main>` (`data-slot="sidebar-inset"`), so the routed
    // content region below the header is a plain `<div data-slot=
    // "app-content">` rather than a second, nested `<main>` (which would be
    // invalid HTML and a duplicate landmark).
    const sidebarRoot = document.querySelector('[data-slot="sidebar"]');
    const header = document.querySelector('header');
    const content = document.querySelector('[data-slot="app-content"]');
    expect(sidebarRoot).not.toBeNull();
    expect(header).not.toBeNull();
    expect(content).not.toBeNull();

    // DOCUMENT_POSITION_FOLLOWING (4): `b` comes after `a` in tree order.
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(
      // biome-ignore lint/style/noNonNullAssertion: presence asserted above
      sidebarRoot!.compareDocumentPosition(header!) & FOLLOWING,
    ).toBeTruthy();
    expect(
      // biome-ignore lint/style/noNonNullAssertion: presence asserted above
      header!.compareDocumentPosition(content!) & FOLLOWING,
    ).toBeTruthy();

    // Every focusable element actually inside each region also respects that
    // region ordering -- not just the three container elements themselves.
    const FOCUSABLE = 'a[href], button:not([disabled]), input, [role="switch"]';
    const sidebarFocusables = [...(sidebarRoot?.querySelectorAll(FOCUSABLE) ?? [])];
    const headerFocusables = [...(header?.querySelectorAll(FOCUSABLE) ?? [])];
    const contentFocusables = [...(content?.querySelectorAll(FOCUSABLE) ?? [])];
    expect(sidebarFocusables.length).toBeGreaterThan(0);
    expect(headerFocusables.length).toBeGreaterThan(0);

    const lastSidebar = sidebarFocusables.at(-1);
    const firstHeader = headerFocusables[0];
    expect(
      // biome-ignore lint/style/noNonNullAssertion: length checked above
      lastSidebar!.compareDocumentPosition(firstHeader!) & FOLLOWING,
    ).toBeTruthy();

    if (contentFocusables.length > 0) {
      const lastHeader = headerFocusables.at(-1);
      const firstContent = contentFocusables[0];
      expect(
        // biome-ignore lint/style/noNonNullAssertion: length checked above
        lastHeader!.compareDocumentPosition(firstContent!) & FOLLOWING,
      ).toBeTruthy();
    }

    // No element anywhere in the shell opts out of document-order tabbing
    // with a *positive* tabIndex (which would reorder it ahead of
    // everything else); shadcn's SidebarRail uses tabIndex={-1}, which is
    // explicitly allowed by the `<= 0` check below.
    for (const el of [...sidebarFocusables, ...headerFocusables, ...contentFocusables]) {
      const tabIndexAttr = el.getAttribute('tabindex');
      if (tabIndexAttr !== null) {
        expect(Number(tabIndexAttr)).toBeLessThanOrEqual(0);
      }
    }
  });

  // The real Sidebar's collapse/expand is a genuine new capability from
  // adopting shadcn's actual component (design brief only ever specified a
  // static, always-visible sidebar) -- worth its own coverage rather than
  // just trusting the vendored implementation.
  test('the SidebarTrigger toggles the desktop sidebar between expanded and collapsed', async () => {
    mount();
    expect(await screen.findByText('projects view')).not.toBeNull();

    const sidebarRoot = document.querySelector('[data-slot="sidebar"]');
    expect(sidebarRoot?.getAttribute('data-state')).toBe('expanded');

    // Both the topbar's `SidebarTrigger` and shadcn's own `SidebarRail` (a
    // thin edge-of-sidebar drag handle, tabIndex={-1}) share the accessible
    // name "Toggle Sidebar" -- `data-slot="sidebar-trigger"` picks the real
    // topbar button specifically.
    const trigger = document.querySelector('[data-slot="sidebar-trigger"]');
    expect(trigger).not.toBeNull();
    // biome-ignore lint/style/noNonNullAssertion: presence asserted above
    fireEvent.click(trigger!);

    await waitFor(() => {
      expect(sidebarRoot?.getAttribute('data-state')).toBe('collapsed');
    });
  });

  // Below the 768px breakpoint (`hooks/use-mobile.ts`), shadcn's real
  // `Sidebar` swaps its inline desktop markup for a `Sheet`-based dialog --
  // closed by default -- rather than the hand-rolled version's always-inline
  // `<aside>`, which had no narrow-viewport behavior at all.
  test('on a narrow viewport the sidebar renders through the mobile Sheet fallback, closed by default', async () => {
    const originalInnerWidth = window.innerWidth;
    window.innerWidth = 500;
    try {
      mount();
      expect(await screen.findByText('projects view')).not.toBeNull();

      await waitFor(() => {
        // `useIsMobile` resolves via an effect after the first render, so
        // give it a tick before asserting the closed-by-default state.
        expect(screen.queryByRole('link', { name: 'Sessions' })).toBeNull();
      });
      expect(document.querySelector('[data-mobile="true"]')).toBeNull();

      // On mobile there is no SidebarRail (the Sheet fallback replaces the
      // whole desktop branch), so the trigger is the only "Toggle Sidebar"
      // control -- still selected by its stable `data-slot`, not the label.
      const trigger = document.querySelector('[data-slot="sidebar-trigger"]');
      expect(trigger).not.toBeNull();
      // biome-ignore lint/style/noNonNullAssertion: presence asserted above
      fireEvent.click(trigger!);

      expect(await screen.findByRole('link', { name: 'Sessions' })).not.toBeNull();
      expect(document.querySelector('[data-mobile="true"]')).not.toBeNull();
    } finally {
      window.innerWidth = originalInnerWidth;
    }
  });
});
