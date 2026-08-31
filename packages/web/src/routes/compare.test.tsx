import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode, useEffect, useReducer } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import {
  type CompareSearchInput,
  parseCompareIds,
  Route,
  useCompareIds,
  validateCompareSearch,
} from './compare';

/**
 * `SearchSchemaInput` is a phantom marker: TanStack strips it from the
 * caller-facing type and no value ever carries it, so a test that calls the
 * validator directly has to say so once, here, rather than at every call.
 */
const asInput = (search: unknown): CompareSearchInput => search as CompareSearchInput;

/**
 * The `/compare` URL contract (design.md §8): the URL carries `ids=a,b` and the
 * component under the route receives that selection, on a cold load of a pasted
 * link and on an in-session navigation alike.
 *
 * Both halves have to be asserted on what a *component* reads, not on
 * `location.search`. TanStack builds `location.search` by running
 * `validateSearch` over the caller's input, then runs it a **second** time over
 * that output when it matches the route, and only the second result reaches
 * `useSearch`. A validator that is not idempotent therefore gives a green
 * `location.search` and an empty component — which is exactly how the earlier
 * `string[]` output shipped (verification-f4-f6.md FINDING F4-1).
 */

/** What the component under `/compare` saw on its last render. */
let received: string[] | null = null;

function CompareProbe() {
  received = useCompareIds();
  return <p>compare view</p>;
}

/** Every array `useCompareIds()` handed back, one entry per render. */
let handedBack: string[][] = [];
/** Every value the `[ids]`-keyed effect ran with, one entry per firing. */
let effectRuns: string[][] = [];

/**
 * f7's idiom from design.md §8 — `setTray(ids)` on mount, keyed on the ids —
 * plus a button that re-renders without touching the URL. If the hook allocates
 * a fresh array per call, the effect re-fires on every one of those renders.
 */
function IdentityProbe() {
  const ids = useCompareIds();
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  handedBack.push(ids);
  useEffect(() => {
    effectRuns.push(ids);
  }, [ids]);

  return (
    <button type="button" onClick={rerender}>
      render again
    </button>
  );
}

type Probe = () => ReactNode;

/**
 * A memory router carrying the **real** validator off the real route object,
 * with a probe standing in for f7's not-yet-built view. Using
 * `Route.options.validateSearch` rather than a copy is the point: rewiring the
 * route to some other validator has to fail here.
 */
function mount(initialPath: string, component: Probe = CompareProbe) {
  const rootRoute = createRootRoute();
  const routeTree = rootRoute.addChildren([
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => <p>home view</p>,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/compare',
      validateSearch: Route.options.validateSearch,
      component,
    }),
  ]);

  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  render(<RouterProvider router={router as never} />);
  return router;
}

afterEach(() => {
  cleanup();
  received = null;
  handedBack = [];
  effectRuns = [];
});

describe('parseCompareIds', () => {
  test.each([
    ['a comma string', 'a,b,c', ['a', 'b', 'c']],
    ['padding, blanks and repeats', ' a , ,b, a ,b ', ['a', 'b']],
    ['a single id', 'only', ['only']],
    ['an empty string', '', []],
    ['undefined', undefined, []],
    ['null', null, []],
    ['a list of ids', ['a', 'b'], ['a', 'b']],
    ['a list whose members are themselves comma strings', ['a,b', 'c'], ['a', 'b', 'c']],
    ['a list holding repeats', ['a', 'b', 'a'], ['a', 'b']],
    ['a list holding non-strings', [1, 'a', { id: 'b' }, null], ['a']],
    ['a nested list', [['a', 'b']], []],
    ['a number', 42, []],
    ['an object', { ids: 'a,b' }, []],
    ['a boolean', true, []],
  ])('is total over %s', (_label, raw, expected) => {
    expect(parseCompareIds(raw)).toEqual(expected);
  });

  test('preserves URL order rather than sorting (design.md §4)', () => {
    expect(parseCompareIds('zulu,alpha,mike')).toEqual(['zulu', 'alpha', 'mike']);
  });
});

describe('validateCompareSearch', () => {
  test('normalises every accepted input to the comma form the URL carries', () => {
    expect(validateCompareSearch(asInput({ ids: 'a,b' }))).toEqual({ ids: 'a,b' });
    expect(validateCompareSearch(asInput({ ids: [' a ', 'b', 'a'] }))).toEqual({ ids: 'a,b' });
    expect(validateCompareSearch(asInput({}))).toEqual({ ids: undefined });
    expect(validateCompareSearch(asInput({ ids: '' }))).toEqual({ ids: undefined });
  });

  test.each(['a,b,c', ' a , ,b, a ', '', undefined, ['a', 'b'], 42, { nested: true }])(
    'is idempotent for %j, because the router runs it twice',
    (raw) => {
      const once = validateCompareSearch(asInput({ ids: raw }));
      const twice = validateCompareSearch(asInput(once));
      expect(twice).toEqual(once);
    },
  );

  test('is the validator the route is actually wired to', () => {
    expect(Route.options.validateSearch).toBe(validateCompareSearch);
  });
});

describe('the /compare URL contract', () => {
  test('a pasted /compare?ids=a,b reaches the component as those ids', async () => {
    mount('/compare?ids=claude-code:bbb,claude-code:aaa');
    expect(await screen.findByText('compare view')).not.toBeNull();

    expect(received).toEqual(['claude-code:bbb', 'claude-code:aaa']);
  });

  test('an in-session navigation reaches the component as those ids', async () => {
    const router = mount('/');
    expect(await screen.findByText('home view')).not.toBeNull();

    await router.navigate({
      to: '/compare',
      search: { ids: 'claude-code:bbb,claude-code:aaa' },
    } as never);

    expect(await screen.findByText('compare view')).not.toBeNull();
    await waitFor(() => {
      expect(received).toEqual(['claude-code:bbb', 'claude-code:aaa']);
    });
  });

  test('a caller handing over a list arrives with the same selection', async () => {
    const router = mount('/');
    expect(await screen.findByText('home view')).not.toBeNull();

    await router.navigate({
      to: '/compare',
      search: { ids: ['claude-code:bbb', 'claude-code:aaa'] },
    } as never);

    expect(await screen.findByText('compare view')).not.toBeNull();
    await waitFor(() => {
      expect(received).toEqual(['claude-code:bbb', 'claude-code:aaa']);
    });
  });

  /**
   * Two facts, both asserted, because the earlier title claimed only the
   * convenient half (verification-f4-fix.md F4F-3). TanStack's default
   * stringifier is `URLSearchParams.toString()`, so the comma is written
   * `%2C`: the emitted query is `?ids=aaa%2Cbbb`, which DECODES to design.md
   * §8's `ids=aaa,bbb`. The raw assertion is the load-bearing one — the
   * decoded form alone cannot tell the two renderings apart, so a title that
   * says "the URL is `ids=a,b`" is unfalsifiable by it.
   *
   * The other half — that a hand-typed literal comma is honoured on the way in
   * — is the pasted-URL case at the top of this block.
   */
  test('the query it emits is `ids=a%2Cb`, design.md §8 percent-encoded, never a JSON list', async () => {
    const router = mount('/');
    expect(await screen.findByText('home view')).not.toBeNull();

    await router.navigate({ to: '/compare', search: { ids: 'aaa,bbb' } } as never);
    expect(await screen.findByText('compare view')).not.toBeNull();

    const searchStr = router.state.location.searchStr;
    // What the address bar shows, exactly.
    expect(searchStr).toBe('?ids=aaa%2Cbbb');
    // ...and what it means: design.md §8's comma form, not a JSON list.
    // `%5B` is `[`, the shape a `string[]` validated output produces.
    expect(searchStr).not.toContain('%5B');
    expect(searchStr).not.toContain('[');
    expect(decodeURIComponent(searchStr)).toBe('?ids=aaa,bbb');
  });

  test('the emitted URL round-trips back to the same selection', async () => {
    const first = mount('/');
    await first.navigate({ to: '/compare', search: { ids: 'aaa,bbb' } } as never);
    expect(await screen.findByText('compare view')).not.toBeNull();
    const emitted = first.state.location.searchStr;
    cleanup();
    received = null;

    mount(`/compare${emitted}`);
    expect(await screen.findByText('compare view')).not.toBeNull();
    expect(received).toEqual(['aaa', 'bbb']);
  });

  test('an empty selection opens a bare /compare with no query at all', async () => {
    const router = mount('/');
    expect(await screen.findByText('home view')).not.toBeNull();

    await router.navigate({ to: '/compare', search: { ids: '' } } as never);
    expect(await screen.findByText('compare view')).not.toBeNull();

    expect(router.state.location.searchStr).toBe('');
    expect(received).toEqual([]);
  });
});

/**
 * design.md §8 asks f7 for `setTray(ids)` on mount, and the obvious spelling of
 * that is `useEffect(() => setTray(ids), [ids])`. An un-memoised
 * `useCompareIds()` allocates a fresh array per call, so that effect re-fires on
 * every render of the compare view forever (verification-f4-fix.md U3, measured
 * as `renders=3 distinct array identities=3`). The stability is therefore part
 * of the hook's contract, not an optimisation, and is pinned here.
 */
describe('useCompareIds is stable enough to be an effect dependency', () => {
  test('hands back the same array on every render of one selection', async () => {
    mount('/compare?ids=aaa,bbb', IdentityProbe);
    const button = await screen.findByRole('button', { name: 'render again' });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(handedBack.length).toBeGreaterThanOrEqual(3);
    expect(handedBack[0]).toEqual(['aaa', 'bbb']);
    for (const ids of handedBack) expect(ids).toBe(handedBack[0]);
  });

  test('an `[ids]`-keyed effect runs once for a selection, not once per render', async () => {
    mount('/compare?ids=aaa,bbb', IdentityProbe);
    const button = await screen.findByRole('button', { name: 'render again' });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(handedBack.length).toBeGreaterThanOrEqual(3);
    expect(effectRuns).toEqual([['aaa', 'bbb']]);
  });

  test('a different selection does hand back a different array', async () => {
    const router = mount('/compare?ids=aaa,bbb', IdentityProbe);
    expect(await screen.findByRole('button', { name: 'render again' })).not.toBeNull();
    const first = handedBack[0];

    await router.navigate({ to: '/compare', search: { ids: 'ccc' } } as never);
    await waitFor(() => {
      expect(effectRuns).toHaveLength(2);
    });

    expect(handedBack.at(-1)).not.toBe(first);
    expect(effectRuns).toEqual([['aaa', 'bbb'], ['ccc']]);
  });
});
