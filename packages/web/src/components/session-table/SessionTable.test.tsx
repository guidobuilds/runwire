import {
  type MutationCache,
  type QueryCache,
  QueryClient,
  QueryClientProvider,
  useIsFetching,
  useIsMutating,
} from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { queryKeys } from '../../api/queries';
import type { Capability, Metric, SessionRollup, SessionSummary } from '../../api/types';
import { clearTray, isInTray, setInclusive, setShowTitles } from '../../state/prefs';
import { ConnectedMetricCell } from '../primitives/MetricCell';
import { useHarnessDirectory } from './harness-directory';
import type { HarnessDirectory } from './model';
import { SessionTable } from './SessionTable';

/**
 * Everything Claude Code declares EXCEPT `model`. Leaving one capability out is
 * deliberate: it is what proves the hoisted directory actually reaches the
 * cells — a session with no model renders the on-screen text `n/a` (capability
 * absent) rather than `—` (present capability, no value), and the two swap when
 * the directory is `undefined`.
 */
const CAPS: readonly Capability[] = [
  'usage.perCall',
  'usage.cumulative',
  'usage.cacheWrite',
  'usage.reasoning',
  'timing',
  'mode',
  'effort',
  'version',
  'turns',
  'toolCalls',
  'compactions',
  'subagents',
  'cost',
  'title',
  'git',
];

const DIRECTORY: HarnessDirectory = {
  'claude-code': { capabilities: CAPS, displayName: 'Claude Code' },
};

const STATUS = {
  lastReport: null,
  adapters: [
    {
      id: 'claude-code',
      displayName: 'Claude Code',
      capabilities: CAPS,
      probe: { installed: true, roots: ['/home/.claude'], notes: [] },
    },
  ],
};

function metric<T>(value: T, confidence: Metric['confidence'] = 'high', note?: string): Metric<T> {
  return { value, confidence, source: 'claude-code/assistant.usage#req1', note };
}

type SessionSpec = {
  id: string;
  title: string;
  projectKey: string;
  projectName: string;
  startedAt?: string;
  model?: string;
  mode?: string;
  durationMs?: number;
  /** The session's own usage — what the Exclusive view shows. */
  ownOutput?: number;
  children?: string[];
  /** Defaults to 'claude-code' -- the 'all'-scope fixtures use a second harness. */
  harness?: SessionSummary['harness'];
  /** Defaults to `[]` -- non-empty drives the row's diagnostic icon (f5). */
  diagnostics?: SessionSummary['diagnostics'];
};

function makeSummary(spec: SessionSpec): SessionSummary {
  return {
    id: spec.id,
    harness: spec.harness ?? 'claude-code',
    depth: 0,
    title: { value: spec.title, contentDerived: true },
    project: { key: spec.projectKey, name: spec.projectName, identity: 'remote' },
    cwd: { first: '/tmp/work', all: ['/tmp/work'] },
    timing: {
      startedAt: spec.startedAt === undefined ? undefined : metric(spec.startedAt),
      durationMs: spec.durationMs === undefined ? undefined : metric(spec.durationMs),
    },
    model: {
      primary: spec.model === undefined ? undefined : metric(spec.model),
      all: spec.model === undefined ? [] : [spec.model],
      changes: 0,
    },
    mode:
      spec.mode === undefined
        ? undefined
        : { primary: metric(spec.mode), all: [spec.mode], changes: 0 },
    flags: {},
    usage: {
      uncachedInput: metric(11),
      cachedInput: metric(22),
      output: spec.ownOutput === undefined ? undefined : metric(spec.ownOutput),
    },
    counts: {},
    children: spec.children ?? [],
    source: { path: `/tmp/${spec.id}.jsonl`, sizeBytes: 10, mtimeMs: 0 },
    diagnostics: spec.diagnostics ?? [],
  };
}

function makeRollup(
  id: string,
  inclusive: { uncachedInput: Metric; cachedInput: Metric; output: Metric; subagents: number },
): SessionRollup {
  return {
    id,
    exclusive: { usage: {}, counts: {} },
    inclusive: {
      usage: {
        uncachedInput: inclusive.uncachedInput,
        cachedInput: inclusive.cachedInput,
        output: inclusive.output,
      },
      counts: { subagents: metric(inclusive.subagents) },
    },
    descendants: inclusive.subagents,
  };
}

const ALPHA = makeSummary({
  id: 'claude-code:aaaa1111',
  title: 'Alpha run',
  projectKey: 'github.com/acme/one',
  projectName: 'one',
  startedAt: '2026-08-29T10:00:00.000Z',
  model: 'opus',
  mode: 'plan',
  durationMs: 1_080_000,
  ownOutput: 50,
  children: ['claude-code:kid'],
});

const BRAVO = makeSummary({
  id: 'claude-code:bbbb2222',
  title: 'Bravo run',
  projectKey: 'github.com/acme/two',
  projectName: 'two',
  startedAt: '2026-08-31T10:00:00.000Z',
  model: 'sonnet',
  mode: 'default',
  durationMs: 60_000,
  ownOutput: 60,
});

const CHARLIE = makeSummary({
  id: 'claude-code:cccc3333',
  title: 'Charlie run',
  projectKey: 'github.com/acme/one',
  projectName: 'one',
  startedAt: '2026-08-30T10:00:00.000Z',
  model: 'opus',
  ownOutput: 70,
});

/** No timing, no model, no output: the absent-value row. */
const DELTA = makeSummary({
  id: 'claude-code:dddd4444',
  title: 'Delta run',
  projectKey: 'github.com/acme/two',
  projectName: 'two',
});

const SUMMARIES: SessionSummary[] = [ALPHA, BRAVO, CHARLIE, DELTA];

const ROLLUPS: Record<string, SessionRollup> = {
  [ALPHA.id]: makeRollup(ALPHA.id, {
    // Medium confidence: the '~' marker must be on screen without hovering.
    uncachedInput: metric(1200, 'medium', 'derived: input - cached'),
    cachedInput: metric(400),
    output: metric(300),
    subagents: 2,
  }),
  [BRAVO.id]: makeRollup(BRAVO.id, {
    uncachedInput: metric(5000),
    cachedInput: metric(0),
    output: metric(600),
    subagents: 0,
  }),
  [CHARLIE.id]: makeRollup(CHARLIE.id, {
    uncachedInput: metric(700),
    cachedInput: metric(800),
    output: metric(900),
    subagents: 1,
  }),
};

/**
 * How many rows the subscription guard renders. The rendering tests keep the
 * four-row fixture; only the guard pays for this one.
 *
 * Why 120. The escape it closes is a subscription re-introduced **only past a
 * hard-coded row cut-off** — `if (index > 3) return <ConnectedMetricCell …>`, the
 * "virtualise below the fold" refactor — which a four-row fixture cannot see and
 * which cost 384 observers at a hundred rows with the suite fully green
 * (verification-f4-fix.md F4F-1, mutant E3c). 120 sits past every hard-coded cut-off
 * this stack offers a refactor: TanStack Table's default page size of 10, a
 * viewport-height window (~25-40 rows at this row height) plus overscan, and the
 * round "first 50" / "first 100" cut-offs. A *proportional* cut-off needs no
 * size at all — `index > rows.length / 2` still leaves 60 rows past it here.
 */
const GUARD_ROWS = 120;

const MANY_SUMMARIES: SessionSummary[] = Array.from({ length: GUARD_ROWS }, (_, index) => {
  const suffix = String(index).padStart(3, '0');
  return makeSummary({
    id: `claude-code:guard${suffix}`,
    title: `Guard run ${suffix}`,
    projectKey: `github.com/acme/${index % 3}`,
    projectName: `acme-${index % 3}`,
    startedAt: new Date(Date.UTC(2026, 7, 1, 0, index)).toISOString(),
    model: index % 2 === 0 ? 'opus' : 'sonnet',
    mode: index % 2 === 0 ? 'plan' : 'default',
    durationMs: 1_000 * (index + 1),
    ownOutput: index,
  });
});

const MANY_ROLLUPS: Record<string, SessionRollup> = Object.fromEntries(
  MANY_SUMMARIES.map((summary, index) => [
    summary.id,
    makeRollup(summary.id, {
      uncachedInput: metric(index + 1),
      cachedInput: metric(index + 2),
      output: metric(index + 3),
      subagents: index % 4,
    }),
  ]),
);

function makeClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(queryKeys.status, STATUS);
  return client;
}

/**
 * Every `QueryObserver` the client holds, across **every** key.
 *
 * Counting only `['status']` was the hole two adversary mutants walked through:
 * a lookup moved to any other key (`useProjects()`, say) was invisible, and so
 * was a per-cell subscription re-introduced anywhere the `['status']` key was
 * not involved.
 */
function totalObservers(client: QueryClient): number {
  return client
    .getQueryCache()
    .getAll()
    .reduce((sum, query) => sum + query.getObserversCount(), 0);
}

/**
 * How many listeners a cache is holding.
 *
 * This is the channel the observer count and the key set are both blind to.
 * `useIsFetching()` is `useSyncExternalStore(… queryCache.subscribe …)`
 * (react-query 5.102.8), so a per-cell "dim while a rescan is in flight"
 * wrapper opens one cache listener per cell — 800 of them on a hundred rows —
 * while creating no `QueryObserver` and no new key at all
 * (verification-f4-fix.md F4F-1, mutant E3). Counted for the mutation cache too:
 * `useIsMutating()` / `useMutationState()` reach it the same way.
 *
 * `Subscribable#listeners` is `protected` with no public count, so this reads it
 * through a cast — and refuses to report a number if the field is not the `Set`
 * it expects, so a rename inside react-query fails loudly here instead of
 * quietly reporting 0 for ever.
 */
function listenerCount(cache: QueryCache | MutationCache): number {
  const { listeners } = cache as unknown as { listeners?: Set<unknown> };
  if (!(listeners instanceof Set)) {
    throw new Error('react-query Subscribable#listeners is no longer a Set: this probe is blind');
  }
  return listeners.size;
}

/** The keys the client is holding, so a *new* query cannot appear unnoticed. */
function cacheKeys(client: QueryClient): string[] {
  return client
    .getQueryCache()
    .getAll()
    .map((query) => JSON.stringify(query.queryKey))
    .sort();
}

function withClient(ui: ReactNode, client: QueryClient = makeClient()) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function bodyRows(): HTMLElement[] {
  const body = screen.getAllByRole('rowgroup')[1];
  if (!body) throw new Error('no body row group rendered');
  return within(body).getAllByRole('row');
}

/**
 * The Session column's own label text, not the whole cell's `textContent`.
 * f5 added an id/confidence subtext line under the label (design.md §5), so
 * the cell's full `textContent` now concatenates both -- `.font-medium` was
 * already the label's own marker class before that change, so reading it
 * directly keeps this helper's meaning (row order by label) unchanged.
 */
function orderedLabels(): string[] {
  return bodyRows().map((row) => {
    const cell = within(row).getAllByRole('cell')[1];
    return cell?.querySelector('.font-medium')?.textContent?.trim() ?? '';
  });
}

function rowFor(label: string): HTMLElement {
  const found = bodyRows().find((row) => within(row).queryAllByText(label).length > 0);
  if (!found) throw new Error(`no row labelled "${label}"`);
  return found;
}

function headerNames(): string[] {
  return screen.getAllByRole('columnheader').map((th) => th.textContent?.trim() ?? '');
}

beforeEach(() => {
  clearTray();
  setInclusive(true);
  setShowTitles(true);
});

// Vitest runs without globals here, so Testing Library's auto-cleanup never
// registers; without this every render would pile up in one document.
afterEach(() => {
  cleanup();
});

describe('SessionTable rendering', () => {
  test('renders every session with an on-screen confidence marker on a medium-confidence Input', () => {
    withClient(
      <SessionTable
        scope="project"
        summaries={SUMMARIES}
        rollups={ROLLUPS}
        harnesses={DIRECTORY}
      />,
    );

    expect(orderedLabels()).toHaveLength(4);
    expect(rowFor('Alpha run').textContent).toContain('~1.2k');
    expect(rowFor('Bravo run').textContent).toContain('5.0k');
    expect(rowFor('Bravo run').textContent).not.toContain('~');
  });

  test('absent metrics distinguish capability-absent (n/a) from field-absent (—)', () => {
    withClient(
      <SessionTable
        scope="project"
        summaries={SUMMARIES}
        rollups={ROLLUPS}
        harnesses={DIRECTORY}
      />,
    );

    const delta = rowFor('Delta run');
    // `model` is missing from CAPS, so the Model cell reads n/a...
    expect(within(delta).getAllByText('n/a')).toHaveLength(1);
    // ...while Started/Duration/Output/Subagents keep the em dash.
    expect(within(delta).getAllByText('—').length).toBeGreaterThan(0);
  });

  test('a still-loading directory renders every absence as missing, never as not-provided', () => {
    withClient(
      <SessionTable
        scope="project"
        summaries={SUMMARIES}
        rollups={ROLLUPS}
        harnesses={undefined}
      />,
    );

    const delta = rowFor('Delta run');
    expect(within(delta).queryByText('n/a')).toBeNull();
    expect(within(delta).getAllByText('—').length).toBeGreaterThan(0);
    // displayName falls back to the harness id until status resolves.
    expect(rowFor('Alpha run').textContent).toContain('claude-code');
  });

  test('the harness column shows the adapter display name from the hoisted directory', () => {
    withClient(
      <SessionTable
        scope="project"
        summaries={SUMMARIES}
        rollups={ROLLUPS}
        harnesses={DIRECTORY}
      />,
    );
    expect(within(rowFor('Alpha run')).getByText('Claude Code')).toBeTruthy();
  });

  test('showTitles=false renders shortId instead of the title', () => {
    setShowTitles(false);
    withClient(
      <SessionTable
        scope="project"
        summaries={SUMMARIES}
        rollups={ROLLUPS}
        harnesses={DIRECTORY}
      />,
    );

    expect(screen.getByText('aaaa1111')).toBeTruthy();
    expect(screen.queryByText('Alpha run')).toBeNull();
  });
});

describe('SessionTable scope', () => {
  test("scope='harness' renders a Project column with the project name", () => {
    withClient(
      <SessionTable
        scope="harness"
        summaries={SUMMARIES}
        rollups={ROLLUPS}
        harnesses={DIRECTORY}
      />,
    );

    expect(headerNames().some((name) => name.startsWith('Project'))).toBe(true);
    expect(within(rowFor('Alpha run')).getByText('one')).toBeTruthy();
  });

  test("scope='project' does not render a Project column", () => {
    withClient(
      <SessionTable
        scope="project"
        summaries={SUMMARIES}
        rollups={ROLLUPS}
        harnesses={DIRECTORY}
      />,
    );

    expect(headerNames().some((name) => name.startsWith('Project'))).toBe(false);
    expect(within(rowFor('Alpha run')).queryByText('one')).toBeNull();
  });
});

describe('SessionTable inclusive toggle', () => {
  test('Output follows the global toggle and the header says which view it is', () => {
    withClient(
      <SessionTable
        scope="project"
        summaries={SUMMARIES}
        rollups={ROLLUPS}
        harnesses={DIRECTORY}
      />,
    );

    // Inclusive (default): Alpha's Output is the rollup total, not its own 50.
    expect(headerNames().some((name) => name.startsWith('Output (incl.)'))).toBe(true);
    expect(within(rowFor('Alpha run')).getByText('300')).toBeTruthy();
    expect(within(rowFor('Alpha run')).queryByText('50')).toBeNull();

    act(() => {
      setInclusive(false);
    });

    expect(headerNames().some((name) => name.startsWith('Output (excl.)'))).toBe(true);
    expect(within(rowFor('Alpha run')).getByText('50')).toBeTruthy();
    expect(within(rowFor('Alpha run')).queryByText('300')).toBeNull();
  });

  test('the toolbar badge names the active view', () => {
    withClient(
      <SessionTable
        scope="project"
        summaries={SUMMARIES}
        rollups={ROLLUPS}
        harnesses={DIRECTORY}
      />,
    );
    expect(screen.getByText('Inclusive')).toBeTruthy();

    act(() => {
      setInclusive(false);
    });
    expect(screen.getByText('Exclusive')).toBeTruthy();
  });

  test('the subagent count ignores the toggle — it is a tree property', () => {
    withClient(
      <SessionTable
        scope="project"
        summaries={SUMMARIES}
        rollups={ROLLUPS}
        harnesses={DIRECTORY}
      />,
    );
    expect(within(rowFor('Alpha run')).getByText('2')).toBeTruthy();

    act(() => {
      setInclusive(false);
    });
    expect(within(rowFor('Alpha run')).getByText('2')).toBeTruthy();
  });
});

describe('SessionTable sorting', () => {
  test('defaults to Started descending', () => {
    withClient(
      <SessionTable
        scope="project"
        summaries={SUMMARIES}
        rollups={ROLLUPS}
        harnesses={DIRECTORY}
      />,
    );
    expect(orderedLabels()).toEqual(['Bravo run', 'Charlie run', 'Alpha run', 'Delta run']);
  });

  test('clicking Output once sorts ascending and twice sorts descending, absent last', () => {
    withClient(
      <SessionTable
        scope="project"
        summaries={SUMMARIES}
        rollups={ROLLUPS}
        harnesses={DIRECTORY}
      />,
    );

    const outputHeader = screen.getByRole('button', { name: /^Output/ });

    fireEvent.click(outputHeader);
    expect(orderedLabels()).toEqual(['Alpha run', 'Bravo run', 'Charlie run', 'Delta run']);

    fireEvent.click(screen.getByRole('button', { name: /^Output/ }));
    expect(orderedLabels()).toEqual(['Charlie run', 'Bravo run', 'Alpha run', 'Delta run']);
  });

  test('the sorted header exposes its direction to assistive tech', () => {
    withClient(
      <SessionTable
        scope="project"
        summaries={SUMMARIES}
        rollups={ROLLUPS}
        harnesses={DIRECTORY}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Output/ }));
    const sorted = screen
      .getAllByRole('columnheader')
      .find((th) => th.textContent?.startsWith('Output'));
    expect(sorted?.getAttribute('aria-sort')).toBe('ascending');
  });

  test('Session sorts alphabetically', () => {
    withClient(
      <SessionTable
        scope="project"
        summaries={SUMMARIES}
        rollups={ROLLUPS}
        harnesses={DIRECTORY}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Session/ }));
    expect(orderedLabels()).toEqual(['Alpha run', 'Bravo run', 'Charlie run', 'Delta run']);
  });

  /**
   * The Output test above already proves `sortUndefined: 'last'` on one
   * column with a real fixture — a hand-rolled `(a, b) => (a.value ?? 0) - (b.value ?? 0)`
   * comparator would put Delta's absent value wherever 0 sorts, not always
   * last, and would fail this the moment direction flips. This repeats the
   * same proof on Duration, where **two** rows (Charlie and Delta both lack
   * `durationMs`) are absent, so a genuine TanStack `sortUndefined: 'last'`
   * must keep both of them after every row with a real value, in both
   * directions, while the two *present* rows (Alpha, Bravo) simply reverse
   * — not something one column's fixture shape could make look coincidental.
   */
  test('absent-last holds on a second sortable numeric column (Duration), both directions', () => {
    withClient(
      <SessionTable
        scope="project"
        summaries={SUMMARIES}
        rollups={ROLLUPS}
        harnesses={DIRECTORY}
      />,
    );

    const durationHeader = screen.getByRole('button', { name: /^Duration/ });

    fireEvent.click(durationHeader);
    let order = orderedLabels();
    expect(order.slice(0, 2)).toEqual(['Bravo run', 'Alpha run']);
    expect(new Set(order.slice(2))).toEqual(new Set(['Charlie run', 'Delta run']));

    fireEvent.click(screen.getByRole('button', { name: /^Duration/ }));
    order = orderedLabels();
    expect(order.slice(0, 2)).toEqual(['Alpha run', 'Bravo run']);
    expect(new Set(order.slice(2))).toEqual(new Set(['Charlie run', 'Delta run']));
  });
});

/**
 * f-datatable (post-ship correction, D45). Reuses {@link MANY_SUMMARIES}/
 * {@link MANY_ROLLUPS} (120 rows, the same fixture the query-subscription
 * guard uses) so pagination has enough real rows to page through — the
 * four/six-row fixtures used everywhere else in this file all fit on one
 * page at the default size and could never exercise this.
 */
describe('SessionTable pagination', () => {
  test('defaults to 25 rows per page, with a page count matching the full row set', () => {
    withClient(
      <SessionTable
        scope="project"
        summaries={MANY_SUMMARIES}
        rollups={MANY_ROLLUPS}
        harnesses={DIRECTORY}
      />,
    );

    expect(orderedLabels()).toHaveLength(25);
    expect(screen.getByText('Page 1 of 5')).toBeTruthy();
  });

  test('the rows-per-page selector changes how many rows render and the page count', () => {
    withClient(
      <SessionTable
        scope="project"
        summaries={MANY_SUMMARIES}
        rollups={MANY_ROLLUPS}
        harnesses={DIRECTORY}
      />,
    );

    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '50' } });
    expect(orderedLabels()).toHaveLength(50);
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: 'all' } });
    expect(orderedLabels()).toHaveLength(120);
    expect(screen.getByText('Page 1 of 1')).toBeTruthy();
  });

  test('Next/Previous page move through the real, sorted row set (not just a page counter)', () => {
    withClient(
      <SessionTable
        scope="project"
        summaries={MANY_SUMMARIES}
        rollups={MANY_ROLLUPS}
        harnesses={DIRECTORY}
      />,
    );

    // Default sort is Started descending (highest index = latest), so page 1
    // is indices 119..95 and page 2 is 94..70 — real row identities, not a
    // page-counter check that would pass even if the slice were wrong.
    expect(orderedLabels()[0]).toBe('Guard run 119');
    expect(orderedLabels().at(-1)).toBe('Guard run 095');

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Page 2 of 5')).toBeTruthy();
    expect(orderedLabels()[0]).toBe('Guard run 094');
    expect(orderedLabels().at(-1)).toBe('Guard run 070');

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(screen.getByText('Page 1 of 5')).toBeTruthy();
    expect(orderedLabels()[0]).toBe('Guard run 119');
  });

  test('Previous/First do nothing on page 1; Next/Last do nothing on the final page', () => {
    withClient(
      <SessionTable
        scope="project"
        summaries={MANY_SUMMARIES}
        rollups={MANY_ROLLUPS}
        harnesses={DIRECTORY}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    fireEvent.click(screen.getByRole('button', { name: 'First page' }));
    expect(screen.getByText('Page 1 of 5')).toBeTruthy();
    expect(orderedLabels()[0]).toBe('Guard run 119');

    // Page 5 (index 4) holds sort positions 100..119 -- the last, shortest
    // page (only 20 rows, 120 - 100) -- so its first row is index 19, not 0.
    fireEvent.click(screen.getByRole('button', { name: 'Last page' }));
    expect(screen.getByText('Page 5 of 5')).toBeTruthy();
    expect(orderedLabels()[0]).toBe('Guard run 019');
    expect(orderedLabels()).toHaveLength(20);

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Page 5 of 5')).toBeTruthy();
    expect(orderedLabels()[0]).toBe('Guard run 019');
  });

  test('a filter that narrows the row set resets to page 1 and updates the page count', () => {
    withClient(
      <SessionTable
        scope="harness"
        summaries={MANY_SUMMARIES}
        rollups={MANY_ROLLUPS}
        harnesses={DIRECTORY}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Page 2 of 5')).toBeTruthy();

    // MANY_SUMMARIES alternates opus/sonnet 60/60 (design.md §6's `matchesList`
    // pure filter, exercised here through the real component, not in isolation).
    const modelSelect = screen.getByLabelText('Model') as HTMLSelectElement;
    const opusOption = within(modelSelect).getByRole('option', {
      name: 'opus',
    }) as HTMLOptionElement;
    opusOption.selected = true;
    fireEvent.change(modelSelect);

    expect(screen.getByText('60 of 120 sessions')).toBeTruthy();
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
    expect(orderedLabels()).toHaveLength(25);
  });

  /**
   * Regression for the pagination-reset-memo-key-too-broad-breaks-tray-checkbox
   * defect (adversary-found, verification.md#datatable Lens 3/5): `allRows`
   * used to be memoized on the whole `usePrefs()` snapshot, so a `compareTray`
   * mutation (the only thing a tray checkbox touches) produced a new `allRows`
   * reference, which produced a new `data` reference, which tripped the
   * render-phase "a narrower row set resets to page 1" logic even though the
   * row set never changed. Only a >25-row (paginated) fixture, past page 1,
   * exercises this — the tray-checkbox tests elsewhere in this file use
   * single-page fixtures, where a page-1-to-page-1 reset is a no-op.
   */
  test('a compare-tray checkbox click on page 2+ does not reset pagination or change the row set', () => {
    withClient(
      <SessionTable
        scope="project"
        summaries={MANY_SUMMARIES}
        rollups={MANY_ROLLUPS}
        harnesses={DIRECTORY}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Page 2 of 5')).toBeTruthy();
    const rowsBefore = orderedLabels();
    expect(rowsBefore[0]).toBe('Guard run 094');

    expect(isInTray('claude-code:guard094')).toBe(false);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Compare Guard run 094' }));

    // Still on page 2, with exactly the same row set in the same order --
    // only the toggled row's own checkbox state changed.
    expect(screen.getByText('Page 2 of 5')).toBeTruthy();
    expect(orderedLabels()).toEqual(rowsBefore);
    expect(isInTray('claude-code:guard094')).toBe(true);
    expect(
      (screen.getByRole('checkbox', { name: 'Compare Guard run 094' }) as HTMLInputElement).checked,
    ).toBe(true);
  });
});

describe('SessionTable compare tray and row activation', () => {
  test('the row checkbox adds the session to the tray and does not activate the row', () => {
    const onOpen = vi.fn();
    withClient(
      <SessionTable
        scope="project"
        summaries={SUMMARIES}
        rollups={ROLLUPS}
        harnesses={DIRECTORY}
        onOpen={onOpen}
      />,
    );

    expect(isInTray(ALPHA.id)).toBe(false);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Compare Alpha run' }));

    expect(isInTray(ALPHA.id)).toBe(true);
    expect(onOpen).not.toHaveBeenCalled();
    expect(
      (screen.getByRole('checkbox', { name: 'Compare Alpha run' }) as HTMLInputElement).checked,
    ).toBe(true);

    // Toggling again removes it, so the checkbox is a real toggle.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Compare Alpha run' }));
    expect(isInTray(ALPHA.id)).toBe(false);
    expect(onOpen).not.toHaveBeenCalled();
  });

  test('clicking the row itself activates it (control for the checkbox test)', () => {
    const onOpen = vi.fn();
    withClient(
      <SessionTable
        scope="project"
        summaries={SUMMARIES}
        rollups={ROLLUPS}
        harnesses={DIRECTORY}
        onOpen={onOpen}
      />,
    );

    fireEvent.click(rowFor('Alpha run'));
    expect(onOpen).toHaveBeenCalledWith(ALPHA.id);
  });
});

describe('SessionTable filtering', () => {
  test('the search box narrows the rows and reports the count', () => {
    withClient(
      <SessionTable
        scope="project"
        summaries={SUMMARIES}
        rollups={ROLLUPS}
        harnesses={DIRECTORY}
      />,
    );

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'charlie' } });

    expect(orderedLabels()).toEqual(['Charlie run']);
    expect(screen.getByText('1 of 4 sessions')).toBeTruthy();
  });

  test('Clear filters restores every row', () => {
    withClient(
      <SessionTable
        scope="project"
        summaries={SUMMARIES}
        rollups={ROLLUPS}
        harnesses={DIRECTORY}
      />,
    );

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'charlie' } });
    expect(orderedLabels()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(orderedLabels()).toHaveLength(4);
    expect(screen.getByText('4 sessions')).toBeTruthy();
  });
});

/**
 * f5: the Sessions landing scope. Reuses the `SUMMARIES`/`ROLLUPS` fixture
 * (all `claude-code`) plus a second harness and a diagnostics-bearing session,
 * so the landing-specific claims (both dimensions filterable, diagnostic
 * icon, confidence subtext) have something real to assert against.
 */
const FOXTROT = makeSummary({
  id: 'codex:foxtrot001',
  title: 'Foxtrot run',
  projectKey: 'github.com/acme/three',
  projectName: 'three',
  startedAt: '2026-09-01T09:00:00.000Z',
  model: 'gpt',
  mode: 'default',
  durationMs: 30_000,
  ownOutput: 40,
  harness: 'codex',
});

const GOLF = makeSummary({
  id: 'claude-code:golf00001',
  title: 'Golf run',
  projectKey: 'github.com/acme/one',
  projectName: 'one',
  startedAt: '2026-09-01T08:00:00.000Z',
  model: 'opus',
  mode: 'plan',
  durationMs: 90_000,
  ownOutput: 20,
  diagnostics: [
    {
      level: 'warn',
      code: 'usage-mismatch',
      message: 'reported total does not match summed parts',
      harness: 'claude-code',
      path: '/tmp/claude-code:golf00001.jsonl',
    },
  ],
});

const ALL_SUMMARIES: SessionSummary[] = [...SUMMARIES, FOXTROT, GOLF];
const ALL_ROLLUPS: Record<string, SessionRollup> = { ...ROLLUPS };
const ALL_DIRECTORY: HarnessDirectory = {
  ...DIRECTORY,
  codex: { capabilities: CAPS, displayName: 'Codex' },
};

describe('SessionTable scope="all" (Sessions landing, f5)', () => {
  test('renders a diagnostic icon only for the row with diagnostics', () => {
    withClient(
      <SessionTable
        scope="all"
        summaries={ALL_SUMMARIES}
        rollups={ALL_ROLLUPS}
        harnesses={ALL_DIRECTORY}
      />,
    );

    expect(
      within(rowFor('Golf run')).getByRole('img', { name: 'Has data-quality notes' }),
    ).toBeTruthy();
    expect(
      within(rowFor('Bravo run')).queryByRole('img', { name: 'Has data-quality notes' }),
    ).toBeNull();
  });

  test('renders a confidence subtext (id + dot) under the title for a medium-confidence row', () => {
    withClient(
      <SessionTable
        scope="all"
        summaries={ALL_SUMMARIES}
        rollups={ALL_ROLLUPS}
        harnesses={ALL_DIRECTORY}
      />,
    );

    // Alpha's inclusive Input is medium confidence (ROLLUPS fixture), so the
    // row's overall confidence is medium -- the subtext line carries both the
    // id (titles are on by default) and a decorative confidence dot.
    const alpha = rowFor('Alpha run');
    expect(within(alpha).getByText('aaaa1111')).toBeTruthy();
    expect(within(alpha).getByRole('img', { name: 'medium confidence' })).toBeTruthy();

    // Bravo is all-high-confidence: the id still shows (titles on), no dot.
    const bravo = rowFor('Bravo run');
    expect(within(bravo).getByText('bbbb2222')).toBeTruthy();
    expect(within(bravo).queryByRole('img', { name: /confidence/ })).toBeNull();
  });

  test('both Project and Harness filters are offered (neither dimension is fixed)', () => {
    withClient(
      <SessionTable
        scope="all"
        summaries={ALL_SUMMARIES}
        rollups={ALL_ROLLUPS}
        harnesses={ALL_DIRECTORY}
      />,
    );

    expect(screen.getByLabelText('Harness')).toBeTruthy();
    expect(screen.getByLabelText('Project')).toBeTruthy();
  });

  test('the Harness filter narrows to one harness across projects', () => {
    withClient(
      <SessionTable
        scope="all"
        summaries={ALL_SUMMARIES}
        rollups={ALL_ROLLUPS}
        harnesses={ALL_DIRECTORY}
      />,
    );

    expect(orderedLabels()).toHaveLength(6);

    // A native `<select multiple>` is narrowed by toggling its `<option>`s'
    // own `.selected` before firing one `change` on the select itself.
    const harnessSelect = screen.getByLabelText('Harness') as HTMLSelectElement;
    const codexOption = within(harnessSelect).getByRole('option', {
      name: 'codex',
    }) as HTMLOptionElement;
    codexOption.selected = true;
    fireEvent.change(harnessSelect);

    expect(orderedLabels()).toEqual(['Foxtrot run']);
  });

  test('sorting by Session works the same as in a scoped view', () => {
    withClient(
      <SessionTable
        scope="all"
        summaries={ALL_SUMMARIES}
        rollups={ALL_ROLLUPS}
        harnesses={ALL_DIRECTORY}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Session/ }));
    expect(orderedLabels()).toEqual([
      'Alpha run',
      'Bravo run',
      'Charlie run',
      'Delta run',
      'Foxtrot run',
      'Golf run',
    ]);
  });

  test('the tray checkbox adds/removes a landing row without navigating', () => {
    const onOpen = vi.fn();
    withClient(
      <SessionTable
        scope="all"
        summaries={ALL_SUMMARIES}
        rollups={ALL_ROLLUPS}
        harnesses={ALL_DIRECTORY}
        onOpen={onOpen}
      />,
    );

    expect(isInTray(FOXTROT.id)).toBe(false);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Compare Foxtrot run' }));
    expect(isInTray(FOXTROT.id)).toBe(true);
    expect(onOpen).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Compare Foxtrot run' }));
    expect(isInTray(FOXTROT.id)).toBe(false);
  });

  test('the Inclusive/Exclusive toggle swaps the visible Output number on the landing table', () => {
    withClient(
      <SessionTable
        scope="all"
        summaries={ALL_SUMMARIES}
        rollups={ALL_ROLLUPS}
        harnesses={ALL_DIRECTORY}
      />,
    );

    // Inclusive (default): Alpha's Output is the rollup total (300), not its
    // own 50 -- same claim the scoped-view test above pins, re-proven here on
    // the unscoped table specifically (f5's own verification names this).
    expect(within(rowFor('Alpha run')).getByText('300')).toBeTruthy();
    expect(within(rowFor('Alpha run')).queryByText('50')).toBeNull();

    act(() => {
      setInclusive(false);
    });

    expect(within(rowFor('Alpha run')).getByText('50')).toBeTruthy();
    expect(within(rowFor('Alpha run')).queryByText('300')).toBeNull();
  });

  test('Titles off shows shortId instead of the title, and drops the id subtext', () => {
    setShowTitles(false);
    withClient(
      <SessionTable
        scope="all"
        summaries={ALL_SUMMARIES}
        rollups={ALL_ROLLUPS}
        harnesses={ALL_DIRECTORY}
      />,
    );

    expect(screen.getByText('aaaa1111')).toBeTruthy();
    expect(screen.queryByText('Alpha run')).toBeNull();
    // The subtext line is what carried the id when titles were on; with the
    // label itself now the id, a second identical line would be a bare
    // duplicate rather than new information.
    expect(within(rowFor('aaaa1111')).getAllByText('aaaa1111')).toHaveLength(1);
  });
});

/**
 * f5-t4 (g). This is the assertion f5's `verification` names, and the only
 * thing that stops a bulk caller from reaching for `ConnectedMetricCell` and
 * re-creating ~4400 `QueryObserver`s across a real 370-row view. A
 * capabilities-prop test that merely checks rendered output cannot see a
 * subscription, so the subscriptions are counted directly.
 *
 * **What this measures, precisely** — not "the view opens no subscriptions".
 * It counts, on the `QueryClient` this test owns: every `QueryObserver` across
 * every key; the set of keys in the cache; and the listener count on the query
 * cache and on the mutation cache. Four counters, each added after a mutant
 * walked through the previous form with the suite fully green:
 *
 * - the **key** axis — a lookup moved to any other key (`useProjects()`) was
 *   unseen while the count was `find({ queryKey: ['status'] })`
 *   (verification-f5-encoding.md R2);
 * - the **scope** axis — a subscription taken only in project scope was
 *   unseen while this ran with `scope="harness"` alone (R1: 5984 observers
 *   at 187/187 passing);
 * - the **channel** axis — `useIsFetching()` subscribes through
 *   `queryCache.subscribe()`, creating no observer and no new key, so a per-cell
 *   wrapper opened 800 cache listeners with the guard reporting 0 observers and
 *   1 key (verification-f4-fix.md F4F-1, mutant E3);
 * - the **fixture-size** axis — a four-row fixture could not see a subscription
 *   taken only past row 3, worth 384 observers at a hundred rows (F4F-1, mutant
 *   E3c). Hence {@link GUARD_ROWS}.
 *
 * **Two channels it still cannot see**, recorded rather than papered over.
 * (a) A cell that bypasses react-query altogether — a bare `fetch()` in an
 * effect, or a bespoke `useSyncExternalStore` — costs one request per cell and
 * registers on none of these four counters. (b) The **fixture-state** axis: this
 * renders one state (default filters, `inclusive` on, titles on, empty tray,
 * directory resolved), so a subscription keyed on any *other* state escapes.
 * That is not hypothetical — the variant keyed on `harnesses === undefined`, the
 * real cold-load path, is caught today only by the text assertion in the
 * absent-directory test, not by any count here.
 */
describe('SessionTable query subscriptions', () => {
  test.each(['harness', 'project'] as const)(
    'a rendered %s-scope session view leaves this client at zero observers and zero cache listeners, on every key and all 120 rows',
    (scope) => {
      const client = makeClient();
      withClient(
        <SessionTable
          scope={scope}
          summaries={MANY_SUMMARIES}
          rollups={MANY_ROLLUPS}
          harnesses={DIRECTORY}
        />,
        client,
      );

      // The query must actually exist, otherwise `?? 0` would pass vacuously.
      const statusQuery = client.getQueryCache().find({ queryKey: queryKeys.status });
      expect(statusQuery).toBeDefined();

      // Pagination (D45) now caps a page to 25 rows by default, which is
      // itself a disclosed, user-controlled cutoff -- not the hidden,
      // hard-coded fold this guard exists to catch. Select "All" so every
      // one of the 120 rows is actually on screen, the same guarantee this
      // test made before pagination existed.
      fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: 'all' } });

      // Every row rendered, so a subscription taken past a fold has nowhere to
      // hide inside this fixture.
      expect(orderedLabels()).toHaveLength(GUARD_ROWS);

      // No key beyond the one this test seeded may appear: a `useQuery` the
      // component opens for itself shows up here even before its observer does.
      expect(cacheKeys(client)).toEqual([JSON.stringify(queryKeys.status)]);
      expect(totalObservers(client)).toBe(0);
      // ...and nothing subscribed to the caches themselves either.
      expect(listenerCount(client.getQueryCache())).toBe(0);
      expect(listenerCount(client.getMutationCache())).toBe(0);

      // ...and still nothing once status resolves/updates underneath it.
      act(() => {
        client.setQueryData(queryKeys.status, { ...STATUS, lastReport: null });
      });
      expect(cacheKeys(client)).toEqual([JSON.stringify(queryKeys.status)]);
      expect(totalObservers(client)).toBe(0);
      expect(listenerCount(client.getQueryCache())).toBe(0);
      expect(listenerCount(client.getMutationCache())).toBe(0);
    },
  );

  test('ConnectedMetricCell does subscribe — control proving the observer count can see one', () => {
    const client = makeClient();
    withClient(<ConnectedMetricCell field="output" harness="claude-code" />, client);
    expect(totalObservers(client)).toBeGreaterThan(0);
  });

  /**
   * The control for the channel the previous form was blind to: this probe is
   * unseen by the observer count AND by the key set, and shows up only in the
   * listener counts. Without it those two `toBe(0)` assertions could be
   * reporting a number that never moves.
   */
  test('a cache subscriber the observer count cannot see — control for the listener counts', () => {
    function CacheSubscriber() {
      useIsFetching();
      useIsMutating();
      return null;
    }

    const client = makeClient();
    withClient(<CacheSubscriber />, client);

    expect(totalObservers(client)).toBe(0);
    expect(cacheKeys(client)).toEqual([JSON.stringify(queryKeys.status)]);
    expect(listenerCount(client.getQueryCache())).toBeGreaterThan(0);
    expect(listenerCount(client.getMutationCache())).toBeGreaterThan(0);
  });

  test('listenerCount refuses to report a number it cannot read', () => {
    expect(() => listenerCount({} as unknown as QueryCache)).toThrow(/no longer a Set/);
  });
});

describe('useHarnessDirectory', () => {
  function Probe({ onResolve }: { onResolve: (dir: HarnessDirectory | undefined) => void }) {
    onResolve(useHarnessDirectory());
    return null;
  }

  test('maps every adapter in status to its capabilities and display name', () => {
    const seen: Array<HarnessDirectory | undefined> = [];
    withClient(
      <Probe
        onResolve={(dir) => {
          seen.push(dir);
        }}
      />,
    );

    const directory = seen.at(-1);
    expect(directory?.['claude-code']?.displayName).toBe('Claude Code');
    expect(directory?.['claude-code']?.capabilities).toEqual(CAPS);
    expect(directory?.unknown).toBeUndefined();
  });
});
