import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { CountsPanel } from './CountsPanel';
import { FULL_CAPS, makeRollup, makeSummary, metric } from './fixtures';

const summary = makeSummary({
  id: 'fake:root',
  counts: { turns: metric(7), apiCalls: metric(11), toolCalls: metric(13), compactions: metric(2) },
});

const rollup = makeRollup({
  id: 'fake:root',
  exclusive: { usage: {}, counts: summary.counts },
  inclusive: {
    usage: {},
    counts: {
      apiCalls: metric(41),
      toolCalls: metric(43),
      compactions: metric(5),
      subagents: metric(3),
    },
  },
  descendants: 4,
});

function rowOf(label: string): HTMLElement {
  const row = screen.getByText(label).closest('tr');
  if (!row) throw new Error(`no row for ${label}`);
  return row;
}

describe('CountsPanel', () => {
  afterEach(() => {
    cleanup();
  });

  test('rolled-up counts show both columns', () => {
    render(
      <CountsPanel
        summary={summary}
        rollup={rollup}
        capabilities={FULL_CAPS}
        displayName="Fake Harness"
      />,
    );
    expect(within(rowOf('API calls')).getByText('11')).not.toBeNull();
    expect(within(rowOf('API calls')).getByText('41')).not.toBeNull();
    expect(within(rowOf('Tool calls')).getByText('13')).not.toBeNull();
    expect(within(rowOf('Tool calls')).getByText('43')).not.toBeNull();
  });

  test('turns are exclusive only and say so instead of showing an absence glyph', () => {
    render(
      <CountsPanel
        summary={summary}
        rollup={rollup}
        capabilities={FULL_CAPS}
        displayName="Fake Harness"
      />,
    );
    const row = rowOf('Turns');
    expect(within(row).getByText('7')).not.toBeNull();
    expect(within(row).getByText('not rolled up')).not.toBeNull();
    expect(within(row).queryByText('—')).toBeNull();
    expect(within(row).queryByText('n/a')).toBeNull();
  });

  test('subagents and descendants come from the rollup, never from the session alone', () => {
    render(
      <CountsPanel
        summary={summary}
        rollup={rollup}
        capabilities={FULL_CAPS}
        displayName="Fake Harness"
      />,
    );
    expect(within(rowOf('Subagents')).getByText('3')).not.toBeNull();
    expect(within(rowOf('Subagents')).getByText('rollup only')).not.toBeNull();
    expect(within(rowOf('Descendants')).getByText('4')).not.toBeNull();
  });

  test('without a rollup the inclusive figures degrade instead of inventing zeros', () => {
    render(
      <CountsPanel
        summary={summary}
        rollup={undefined}
        capabilities={FULL_CAPS}
        displayName="Fake Harness"
      />,
    );
    expect(within(rowOf('API calls')).getByText('—')).not.toBeNull();
    expect(within(rowOf('Descendants')).getByText('unknown')).not.toBeNull();
  });

  test('with no series given, the trend sparkline renders its own empty state', () => {
    render(
      <CountsPanel
        summary={summary}
        rollup={rollup}
        capabilities={FULL_CAPS}
        displayName="Fake Harness"
      />,
    );
    expect(screen.getByText('No activity')).not.toBeNull();
  });

  test('a real series feeds the trend sparkline instead of the empty state', () => {
    render(
      <CountsPanel
        summary={summary}
        rollup={rollup}
        capabilities={FULL_CAPS}
        displayName="Fake Harness"
        series={[100, 400, 250]}
      />,
    );
    expect(screen.queryByText('No activity')).toBeNull();
    expect(screen.getByRole('img', { name: 'Recent token-volume trend' })).not.toBeNull();
  });
});
