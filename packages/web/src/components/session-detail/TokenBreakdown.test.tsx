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
    for (const label of [
      'Uncached input',
      'Cached input',
      'Cache write',
      'Output',
      'Reasoning output',
      'Total input',
    ]) {
      expect(screen.getByText(label)).not.toBeNull();
    }
    expect(screen.getByText('1.0k')).not.toBeNull();
    expect(screen.getByText('11.0k')).not.toBeNull();
    expect(screen.getByText('16.0k')).not.toBeNull();
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
});
