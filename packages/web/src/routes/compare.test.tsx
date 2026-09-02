import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type ReactNode, useEffect, useReducer } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Capability, Metric, SessionRollup, SessionSummary } from '../api/types';
import type { HarnessDirectory } from '../components/session-table/model';
import { clearTray, isInTray, setShowAutomated, setTray } from '../state/prefs';
import {
  type CompareSearchInput,
  parseCompareIds,
  Route,
  useCompareIds,
  validateCompareSearch,
} from './compare';

/**
 * `useCompareSessions`/`useTraces` are mocked entirely (the same pattern
 * `SessionDetail.test.tsx` uses for `../../api/queries`) rather than driven
 * through a real `QueryClientProvider` + fetch stub: this suite exercises
 * `CompareRoute`'s own matrix/ribbon/tray wiring, not react-query's data
 * fetching, which `CompareCell.test.tsx`/`CompareRibbons.test.tsx` already
 * cover in isolation. The functions read a mutable `shared` object (not a
 * snapshot captured at mock-creation time) so each test can set its own
 * fixture before rendering, same convention as `SessionDetail.test.tsx`.
 */
const shared: {
  compare: { data?: unknown; isPending: boolean; error: unknown; refetch: () => void };
  traces: Array<{ data?: unknown }>;
} = {
  compare: { data: undefined, isPending: false, error: undefined, refetch: () => {} },
  traces: [],
};

vi.mock('../api/queries', () => ({
  useCompareSessions: () => shared.compare,
  useTraces: () => shared.traces,
}));

let harnessDirectory: HarnessDirectory | undefined;
vi.mock('../components/session-table/harness-directory', () => ({
  useHarnessDirectory: () => harnessDirectory,
}));

function metric<T>(value: T, overrides: Partial<Metric<T>> = {}): Metric<T> {
  return { value, confidence: 'high', source: 'claude-code/assistant.usage#req1', ...overrides };
}

const CAPS_CLAUDE: readonly Capability[] = [
  'model',
  'mode',
  'timing',
  'usage.perCall',
  'usage.cumulative',
  'subagents',
];
// Deliberately no 'mode' -- the not-provided (capability-absent) case below.
const CAPS_CODEX: readonly Capability[] = [
  'model',
  'timing',
  'usage.perCall',
  'usage.cumulative',
  'subagents',
];

function compareSummary(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
  return {
    harness: 'claude-code',
    depth: 0,
    title: { value: overrides.id, contentDerived: true },
    project: { key: 'github.com/acme/one', name: 'one', identity: 'remote' },
    cwd: { first: '/tmp', all: ['/tmp'] },
    timing: { startedAt: metric('2026-08-30T00:00:00.000Z'), durationMs: metric(120_000) },
    model: { primary: metric('opus'), all: ['opus'], changes: 0 },
    mode: { primary: metric('plan'), all: ['plan'], changes: 0 },
    flags: {},
    usage: { uncachedInput: metric(1_000), cachedInput: metric(2_000), output: metric(500) },
    counts: {},
    children: [],
    source: { path: `/tmp/${overrides.id}.jsonl`, sizeBytes: 1, mtimeMs: 0 },
    diagnostics: [],
    ...overrides,
  };
}

const ALPHA = compareSummary({
  id: 'claude-code:alpha',
  title: { value: 'Alpha run', contentDerived: true },
  harness: 'claude-code',
  // capabilities include 'subagents', but this session has no rollup below
  // -- the field-absent ("Missing in this session") case.
});

const BETA = compareSummary({
  id: 'codex:beta',
  title: { value: 'Beta run', contentDerived: true },
  harness: 'codex',
  // codex's capabilities (below) don't include 'mode' at all -- the
  // capability-absent ("Not provided by Codex") case.
  mode: undefined,
  usage: {
    // present, but computed differently -- the D40 "derived" case.
    uncachedInput: metric(4_000, {
      confidence: 'medium',
      note: 'derived from input − cached (D5)',
    }),
    cachedInput: metric(2_500),
    output: metric(999_999), // deliberately far from ALPHA's 500 (no-winner check).
  },
});

const ROLLUPS: Record<string, SessionRollup> = {
  // `toSessionRow` prefers a rollup's `inclusive.usage` over the summary's own
  // (exclusive) usage whenever `prefs.inclusive` is true (the default), so
  // Beta's rollup has to carry the same derived/high-confidence values as its
  // summary or the inclusive (default) view would show different numbers
  // than `BETA.usage` above -- and, with an empty rollup usage, "missing"
  // instead of the intended "derived"/"normal" cells this suite exercises.
  'codex:beta': {
    id: 'codex:beta',
    exclusive: { usage: {}, counts: {} },
    inclusive: { usage: BETA.usage, counts: { subagents: metric(2) } },
    descendants: 2,
  },
};

const HARNESSES: HarnessDirectory = {
  'claude-code': { capabilities: CAPS_CLAUDE, displayName: 'Claude Code' },
  codex: { capabilities: CAPS_CODEX, displayName: 'Codex' },
};

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

describe('CompareRoute — matrix, D40 cell treatments, no winner styling', () => {
  afterEach(() => {
    cleanup();
    clearTray();
    shared.compare = { data: undefined, isPending: false, error: undefined, refetch: () => {} };
    shared.traces = [];
    harnessDirectory = undefined;
  });

  function mountCompare(initialPath: string) {
    // Route.options.component is the real, unexported `CompareRoute` this
    // file's own `mount()` helper otherwise stubs out with a probe -- casting
    // through `never` mirrors this file's existing `router as never` idiom
    // for the same ad-hoc-route-tree-vs-registered-router-type mismatch.
    return mount(initialPath, Route.options.component as never);
  }

  test('renders one column per compared session, in URL order, with every design.md §5 row', async () => {
    harnessDirectory = HARNESSES;
    shared.compare = {
      data: { summaries: [BETA, ALPHA], rollups: ROLLUPS },
      isPending: false,
      error: undefined,
      refetch: () => {},
    };

    mountCompare('/compare?ids=claude-code:alpha,codex:beta');

    const headers = await screen.findAllByRole('columnheader');
    // Metric label column + one column per session, Alpha before Beta (URL
    // order), even though the mocked query returned Beta first.
    expect(headers).toHaveLength(3);
    expect(headers[1]?.textContent).toContain('Alpha run');
    expect(headers[2]?.textContent).toContain('Beta run');

    for (const label of [
      'Harness',
      'Project',
      'Model',
      'Mode',
      'Duration',
      'Input (incl.)',
      'Cached (incl.)',
      'Output (incl.)',
      'Subagents',
    ]) {
      expect(screen.getByRole('rowheader', { name: label })).not.toBeNull();
    }

    // `getByLabelText` (not `getByTitle`): the vendored claude-code.svg mark
    // carries its own inlined `<title>` element, which would otherwise
    // duplicate-match a title-text query alongside the Avatar root's own
    // `title` attribute.
    expect(screen.getByLabelText('Claude Code')).not.toBeNull();
    expect(screen.getByLabelText('Codex')).not.toBeNull();
  });

  test('missing (capability-absent): Codex has no "mode" capability at all -> "Not reported", not-provided title', async () => {
    harnessDirectory = HARNESSES;
    shared.compare = {
      data: { summaries: [ALPHA, BETA], rollups: ROLLUPS },
      isPending: false,
      error: undefined,
      refetch: () => {},
    };

    mountCompare('/compare?ids=claude-code:alpha,codex:beta');
    await screen.findAllByRole('columnheader');

    const modeRow = screen.getByRole('rowheader', { name: 'Mode' }).closest('tr');
    expect(modeRow).not.toBeNull();
    const cell = within(modeRow as HTMLElement).getByText('Not reported');
    expect(cell.getAttribute('title')).toBe('Not provided by Codex');
  });

  test('missing (field-absent): Alpha has the "subagents" capability but no rollup -> "Not reported", missing-in-session title', async () => {
    harnessDirectory = HARNESSES;
    shared.compare = {
      data: { summaries: [ALPHA, BETA], rollups: ROLLUPS },
      isPending: false,
      error: undefined,
      refetch: () => {},
    };

    mountCompare('/compare?ids=claude-code:alpha,codex:beta');
    await screen.findAllByRole('columnheader');

    const subagentsRow = screen.getByRole('rowheader', { name: 'Subagents' }).closest('tr');
    expect(subagentsRow).not.toBeNull();
    const cells = within(subagentsRow as HTMLElement).getAllByText('Not reported');
    // Alpha's cell is field-absent; assert its title specifically (Beta's
    // subagents cell, from its rollup, renders normally below).
    const alphaCell = cells.find((el) => el.getAttribute('title') === 'Missing in this session');
    expect(alphaCell).not.toBeUndefined();
  });

  test("derived: Beta's uncachedInput is present but medium-confidence -> amber value + visible note text, not delegated to plain MetricCell", async () => {
    harnessDirectory = HARNESSES;
    shared.compare = {
      data: { summaries: [ALPHA, BETA], rollups: ROLLUPS },
      isPending: false,
      error: undefined,
      refetch: () => {},
    };

    mountCompare('/compare?ids=claude-code:alpha,codex:beta');
    await screen.findAllByRole('columnheader');

    expect(screen.getByText('derived from input − cached (D5)')).not.toBeNull();
    const derivedCell = document.querySelector('[data-compare-cell="derived"]');
    expect(derivedCell).not.toBeNull();
    expect(derivedCell?.className).toContain('var(--confidence-medium)');
  });

  test('no winner highlighting: Alpha (output 500) and Beta (output 999999) render with identical cell styling despite the huge gap', async () => {
    harnessDirectory = HARNESSES;
    shared.compare = {
      data: { summaries: [ALPHA, BETA], rollups: ROLLUPS },
      isPending: false,
      error: undefined,
      refetch: () => {},
    };

    mountCompare('/compare?ids=claude-code:alpha,codex:beta');
    await screen.findAllByRole('columnheader');

    const outputRow = screen.getByRole('rowheader', { name: 'Output (incl.)' }).closest('tr');
    const valueSpans = within(outputRow as HTMLElement).getAllByText(/^\d/);
    expect(valueSpans).toHaveLength(2);
    expect(valueSpans[0]?.className).toBe(valueSpans[1]?.className);
  });

  test('column remove: clicking × drops that session from the matrix and from prefs.compareTray', async () => {
    harnessDirectory = HARNESSES;
    shared.compare = {
      data: { summaries: [ALPHA, BETA], rollups: ROLLUPS },
      isPending: false,
      error: undefined,
      refetch: () => {},
    };

    mountCompare('/compare?ids=claude-code:alpha,codex:beta');
    await screen.findAllByRole('columnheader');
    expect(isInTray('claude-code:alpha')).toBe(true);
    expect(isInTray('codex:beta')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Alpha run from comparison' }));

    await waitFor(() => {
      expect(screen.getAllByRole('columnheader')).toHaveLength(2);
    });
    expect(screen.queryAllByText('Alpha run')).toHaveLength(0);
    const remainingHeaders = screen.getAllByRole('columnheader');
    expect(remainingHeaders.some((header) => header.textContent?.includes('Beta run'))).toBe(true);
    await waitFor(() => {
      expect(isInTray('claude-code:alpha')).toBe(false);
    });
    expect(isInTray('codex:beta')).toBe(true);
  });

  test('empty tray: bare /compare renders the CTA back to Sessions, no table', async () => {
    mountCompare('/compare');

    expect(await screen.findByText('No sessions to compare yet')).not.toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    const cta = screen.getByRole('link', { name: 'Go to Sessions' });
    expect(cta.getAttribute('href')).toBe('/');
  });

  test('ribbons: one compact ribbon strip per compared session, sharing an axis (delegated to CompareRibbons, smoke-checked here)', async () => {
    harnessDirectory = HARNESSES;
    shared.compare = {
      data: { summaries: [ALPHA, BETA], rollups: ROLLUPS },
      isPending: false,
      error: undefined,
      refetch: () => {},
    };
    shared.traces = [
      {
        data: {
          id: ALPHA.id,
          steps: [{ kind: 'turn', i: 0 }],
          models: ['opus'],
          axis: { steps: 1 },
          totals: {
            uncachedInput: 0,
            cachedInput: 0,
            cacheWrite: 0,
            output: 0,
            reasoningOutput: 0,
          },
        },
      },
      { data: undefined },
    ];

    const view = mountCompare('/compare?ids=claude-code:alpha,codex:beta');
    await screen.findAllByRole('columnheader');

    expect(view.state.location.pathname).toBe('/compare');
    expect(screen.getByText('Trace')).not.toBeNull();
  });

  /*
   * The tray outlives a preference change (it persists in localStorage), so
   * "compare sessions the tables refuse to list" is a state a real user reaches
   * -- add a machine session to the tray, then turn "Automated" off. The
   * decision (grill trap 1/2): Compare keeps them, because every id there is an
   * explicit choice, and labels them so the inconsistency with the lists is
   * explained rather than mysterious. Nothing here may silently rewrite the
   * tray.
   */
  describe('automated sessions the lists are hiding', () => {
    const MACHINE = compareSummary({
      id: 'claude-code:machine',
      title: { value: 'SDK run', contentDerived: true },
      initiator: {
        value: { kind: 'machine', surface: 'sdk-py', automation: 'sdk' },
        confidence: 'high',
        source: 'claude-code/initiator',
      },
    });
    const HUMAN = compareSummary({
      id: 'claude-code:human',
      title: { value: 'Typed run', contentDerived: true },
      initiator: {
        value: { kind: 'human', surface: 'cli' },
        confidence: 'medium',
        source: 'claude-code/initiator',
      },
    });

    afterEach(() => {
      setShowAutomated(false);
    });

    function mountBoth() {
      harnessDirectory = HARNESSES;
      shared.compare = {
        data: { summaries: [MACHINE, HUMAN], rollups: {} },
        isPending: false,
        error: undefined,
        refetch: () => {},
      };
      setTray(['claude-code:machine', 'claude-code:human']);
      return mountCompare('/compare?ids=claude-code:machine,claude-code:human');
    }

    // The label appears twice per session (matrix column header + ribbon
    // strip), so column identity is asserted through the per-column remove
    // button's aria-label, which is unique.
    const machineColumn = () =>
      screen.findByRole('button', { name: 'Remove SDK run from comparison' });

    test('renders the machine session as a full column and marks it automated', async () => {
      mountBoth();
      expect(await machineColumn()).not.toBeNull();
      expect(
        screen.getByRole('button', { name: 'Remove Typed run from comparison' }),
      ).not.toBeNull();
      // One badge, on the machine column only.
      expect(screen.getAllByText('automated')).toHaveLength(1);
      // Its data is really rendered, not a placeholder column: `sdk-py`'s row
      // values come through the same cells every other column uses.
      expect(screen.getAllByText('500').length).toBeGreaterThan(0);
    });

    test('the tray is not silently rewritten to drop it', async () => {
      mountBoth();
      expect(await machineColumn()).not.toBeNull();
      // `CompareRoute` syncs the tray to what it is showing; showing it and
      // dropping it from the tray would be the worst of both worlds.
      expect(isInTray('claude-code:machine')).toBe(true);
    });

    test('with the preference on, the badge disappears (nothing is being hidden anywhere)', async () => {
      setShowAutomated(true);
      mountBoth();
      expect(await machineColumn()).not.toBeNull();
      expect(screen.queryByText('automated')).toBeNull();
    });
  });
});
