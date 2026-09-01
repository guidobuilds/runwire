import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { setInclusive } from '../../state/prefs';
import { FULL_CAPS, makeRollup, makeSummary, metric } from './fixtures';
import { TokenBreakdown } from './TokenBreakdown';

const DERIVED_NOTE = 'derived: input - cached';

const summary = makeSummary({
  id: 'fake:abcdef0123',
  usage: {
    uncachedInput: metric(1000),
    cachedInput: metric(2000, { confidence: 'medium', note: DERIVED_NOTE }),
    cacheWrite: metric(3000),
    output: metric(4000),
    reasoningOutput: metric(5000),
    totalInput: metric(6000),
  },
});

const rollup = makeRollup({
  id: 'fake:abcdef0123',
  exclusive: { usage: summary.usage, counts: {} },
  inclusive: {
    usage: {
      uncachedInput: metric(11_000),
      // Same note and source as the exclusive metric: the notes list must fold
      // the pair into one line rather than repeating it per column.
      cachedInput: metric(12_000, { confidence: 'medium', note: DERIVED_NOTE }),
      cacheWrite: metric(13_000),
      output: metric(14_000),
      reasoningOutput: metric(15_000),
      totalInput: metric(16_000),
    },
    counts: { subagents: metric(2) },
  },
  descendants: 2,
});

function renderBreakdown() {
  return render(
    <TokenBreakdown
      summary={summary}
      rollup={rollup}
      capabilities={FULL_CAPS}
      displayName="Fake Harness"
    />,
  );
}

describe('TokenBreakdown', () => {
  afterEach(() => {
    cleanup();
    setInclusive(true);
  });

  test('renders the six usage rows with exclusive and inclusive values', () => {
    renderBreakdown();
    // Scoped to the table: `TokenCompositionBar`'s own legend (added alongside
    // the table by this same component) repeats these row labels and some of
    // these formatted values, so an unscoped `screen.getByText` would now find
    // more than one match for labels/values the two renderings share.
    const table = within(screen.getByRole('table'));
    for (const label of [
      'Uncached input',
      'Cached input',
      'Cache write',
      'Output',
      'Reasoning output',
      'Total input',
    ]) {
      expect(table.getByText(label)).not.toBeNull();
    }
    expect(table.getByText('1.0k')).not.toBeNull();
    expect(table.getByText('11.0k')).not.toBeNull();
    expect(table.getByText('16.0k')).not.toBeNull();
  });

  test('the inclusive column is marked active while the Inclusive preference is on', () => {
    renderBreakdown();
    const inclusive = screen.getByRole('columnheader', { name: /Inclusive/u });
    const exclusive = screen.getByRole('columnheader', { name: /Exclusive/u });
    expect(within(inclusive).getByText('active')).not.toBeNull();
    expect(within(exclusive).queryByText('active')).toBeNull();
  });

  test('turning the preference off moves the active marker to the exclusive column', () => {
    setInclusive(false);
    renderBreakdown();
    const inclusive = screen.getByRole('columnheader', { name: /Inclusive/u });
    const exclusive = screen.getByRole('columnheader', { name: /Exclusive/u });
    expect(within(exclusive).getByText('active')).not.toBeNull();
    expect(within(inclusive).queryByText('active')).toBeNull();
  });

  test('a note reported by both columns is listed once, with its grade and source', () => {
    renderBreakdown();
    const lines = screen.getAllByText(new RegExp(DERIVED_NOTE, 'u'));
    expect(lines).toHaveLength(1);
    const text = lines[0]?.textContent ?? '';
    expect(text).toContain('medium confidence');
    expect(text).toContain('fake/usage#req1');
  });

  test('a medium-confidence value keeps its on-screen ~ marker', () => {
    renderBreakdown();
    expect(screen.getAllByText('~').length).toBeGreaterThanOrEqual(2);
  });

  test('the composition chart is present alongside the table when usage data exists', () => {
    renderBreakdown();
    expect(screen.getByRole('img', { name: 'Token composition' })).not.toBeNull();
  });

  test('the big total reflects the sum of the active column’s present metrics', () => {
    renderBreakdown();
    // Inclusive is active by default: 11_000 + 12_000 + 13_000 + 14_000 + 15_000
    // (totalInput's 16_000 is excluded — it is derived, not an independent field).
    expect(screen.getByRole('status', { name: /Total \(inclusive\)/u })).not.toBeNull();
    expect(screen.getByText('Total (inclusive): 65.0k')).not.toBeNull();
  });

  test('toggling the preference changes which usage feeds the chart and the total', () => {
    setInclusive(false);
    renderBreakdown();
    // Exclusive is active now: 1000 + 2000 + 3000 + 4000 + 5000 (totalInput's 6000 excluded).
    expect(screen.getByText('Total (exclusive): 15.0k')).not.toBeNull();
    expect(screen.queryByText(/Total \(inclusive\)/u)).toBeNull();
  });

  test('an empty active side shows no fabricated total, just the chart’s own empty state', () => {
    const emptySummary = makeSummary({ id: 'fake:empty0000', usage: {} });
    const emptyRollup = makeRollup({
      id: 'fake:empty0000',
      exclusive: { usage: {}, counts: {} },
      inclusive: { usage: {}, counts: { subagents: metric(0) } },
    });
    render(
      <TokenBreakdown
        summary={emptySummary}
        rollup={emptyRollup}
        capabilities={FULL_CAPS}
        displayName="Fake Harness"
      />,
    );
    expect(screen.getByText('No usage recorded')).not.toBeNull();
    expect(screen.queryByText(/^Total \(/u)).toBeNull();
    expect(screen.queryByText(/NaN/u)).toBeNull();
  });
});
