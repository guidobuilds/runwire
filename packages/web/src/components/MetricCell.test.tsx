import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { queryKeys } from '../api/queries';
import type { Capability, Metric, StatusResponse } from '../api/types';
import { MetricCell } from './MetricCell';

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

describe('MetricCell', () => {
  afterEach(() => {
    cleanup();
  });

  test('high: formatted value, no marker, title equals source', () => {
    renderCell(
      <MetricCell
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
      <MetricCell
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
      <MetricCell
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
    renderCell(<MetricCell field="cacheWrite" harness="fake" />, ['usage.perCall']);
    expect(screen.getByText('n/a')).not.toBeNull();
    expect(screen.queryByText('—')).toBeNull();
    expect(screen.getByTitle('Not provided by Fake Harness')).not.toBeNull();
  });

  test('absent with the capability: renders the visible em dash, never n/a', () => {
    renderCell(<MetricCell field="cacheWrite" harness="fake" />, ['usage.cacheWrite']);
    expect(screen.getByText('—')).not.toBeNull();
    expect(screen.queryByText('n/a')).toBeNull();
    expect(screen.getByTitle('Missing in this session')).not.toBeNull();
  });

  test('the two absence states never render the same visible text', () => {
    const notProvided = renderCell(<MetricCell field="cacheWrite" harness="fake" />, [
      'usage.perCall',
    ]);
    const missing = renderCell(<MetricCell field="cacheWrite" harness="fake" />, [
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
    const notProvided = renderCell(<MetricCell field="cacheWrite" harness="fake" />, [
      'usage.perCall',
    ]);
    const missing = renderCell(<MetricCell field="cacheWrite" harness="fake" />, [
      'usage.cacheWrite',
    ]);
    expect(notProvided.getByText('n/a').getAttribute('class')).toBe(tone);
    expect(missing.getByText('—').getAttribute('class')).toBe(tone);
  });

  test('custom format is applied', () => {
    renderCell(
      <MetricCell
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

  test('without the prop the cell does subscribe to status (control for the above)', () => {
    const client = makeClient(['usage.cacheWrite']);
    render(
      <QueryClientProvider client={client}>
        <MetricCell field="cacheWrite" harness="fake" />
      </QueryClientProvider>,
    );
    expect(statusObservers(client)).toBeGreaterThan(0);
  });
});
