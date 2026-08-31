import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { queryKeys } from '../api/queries';
import type { Capability, Metric, StatusResponse } from '../api/types';
import { ALL_FIELD_KEYS } from '../lib/capabilities';
import { ConnectedMetricCell, MetricCell } from './MetricCell';

const FAKE_CAPS: Capability[] = [
  'usage.perCall',
  'usage.cumulative',
  'usage.cacheWrite',
  'timing',
  'model',
];

function statusWith(capabilities: readonly Capability[]): StatusResponse {
  return {
    lastReport: null,
    adapters: [
      {
        id: 'fake',
        displayName: 'Fake Harness',
        capabilities,
        probe: { installed: true, roots: ['/fake'], notes: [] },
      },
    ],
  };
}

function makeClient(capabilities: readonly Capability[] = FAKE_CAPS) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(queryKeys.status, statusWith(capabilities));
  return client;
}

function renderCell(ui: ReactNode, capabilities: readonly Capability[] = FAKE_CAPS) {
  return render(<QueryClientProvider client={makeClient(capabilities)}>{ui}</QueryClientProvider>);
}

function statusObservers(client: QueryClient): number {
  return client.getQueryCache().find({ queryKey: queryKeys.status })?.getObserversCount() ?? 0;
}

function metric(partial: Pick<Metric, 'value' | 'confidence'> & Partial<Metric>): Metric {
  return {
    source: 'fake/usage#req1',
    ...partial,
  };
}

/** `Metric` defaults to `Metric<number>`; structured fields need the generic. */
function structured<T>(value: T): Metric<T> {
  return { value, confidence: 'high', source: 'fake/usage#req1' };
}

describe('MetricCell', () => {
  afterEach(() => {
    cleanup();
  });

  test('high: formatted value, no marker, title equals source', () => {
    renderCell(
      <ConnectedMetricCell
        field="output"
        harness="fake"
        metric={metric({ value: 1234, confidence: 'high' })}
      />,
    );
    expect(screen.getByText('1.2k')).not.toBeNull();
    expect(screen.queryByText('~')).toBeNull();
    expect(screen.queryByText('?')).toBeNull();
    expect(screen.getByTitle('fake/usage#req1')).not.toBeNull();
  });

  test('medium: ~ prefix and title contains source and note', () => {
    renderCell(
      <ConnectedMetricCell
        field="output"
        harness="fake"
        metric={metric({
          value: 100,
          confidence: 'medium',
          note: 'derived: input - cached',
        })}
      />,
    );
    expect(screen.getByText('~')).not.toBeNull();
    expect(screen.getByText('100')).not.toBeNull();
    const el = screen.getByTitle(/fake\/usage#req1/);
    expect(el.getAttribute('title')).toContain('fake/usage#req1');
    expect(el.getAttribute('title')).toContain('derived: input - cached');
  });

  test('low: ? prefix', () => {
    renderCell(
      <ConnectedMetricCell
        field="output"
        harness="fake"
        metric={metric({ value: 10, confidence: 'low', note: 'estimated' })}
      />,
    );
    expect(screen.getByText('?')).not.toBeNull();
    expect(screen.getByText('10')).not.toBeNull();
  });

  test('absent without usage.cacheWrite: renders the visible text n/a, never an em dash', () => {
    // Driven through the real status query, not the capabilities prop.
    renderCell(<ConnectedMetricCell field="cacheWrite" harness="fake" />, ['usage.perCall']);
    expect(screen.getByText('n/a')).not.toBeNull();
    expect(screen.queryByText('—')).toBeNull();
    expect(screen.getByTitle('Not provided by Fake Harness')).not.toBeNull();
  });

  test('absent with the capability: renders the visible em dash, never n/a', () => {
    renderCell(<ConnectedMetricCell field="cacheWrite" harness="fake" />, ['usage.cacheWrite']);
    expect(screen.getByText('—')).not.toBeNull();
    expect(screen.queryByText('n/a')).toBeNull();
    expect(screen.getByTitle('Missing in this session')).not.toBeNull();
  });

  test('the two absence states never render the same visible text', () => {
    const notProvided = renderCell(<ConnectedMetricCell field="cacheWrite" harness="fake" />, [
      'usage.perCall',
    ]);
    const missing = renderCell(<ConnectedMetricCell field="cacheWrite" harness="fake" />, [
      'usage.cacheWrite',
    ]);
    const notProvidedText = notProvided.container.textContent;
    const missingText = missing.container.textContent;
    expect(notProvidedText).toBe('n/a');
    expect(missingText).toBe('—');
    // The whole point of the affordance: a sighted user tells them apart with
    // no hover and no colour. If a refactor collapses the branches, this fails.
    expect(notProvidedText).not.toBe(missingText);
  });

  test('both absence states share one WCAG-AA tone, so colour is never the signal', () => {
    // zinc-500 on white = 4.83:1, zinc-400 on zinc-950 = 7.56:1 (both >= 4.5:1).
    const tone = 'text-zinc-500 dark:text-zinc-400';
    const notProvided = renderCell(<ConnectedMetricCell field="cacheWrite" harness="fake" />, [
      'usage.perCall',
    ]);
    const missing = renderCell(<ConnectedMetricCell field="cacheWrite" harness="fake" />, [
      'usage.cacheWrite',
    ]);
    expect(notProvided.getByText('n/a').getAttribute('class')).toBe(tone);
    expect(missing.getByText('—').getAttribute('class')).toBe(tone);
  });

  test('custom format is applied', () => {
    renderCell(
      <ConnectedMetricCell
        field="output"
        harness="fake"
        metric={metric({ value: 42, confidence: 'high' })}
        format={(value) => `tok:${value}`}
      />,
    );
    expect(screen.getByText('tok:42')).not.toBeNull();
  });

  test('capabilities prop renders with no QueryClientProvider mounted', () => {
    // No provider anywhere in the tree: the cell must be provider-free.
    expect(() =>
      render(
        <MetricCell
          field="cacheWrite"
          harness="fake"
          capabilities={['usage.perCall']}
          displayName="Fake Harness"
        />,
      ),
    ).not.toThrow();
    expect(screen.getByText('n/a')).not.toBeNull();
    expect(screen.getByTitle('Not provided by Fake Harness')).not.toBeNull();
  });

  test('capabilities prop falls back to the harness id when no displayName is given', () => {
    render(<MetricCell field="cacheWrite" harness="fake" capabilities={['usage.perCall']} />);
    expect(screen.getByTitle('Not provided by fake')).not.toBeNull();
  });

  test('capabilities prop opens zero status query observers', () => {
    const client = makeClient();
    render(
      <QueryClientProvider client={client}>
        {Array.from({ length: 5 }, (_, i) => (
          <MetricCell
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static list
            key={i}
            field="cacheWrite"
            harness="fake"
            capabilities={['usage.cacheWrite']}
          />
        ))}
      </QueryClientProvider>,
    );
    expect(screen.getAllByText('—')).toHaveLength(5);
    expect(statusObservers(client)).toBe(0);
  });

  test('ConnectedMetricCell does subscribe to status (control for the above)', () => {
    const client = makeClient(['usage.cacheWrite']);
    render(
      <QueryClientProvider client={client}>
        <ConnectedMetricCell field="cacheWrite" harness="fake" />
      </QueryClientProvider>,
    );
    expect(statusObservers(client)).toBeGreaterThan(0);
  });
});

/**
 * BL-1. `defaultFormat` used to end in `String(value)`, which renders the
 * literal text `[object Object]` for any object-valued field — silently, with
 * no error and no failing test. `git` is object-valued in the domain model
 * (`packages/core/src/model/session.ts`: `{ branch?, commit?, repoName? }`) and
 * f6 puts git facts in the session-detail header.
 */
describe('MetricCell structured values', () => {
  afterEach(() => {
    cleanup();
  });

  test('field="git" renders the git facts, never [object Object]', () => {
    const view = render(
      <MetricCell
        field="git"
        harness="fake"
        capabilities={FAKE_CAPS}
        metric={structured({ repoName: 'scout', branch: 'main', commit: 'a1b2c3d4e5f60718' })}
      />,
    );
    expect(view.container.textContent).not.toContain('[object Object]');
    expect(view.container.textContent).toBe('scout · main · a1b2c3d');
  });

  test('field="git" renders only the parts the harness reported', () => {
    const view = render(
      <MetricCell
        field="git"
        harness="fake"
        capabilities={FAKE_CAPS}
        metric={structured({ branch: 'feature/x' })}
      />,
    );
    expect(view.container.textContent).toBe('feature/x');
  });

  /**
   * The value axis of the general guard below. Looping only `ALL_FIELD_KEYS`
   * probes each field at exactly one shape, so a leak scoped to a shape the
   * loop never supplies still ships green — `if (field === 'title' &&
   * Array.isArray(value)) return String(value);` was the demonstrated escape.
   * The guard therefore runs the full product of both axes (ADV-1).
   */
  const STRUCTURED_SHAPES: ReadonlyArray<{ name: string; value: unknown; expected: string }> = [
    {
      name: 'flat object',
      value: { unexpected: 'shape', n: 1 },
      expected: '{"unexpected":"shape","n":1}',
    },
    { name: 'array holding an object', value: [{ a: 1 }, 2], expected: '[{"a":1},2]' },
    { name: 'one-element array', value: [{ a: 1 }], expected: '[{"a":1}]' },
    { name: 'nested object', value: { a: { b: 1 } }, expected: '{"a":{"b":1}}' },
    { name: 'no-keys object', value: {}, expected: '(unformatted)' },
    { name: 'Map', value: new Map([['a', 1]]), expected: '(unformatted)' },
    { name: 'Set', value: new Set([1]), expected: '(unformatted)' },
  ];

  /**
   * The general guard: no field in the union may fall through to a stringified
   * object, for any of the shapes above. `ALL_FIELD_KEYS` derives `FieldKey`,
   * so a field added tomorrow enters this loop automatically — and now enters
   * it once per shape rather than once.
   */
  test('no field renders a stringified object for any unrecognised structured value', () => {
    for (const field of ALL_FIELD_KEYS) {
      for (const shape of STRUCTURED_SHAPES) {
        const view = render(
          <MetricCell
            field={field}
            harness="fake"
            capabilities={FAKE_CAPS}
            metric={structured(shape.value)}
          />,
        );
        // Labelled so a failure names the exact cell of the product that leaked.
        const actual = `${field}/${shape.name} -> ${view.container.textContent ?? ''}`;
        // `[object ` catches every default `Object.prototype.toString` form
        // (`[object Map]`, `[object Promise]`, …), not just `[object Object]`.
        expect(actual).not.toContain('[object ');
        // Markup too, so a leak into an attribute (the provenance tooltip) is
        // caught as well as one into the visible text.
        expect(`${field}/${shape.name} -> ${view.container.innerHTML}`).not.toContain('[object ');
        // Honest fallback: show what the cell actually holds.
        expect(actual).toBe(`${field}/${shape.name} -> ${shape.expected}`);
        view.unmount();
      }
    }
  });

  test('an array value is rendered as its elements, not as a comma-joined string', () => {
    const view = render(
      <MetricCell
        field="model"
        harness="fake"
        capabilities={FAKE_CAPS}
        metric={structured([{ a: 1 }, 2])}
      />,
    );
    expect(view.container.textContent).not.toContain('[object Object]');
    expect(view.container.textContent).toBe('[{"a":1},2]');
  });

  test('a value JSON cannot describe degrades to a visible placeholder', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic.self = cyclic;
    const empty = render(
      <MetricCell field="title" harness="fake" capabilities={FAKE_CAPS} metric={structured({})} />,
    );
    expect(empty.container.textContent).toBe('(unformatted)');
    const loop = render(
      <MetricCell
        field="title"
        harness="fake"
        capabilities={FAKE_CAPS}
        metric={structured(cyclic)}
      />,
    );
    expect(loop.container.textContent).toBe('(unformatted)');
    expect(loop.container.textContent).not.toContain('[object Object]');
  });

  /**
   * ADV-2. Every type guard inside `defaultFormat` reads properties off the
   * value, and a property read can throw — which the pre-fix `String(value)`
   * fallback could not. Nothing above a cell is an error boundary, so a
   * hostile or exotic value must degrade to the visible marker rather than
   * take the surrounding tree down. The whole routing decision is guarded, not
   * just `JSON.stringify`, so this holds for each formatter's own guard.
   */
  test('field="git" survives a property getter that throws', () => {
    const hostile = {
      get branch(): string {
        throw new Error('branch getter exploded');
      },
    };
    const view = render(
      <MetricCell
        field="git"
        harness="fake"
        capabilities={FAKE_CAPS}
        metric={structured(hostile)}
      />,
    );
    expect(view.container.textContent).toBe('(unformatted)');
  });

  test('field="cost" survives a property getter that throws', () => {
    const hostile = {
      get usd(): number {
        throw new Error('usd getter exploded');
      },
    };
    const view = render(
      <MetricCell
        field="cost"
        harness="fake"
        capabilities={FAKE_CAPS}
        metric={structured(hostile)}
      />,
    );
    expect(view.container.textContent).toBe('(unformatted)');
  });

  test('a toJSON that throws degrades to the visible placeholder', () => {
    const hostile = {
      toJSON(): never {
        throw new Error('toJSON exploded');
      },
    };
    const view = render(
      <MetricCell
        field="git"
        harness="fake"
        capabilities={FAKE_CAPS}
        metric={structured(hostile)}
      />,
    );
    expect(view.container.textContent).toBe('(unformatted)');
  });
});

/**
 * BL-2. `MetricCell` used to be a dispatcher returning two different component
 * types (`MetricCellView` vs `ConnectedMetricCell`), so flipping one mounted
 * instance between prop mode and hook mode changed the component type and
 * remounted it. The natural bulk-caller pattern — hoist
 * `useAdapterCapabilities` and pass the result down — hands every cell
 * `undefined` on the first render and a defined array once `['status']`
 * resolves, i.e. every cell in a 370-row view flipped at once.
 */
describe('MetricCell mode flip', () => {
  afterEach(() => {
    cleanup();
  });

  test('flipping capabilities from undefined to a list keeps the same DOM node', () => {
    // Status is seeded so that the pre-fix hook path resolved to the SAME
    // rendered text ('—') as the prop path does for `undefined`: the only
    // thing this test can see is the remount itself.
    const client = makeClient(['usage.cacheWrite']);
    const cell = (capabilities: readonly Capability[] | undefined) => (
      <QueryClientProvider client={client}>
        <MetricCell
          field="cacheWrite"
          harness="fake"
          capabilities={capabilities}
          displayName="Fake Harness"
        />
      </QueryClientProvider>
    );

    const view = render(cell(undefined));
    const before = view.container.querySelector('span[title]');
    expect(view.container.textContent).toBe('—');
    expect(before).not.toBeNull();
    expect(statusObservers(client)).toBe(0);

    view.rerender(cell(['usage.perCall']));
    expect(view.container.textContent).toBe('n/a');
    expect(view.container.querySelector('span[title]')).toBe(before);
    expect(statusObservers(client)).toBe(0);
  });

  test('a keyed remount does change the node (control: the check above can fail)', () => {
    const view = render(
      <MetricCell key="a" field="cacheWrite" harness="fake" capabilities={undefined} />,
    );
    const before = view.container.querySelector('span[title]');
    view.rerender(
      <MetricCell key="b" field="cacheWrite" harness="fake" capabilities={undefined} />,
    );
    expect(view.container.querySelector('span[title]')).not.toBe(before);
  });
});
