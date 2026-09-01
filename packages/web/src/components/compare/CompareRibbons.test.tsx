import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { SessionTrace, TraceStep } from '../../api/types';

/**
 * `useTraces` is mocked entirely (SessionDetail.test.tsx's own pattern for
 * `../../api/queries`) so this suite exercises `CompareRibbons`' own
 * shared-domain wiring without a `QueryClientProvider` or real network.
 */
let traceResults: Array<{ data?: SessionTrace }> = [];

vi.mock('../../api/queries', () => ({
  useTraces: () => traceResults,
}));

// Static import after the mock declaration is fine here (unlike the fetch-stub
// case in lessons.md's vitest-fetch-stub-loses-to-esm-import-hoisting note):
// nothing in this file performs real network I/O, `useTraces` itself is the
// only seam, and it is fully replaced above.
const { CompareRibbons } = await import('./CompareRibbons');

afterEach(() => {
  cleanup();
  traceResults = [];
});

function trace(steps: TraceStep[]): SessionTrace {
  return {
    id: 'fake',
    steps,
    models: ['claude-x'],
    axis: { steps: steps.length },
    totals: { uncachedInput: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoningOutput: 0 },
  };
}

const call = (i: number) =>
  ({
    kind: 'call',
    i,
    model: 'claude-x',
    cum: { uncachedInput: 10, cachedInput: 0, cacheWrite: 0, output: 5, reasoningOutput: 0 },
    blocks: { text: 1, thinking: 0, toolUse: 0 },
  }) as TraceStep;

describe('CompareRibbons — D33 shared step-index axis', () => {
  test('renders one ribbon per row, none when the tray is empty', () => {
    traceResults = [];
    const view = render(<CompareRibbons rows={[]} />);
    expect(view.container.querySelector('svg')).toBeNull();
  });

  test('two sessions with different step counts render blocks for the same step index at the SAME pixel x — a real shared scale, not independent auto-scaling', () => {
    traceResults = [
      { data: trace([call(0), call(1)]) },
      { data: trace([call(0), call(1), call(2), call(3), call(4)]) },
    ];

    const view = render(
      <CompareRibbons
        rows={[
          { id: 'short', label: 'Short session' },
          { id: 'long', label: 'Long session' },
        ]}
        width={480}
      />,
    );

    const svgs = view.container.querySelectorAll('svg');
    expect(svgs.length).toBe(2);

    // Step 1 exists in both traces. If each ribbon scaled to its own max
    // index independently, step 1 would land at a different x in the short
    // ribbon (max index 1) than in the long one (max index 4). A shared
    // domain means it lands at the identical x in both.
    const shortStep1 = svgs[0]?.querySelector('rect[data-step-kind="model"][x]');
    const longStep1 = svgs[1]?.querySelector('rect[data-step-kind="model"][x]');
    expect(shortStep1).not.toBeNull();
    expect(longStep1).not.toBeNull();

    const shortRects = Array.from(svgs[0]?.querySelectorAll('rect[data-step-kind="model"]') ?? []);
    const longRects = Array.from(svgs[1]?.querySelectorAll('rect[data-step-kind="model"]') ?? []);
    // Both ribbons' 2nd block (index 1) should share the same x.
    expect(shortRects[1]?.getAttribute('x')).toBe(longRects[1]?.getAttribute('x'));
    // And the short ribbon's LAST block (its own max, index 1) must sit well
    // short of the right edge, because the shared domain is 4 (the long
    // session's max), not 1 -- proof the short ribbon did not renormalize to
    // its own steps.
    const shortLastX = Number(shortRects[1]?.getAttribute('x'));
    const longLastX = Number(longRects[longRects.length - 1]?.getAttribute('x'));
    expect(shortLastX).toBeLessThan(longLastX);

    // The shared domain the component computed is exposed for this exact
    // assertion rather than only inferred from pixel positions.
    expect(
      view.container
        .querySelector('[data-shared-domain-max]')
        ?.getAttribute('data-shared-domain-max'),
    ).toBe('4');
  });

  test('a session with no trace data yet still renders its row with the explicit empty ribbon state', () => {
    traceResults = [{ data: trace([call(0), call(1), call(2)]) }, { data: undefined }];

    const view = render(
      <CompareRibbons
        rows={[
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ]}
      />,
    );

    expect(view.container.querySelectorAll('svg').length).toBe(1);
    expect(view.getByText?.('No trace data') ?? view.container.textContent).toBeTruthy();
  });

  test('each row shows its session label', () => {
    traceResults = [{ data: trace([call(0)]) }];
    const view = render(<CompareRibbons rows={[{ id: 'x', label: 'my-session-label' }]} />);
    expect(view.container.textContent).toContain('my-session-label');
  });
});
