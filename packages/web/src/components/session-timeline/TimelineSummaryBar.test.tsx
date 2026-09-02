import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { FULL_CAPS, makeRollup, makeSummary, metric } from '../session-detail/fixtures';
import { TimelineSummaryBar } from './TimelineSummaryBar';

afterEach(() => cleanup());

const SUMMARY = makeSummary({
  id: 'fake:root',
  timing: { durationMs: metric(65_000) },
});

describe('numbers reused from already-rendered rollup/summary data', () => {
  test('duration, total tokens and tool calls come from rollup.inclusive, never re-derived', () => {
    const rollup = makeRollup({
      id: 'fake:root',
      inclusive: {
        usage: { output: metric(9000), uncachedInput: metric(1000) },
        counts: { toolCalls: metric(12), subagents: metric(1) },
      },
      descendants: 1,
    });
    render(
      <TimelineSummaryBar
        summary={SUMMARY}
        rollup={rollup}
        agentCount={2}
        mcpCallCount={3}
        capabilities={FULL_CAPS}
        displayName="Fake Harness"
      />,
    );
    expect(screen.getByText('1 min')).not.toBeNull();
    // 9000 + 1000 = 10000, TokenBreakdown's own `sumPresentUsage` sum.
    expect(screen.getByText('10.0k')).not.toBeNull();
    expect(screen.getByText('12')).not.toBeNull();
  });

  test('agent count is exactly subtree.summaries.length as supplied by the caller', () => {
    const rollup = makeRollup({ id: 'fake:root' });
    render(
      <TimelineSummaryBar
        summary={SUMMARY}
        rollup={rollup}
        agentCount={5}
        mcpCallCount={0}
        capabilities={FULL_CAPS}
        displayName="Fake Harness"
      />,
    );
    expect(screen.getByText('5')).not.toBeNull();
  });

  test('mcp call count is the one genuinely new number, rendered as supplied by the caller', () => {
    const rollup = makeRollup({ id: 'fake:root' });
    render(
      <TimelineSummaryBar
        summary={SUMMARY}
        rollup={rollup}
        agentCount={1}
        mcpCallCount={7}
        capabilities={FULL_CAPS}
        displayName="Fake Harness"
      />,
    );
    expect(screen.getByText('7')).not.toBeNull();
  });
});

describe('reset-zoom control (f9-t3)', () => {
  test('does not render when isZoomed is omitted (predates f9, every other test in this file)', () => {
    render(
      <TimelineSummaryBar
        summary={SUMMARY}
        rollup={makeRollup({ id: 'fake:root' })}
        agentCount={1}
        mcpCallCount={0}
        capabilities={FULL_CAPS}
        displayName="Fake Harness"
      />,
    );
    expect(screen.queryByRole('button', { name: 'Reset zoom' })).toBeNull();
  });

  test('does not render when isZoomed is false', () => {
    render(
      <TimelineSummaryBar
        summary={SUMMARY}
        rollup={makeRollup({ id: 'fake:root' })}
        agentCount={1}
        mcpCallCount={0}
        capabilities={FULL_CAPS}
        displayName="Fake Harness"
        isZoomed={false}
        onResetZoom={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Reset zoom' })).toBeNull();
  });

  test('renders and calls onResetZoom when isZoomed is true', () => {
    const onResetZoom = vi.fn();
    render(
      <TimelineSummaryBar
        summary={SUMMARY}
        rollup={makeRollup({ id: 'fake:root' })}
        agentCount={1}
        mcpCallCount={0}
        capabilities={FULL_CAPS}
        displayName="Fake Harness"
        isZoomed={true}
        onResetZoom={onResetZoom}
      />,
    );
    const button = screen.getByRole('button', { name: 'Reset zoom' });
    fireEvent.click(button);
    expect(onResetZoom).toHaveBeenCalledTimes(1);
  });
});

describe('absence', () => {
  test('a session with no rollup at all shows the absence glyph for duration/tokens/tool calls, not invented zeros', () => {
    render(
      <TimelineSummaryBar
        summary={makeSummary({ id: 'fake:root', timing: {} })}
        rollup={undefined}
        agentCount={1}
        mcpCallCount={0}
        capabilities={FULL_CAPS}
        displayName="Fake Harness"
      />,
    );
    // Duration + total tokens + tool calls all missing -> at least 3 `—`
    // glyphs. `mcpCallCount={0}` legitimately renders literal `0` — that
    // stat is a real caller-supplied count, not backed by absence semantics,
    // so a genuine zero is expected there and is not asserted against here.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });
});
