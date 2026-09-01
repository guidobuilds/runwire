import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import type { Capability, SessionSummary } from '../../api/types';
import { setShowTitles } from '../../state/prefs';
import { FULL_CAPS, makeSummary, metric } from './fixtures';
import { SessionHeader } from './SessionHeader';

/** Minimal in-memory router: the header links to /projects/$key. */
async function renderInRouter(ui: ReactNode) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <>{ui}</>,
  });
  const projectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/projects/$key',
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, projectRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  // biome-ignore lint/suspicious/noExplicitAny: the test tree is not the registered app tree.
  return render(<RouterProvider router={router as any} />);
}

const LONG_TITLE = `Investigate ${'the rollup discrepancy '.repeat(12)}end`;

function headerSummary(extra: Partial<SessionSummary> = {}) {
  return makeSummary({
    id: 'fake:abcdef0123',
    title: { value: 'Refactor the scanner rollup', contentDerived: true },
    harnessVersion: { first: '1.2.3', last: '1.2.4' },
    git: { branch: 'main', commit: 'a1b2c3d4e5f6', repoName: 'scout' },
    timing: { startedAt: metric('2026-08-31T09:00:00.000Z') },
    model: { primary: metric('sonnet-4'), all: ['sonnet-4'], changes: 0 },
    ...extra,
  });
}

function noJsonLeak(root: HTMLElement) {
  expect(root.textContent ?? '').not.toContain('[object ');
  expect(root.innerHTML).not.toContain('[object ');
  expect(root.textContent ?? '').not.toContain('{"');
  // Attribute values serialize `"` as `&quot;`, so the raw-JSON probe has to
  // accept both spellings or an attribute-only leak walks past it.
  expect(root.innerHTML).not.toMatch(/\{(&quot;|")/u);
}

describe('SessionHeader', () => {
  afterEach(() => {
    cleanup();
    setShowTitles(true);
  });

  test('renders the content-derived title as text, never as raw JSON', async () => {
    const view = await renderInRouter(
      <SessionHeader
        summary={headerSummary()}
        capabilities={FULL_CAPS}
        displayName="Fake Harness"
      />,
    );
    expect(screen.getByText('Refactor the scanner rollup')).not.toBeNull();
    noJsonLeak(view.container);
  });

  test('renders harnessVersion as a first → last range, never as raw JSON', async () => {
    const view = await renderInRouter(
      <SessionHeader
        summary={headerSummary()}
        capabilities={FULL_CAPS}
        displayName="Fake Harness"
      />,
    );
    expect(screen.getByText('1.2.3 → 1.2.4')).not.toBeNull();
    noJsonLeak(view.container);
  });

  test('an unchanged version renders once, not as a range', async () => {
    await renderInRouter(
      <SessionHeader
        summary={headerSummary({ harnessVersion: { first: '2.0.0', last: '2.0.0' } })}
        capabilities={FULL_CAPS}
        displayName="Fake Harness"
      />,
    );
    expect(screen.getByText('2.0.0')).not.toBeNull();
    expect(screen.queryByText('2.0.0 → 2.0.0')).toBeNull();
  });

  test('git facts render as repo · branch · short commit', async () => {
    await renderInRouter(
      <SessionHeader
        summary={headerSummary()}
        capabilities={FULL_CAPS}
        displayName="Fake Harness"
      />,
    );
    expect(screen.getByText('scout · main · a1b2c3d')).not.toBeNull();
  });

  test('a long title is capped in the on-screen text and kept whole on hover', async () => {
    await renderInRouter(
      <SessionHeader
        summary={headerSummary({ title: { value: LONG_TITLE, contentDerived: true } })}
        capabilities={FULL_CAPS}
        displayName="Fake Harness"
      />,
    );
    const heading = screen.getByRole('heading', { level: 1 });
    const shown = heading.textContent ?? '';
    expect(LONG_TITLE.length).toBeGreaterThan(200);
    expect(shown.length).toBeLessThanOrEqual(120);
    expect(shown.endsWith('…')).toBe(true);
    expect(heading.getAttribute('title')).toBe(LONG_TITLE);
  });

  test('with Titles off the heading is the short id, not the content-derived title', async () => {
    setShowTitles(false);
    await renderInRouter(
      <SessionHeader
        summary={headerSummary()}
        capabilities={FULL_CAPS}
        displayName="Fake Harness"
      />,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('abcdef01');
    expect(screen.queryByText('Refactor the scanner rollup')).toBeNull();
  });

  test('absent version and git show n/a when the harness cannot report them', async () => {
    const caps: readonly Capability[] = ['timing', 'model'];
    const view = await renderInRouter(
      <SessionHeader
        summary={makeSummary({ id: 'fake:abcdef0123' })}
        capabilities={caps}
        displayName="Fake Harness"
      />,
    );
    expect(screen.getAllByText('n/a').length).toBeGreaterThanOrEqual(2);
    expect(view.container.textContent ?? '').toContain('n/a');
  });

  test('absent version and git show an em dash when the harness could report them', async () => {
    await renderInRouter(
      <SessionHeader
        summary={makeSummary({ id: 'fake:abcdef0123' })}
        capabilities={FULL_CAPS}
        displayName="Fake Harness"
      />,
    );
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('n/a')).toBeNull();
  });

  test('a session with no model changes shows no change popover trigger', async () => {
    await renderInRouter(
      <SessionHeader
        summary={headerSummary()}
        capabilities={FULL_CAPS}
        displayName="Fake Harness"
      />,
    );
    expect(screen.queryByRole('button', { name: /change/u })).toBeNull();
  });

  test('a model change count opens a popover listing every model used', async () => {
    await renderInRouter(
      <SessionHeader
        summary={headerSummary({
          model: {
            primary: metric('sonnet-4'),
            all: ['sonnet-4', 'opus-5'],
            changes: 1,
          },
        })}
        capabilities={FULL_CAPS}
        displayName="Fake Harness"
      />,
    );
    const trigger = screen.getByRole('button', { name: '1 change' });
    expect(screen.queryByText('opus-5')).toBeNull();
    fireEvent.click(trigger);
    const popoverTitle = await screen.findByText('Models used');
    const popover = popoverTitle.closest('[data-slot="popover-content"]');
    if (!popover) throw new Error('popover content not found');
    expect(within(popover as HTMLElement).getByText('sonnet-4')).not.toBeNull();
    expect(within(popover as HTMLElement).getByText('opus-5')).not.toBeNull();
  });

  test('the project link carries the raw project key', async () => {
    await renderInRouter(
      <SessionHeader
        summary={headerSummary()}
        capabilities={FULL_CAPS}
        displayName="Fake Harness"
      />,
    );
    const link = screen.getByRole('link', { name: 'app' });
    expect(link.getAttribute('href')).toContain('github.com');
  });
});
