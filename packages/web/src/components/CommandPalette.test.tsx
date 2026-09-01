import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';
import { queryKeys } from '../api/queries';
import type { SessionSummary } from '../api/types';
import { CommandPalette } from './CommandPalette';

function makeSummary(id: string, title: string | undefined, projectName: string): SessionSummary {
  return {
    id,
    harness: 'claude-code',
    depth: 0,
    title: title === undefined ? undefined : { value: title, contentDerived: true },
    project: { key: `${projectName}-key`, name: projectName, identity: 'remote' },
    cwd: { first: '/tmp/work', all: ['/tmp/work'] },
    timing: {},
    model: { all: [], changes: 0 },
    flags: {},
    usage: {},
    counts: {},
    children: [],
    source: { path: `/tmp/${id}.jsonl`, sizeBytes: 10, mtimeMs: 0 },
    diagnostics: [],
  };
}

/** Which session id, if any, the route under test last saw. */
let openedSessionId: string | null = null;

function SessionProbe() {
  const { id } = sessionRoute.useParams();
  openedSessionId = id;
  return <p>session view {id}</p>;
}

/*
 * `CommandPalette` calls `useNavigate()`/`useQueryClient()`, so it must be
 * mounted *inside* the router's own component tree (as it is in the real
 * `AppShell`), not as a sibling of `<RouterProvider>` -- outside it,
 * `useNavigate()` silently returns a broken navigate function instead of
 * throwing at render time, and only fails once a selection tries to call it.
 */
const rootRoute = createRootRoute({
  component: () => (
    <>
      <p>root view</p>
      <CommandPalette />
      <Outlet />
    </>
  ),
});
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <p>index view</p>,
});
const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sessions/$id',
  component: SessionProbe,
});
const routeTree = rootRoute.addChildren([indexRoute, sessionRoute]);

function mount(client: QueryClient) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return { router, view };
}

describe('CommandPalette', () => {
  afterEach(() => {
    cleanup();
    openedSessionId = null;
  });

  test('is closed by default, opens on the search button, closes on Escape', async () => {
    mount(new QueryClient());
    expect(await screen.findByText('index view')).not.toBeNull();
    expect(screen.queryByPlaceholderText('Search loaded sessions…')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    expect(await screen.findByRole('dialog')).not.toBeNull();
    expect(screen.getByPlaceholderText('Search loaded sessions…')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Search loaded sessions…')).toBeNull();
    });
  });

  test('Cmd+K (and Ctrl+K) toggles the palette open and closed', async () => {
    mount(new QueryClient());
    expect(await screen.findByText('index view')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(await screen.findByPlaceholderText('Search loaded sessions…')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Search loaded sessions…')).toBeNull();
    });
  });

  test('shows an empty state when no sessions are loaded in the cache', async () => {
    mount(new QueryClient());
    expect(await screen.findByText('index view')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));

    expect(
      await screen.findByText('No sessions loaded yet — open Projects or Harnesses first.'),
    ).not.toBeNull();
  });

  test('searches client-side over sessions already sitting in the query cache', async () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.projectSessions('proj-a'), {
      summaries: [makeSummary('claude-code:aaa', 'Fix the flaky test', 'Scout')],
      rollups: {},
    });
    client.setQueryData(queryKeys.session('claude-code:bbb'), {
      summary: makeSummary('claude-code:bbb', undefined, 'Scout'),
      rollup: undefined,
      subtree: { summaries: [], rollups: {} },
      diagnostics: [],
    });

    mount(client);
    expect(await screen.findByText('index view')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));

    // From the project-sessions cache entry, titled.
    expect(await screen.findByText('Fix the flaky test')).not.toBeNull();
    // From the single-session cache entry, no title -> falls back to shortId.
    expect(screen.getByText('bbb')).not.toBeNull();
  });

  test('selecting a result navigates to the session detail route and closes the dialog', async () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.projectSessions('proj-a'), {
      summaries: [makeSummary('claude-code:aaa', 'Fix the flaky test', 'Scout')],
      rollups: {},
    });

    const { router } = mount(client);
    expect(await screen.findByText('index view')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));

    fireEvent.click(await screen.findByText('Fix the flaky test'));

    // The router's own `location.pathname` keeps the `:` percent-encoded
    // (`%3A`) -- what the *route* actually resolves the param to (what a
    // component reads via `useParams()`) is the decoded value, asserted via
    // `openedSessionId` below. Same asymmetry AppShell.test.tsx's compare
    // tests rely on for `searchStr` vs. the parsed search.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/sessions/claude-code%3Aaaa');
    });
    expect(openedSessionId).toBe('claude-code:aaa');
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Search loaded sessions…')).toBeNull();
    });
  });

  // f9 integration-hardening (a11y audit item 1): the component's own doc
  // comment claims focus trapping is Base UI Dialog.Root's default modal
  // behavior, "verified against DialogRootProps, not assumed" -- that was a
  // *type-level* check, not a runtime one. These three tests are real,
  // keyboard-event-driven RTL assertions (via `@testing-library/user-event`,
  // which computes real Tab-key focus movement -- `fireEvent.keyDown` alone
  // does not move focus in happy-dom) that re-confirm the runtime behavior
  // rather than trusting the comment.
  describe('focus trap', () => {
    test('opens with focus already inside the dialog', async () => {
      const user = userEvent.setup();
      mount(new QueryClient());
      expect(await screen.findByText('index view')).not.toBeNull();

      await user.click(screen.getByRole('button', { name: /Search/ }));
      const dialog = await screen.findByRole('dialog');

      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    test('Escape closes the dialog and returns focus to the trigger button', async () => {
      const user = userEvent.setup();
      mount(new QueryClient());
      expect(await screen.findByText('index view')).not.toBeNull();

      const trigger = screen.getByRole('button', { name: /Search/ });
      await user.click(trigger);
      await screen.findByRole('dialog');

      await user.keyboard('{Escape}');
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
      expect(document.activeElement).toBe(trigger);
    });

    test('Tab cycles focus within the dialog and never escapes it', async () => {
      const user = userEvent.setup();
      mount(new QueryClient());
      expect(await screen.findByText('index view')).not.toBeNull();

      await user.click(screen.getByRole('button', { name: /Search/ }));
      const dialog = await screen.findByRole('dialog');

      // More Tabs than the dialog has focusable descendants (input + any
      // items), so this exercises the wrap-around, not just one hop.
      for (let i = 0; i < 12; i++) {
        await user.tab();
        expect(dialog.contains(document.activeElement)).toBe(true);
      }

      // Shift+Tab (backwards) must stay contained too, not just forward Tab.
      for (let i = 0; i < 12; i++) {
        await user.tab({ shift: true });
        expect(dialog.contains(document.activeElement)).toBe(true);
      }
    });
  });
});
