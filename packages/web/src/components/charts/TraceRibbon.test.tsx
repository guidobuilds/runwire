import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import type { SessionTrace, TraceStep } from '../../api/types';
import { KIND_COLOR } from './chart-theme';
import { TraceRibbon } from './TraceRibbon';

afterEach(() => cleanup());

function trace(steps: TraceStep[], overrides: Partial<SessionTrace> = {}): SessionTrace {
  return {
    id: 'fake-session',
    steps,
    models: ['claude-x'],
    axis: { steps: steps.length },
    totals: { uncachedInput: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoningOutput: 0 },
    ...overrides,
  };
}

const call = (i: number, cum: Partial<TraceStep & { kind: 'call' }>['cum'] = undefined) =>
  ({
    kind: 'call',
    i,
    model: 'claude-x',
    cum: cum ?? { uncachedInput: 10, cachedInput: 0, cacheWrite: 0, output: 5, reasoningOutput: 0 },
    blocks: { text: 1, thinking: 0, toolUse: 0 },
  }) as TraceStep;

const tool = (i: number, category: string, extra: Record<string, unknown> = {}) =>
  ({ kind: 'tool', i, category, name: `tool-${i}`, ...extra }) as TraceStep;

const harness = (i: number) => ({ kind: 'harness', i, name: `hook-${i}` }) as TraceStep;
const turn = (i: number) => ({ kind: 'turn', i }) as TraceStep;
const compaction = (i: number) => ({ kind: 'compaction', i }) as TraceStep;
const modelChange = (i: number) => ({ kind: 'model-change', i, from: 'a', to: 'b' }) as TraceStep;
const modeChange = (i: number) => ({ kind: 'mode-change', i, to: 'plan' }) as TraceStep;

describe('empty / unreported states', () => {
  test('trace undefined renders the explicit empty state, not a blank chart', () => {
    const view = render(<TraceRibbon trace={undefined} />);
    expect(screen.getByText('No trace data')).not.toBeNull();
    expect(view.container.querySelector('svg')).toBeNull();
  });

  test('zero-step trace renders the same explicit empty state', () => {
    render(<TraceRibbon trace={trace([])} />);
    expect(screen.getByText('No trace data')).not.toBeNull();
    expect(screen.getByRole('img', { name: 'No trace data' })).not.toBeNull();
  });

  test('a trace with steps but zero call steps shows an explicit "no usage" note instead of a degenerate flat line', () => {
    const view = render(<TraceRibbon trace={trace([tool(0, 'read'), harness(1)])} />);
    expect(screen.getByText('No token usage reported')).not.toBeNull();
    // No cumulative-line circles were drawn (no data to plot).
    expect(view.container.querySelectorAll('circle[data-cumulative-for]').length).toBe(0);
  });
});

describe('data -> mark mapping', () => {
  test('one block per call/tool/harness/compaction step; turn/model-change/mode-change steps are excluded from the block row', () => {
    const steps = [
      call(0),
      tool(1, 'read'),
      turn(2),
      tool(3, 'write'),
      harness(4),
      compaction(5),
      modelChange(6),
      modeChange(7),
    ];
    const view = render(<TraceRibbon trace={trace(steps)} />);
    const blocks = view.container.querySelectorAll('rect[data-step-kind]');
    // call, tool(read), tool(write), harness, compaction = 5 blocks.
    expect(blocks.length).toBe(5);
    const kinds = Array.from(blocks).map((b) => b.getAttribute('data-step-kind'));
    expect(kinds).toEqual(['model', 'read', 'write', 'harness-event', 'prose']);
  });

  test('blocks are colored via chart-theme KIND_COLOR var() references, never a literal hex', () => {
    const view = render(<TraceRibbon trace={trace([call(0), tool(1, 'exec')])} />);
    const blocks = view.container.querySelectorAll('rect[data-step-kind]');
    expect(blocks[0]?.getAttribute('fill')).toBe(KIND_COLOR.model);
    expect(blocks[1]?.getAttribute('fill')).toBe(KIND_COLOR.exec);
    for (const b of Array.from(blocks)) {
      expect(b.getAttribute('fill')).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    }
  });

  test('a tool category of "other" falls back to the prose bucket', () => {
    const view = render(<TraceRibbon trace={trace([tool(0, 'other')])} />);
    const block = view.container.querySelector('rect[data-step-kind]');
    expect(block?.getAttribute('data-step-kind')).toBe('prose');
    expect(block?.getAttribute('fill')).toBe(KIND_COLOR.prose);
  });

  test('a failed tool call is colored kind-error, overriding its category', () => {
    const view = render(<TraceRibbon trace={trace([tool(0, 'read', { error: true })])} />);
    const block = view.container.querySelector('rect[data-step-kind]');
    expect(block?.getAttribute('data-step-kind')).toBe('error');
    expect(block?.getAttribute('fill')).toBe(KIND_COLOR.error);
  });

  test('block x position follows step.i via the shared linear scale, in step order', () => {
    const view = render(
      <TraceRibbon trace={trace([tool(0, 'read'), tool(3, 'write')])} width={480} />,
    );
    const blocks = view.container.querySelectorAll('rect[data-step-kind]');
    const x0 = Number(blocks[0]?.getAttribute('x'));
    const x1 = Number(blocks[1]?.getAttribute('x'));
    // step.i=3 is further along the domain [0, 3] than step.i=0.
    expect(x1).toBeGreaterThan(x0);
  });

  test('turn steps produce boundary tick marks, not blocks', () => {
    const view = render(
      <TraceRibbon trace={trace([tool(0, 'read'), turn(1), tool(2, 'write')])} />,
    );
    const ticks = view.container.querySelectorAll('line[data-turn-boundary]');
    expect(ticks.length).toBe(1);
    expect(ticks[0]?.getAttribute('data-turn-boundary')).toBe('1');
  });
});

describe('cumulative token line', () => {
  test('one point per call step, plotted from the sum of cum fields (no single cumulativeTokens field exists on the real type)', () => {
    const steps = [
      call(0, { uncachedInput: 10, cachedInput: 0, cacheWrite: 0, output: 0, reasoningOutput: 0 }),
      call(1, { uncachedInput: 10, cachedInput: 5, cacheWrite: 0, output: 5, reasoningOutput: 0 }),
    ];
    const view = render(<TraceRibbon trace={trace(steps)} />);
    const points = view.container.querySelectorAll('circle[data-cumulative-for]');
    expect(points.length).toBe(2);
    expect(points[0]?.querySelector('title')?.textContent).toContain('10 cumulative tokens');
    expect(points[1]?.querySelector('title')?.textContent).toContain('20 cumulative tokens');
  });
});

describe('confidence (via SessionTrace.truncated, the one real signal available)', () => {
  test('a non-truncated trace renders at full opacity with no ConfidenceDot', () => {
    const view = render(<TraceRibbon trace={trace([call(0)])} />);
    expect(screen.queryByText(/truncated/i)).toBeNull();
    const rect = view.container.querySelector('rect[data-step-kind]');
    expect(rect?.getAttribute('opacity')).toBe('1');
  });

  test('a truncated trace renders reduced-opacity blocks/line plus a ConfidenceDot in the header', () => {
    const view = render(<TraceRibbon trace={trace([call(0)], { truncated: true })} />);
    expect(screen.getByText(/truncated/i)).not.toBeNull();
    expect(screen.getByRole('img', { name: 'medium confidence' })).not.toBeNull();
    const rect = view.container.querySelector('rect[data-step-kind]');
    expect(rect?.getAttribute('opacity')).toBe('0.6');
  });
});

describe('legend + exact numbers', () => {
  test('legend lists each present kind with its exact count, reachable as text', () => {
    render(<TraceRibbon trace={trace([call(0), tool(1, 'read'), tool(2, 'read')])} />);
    expect(screen.getByText('Model call (1)')).not.toBeNull();
    expect(screen.getByText('Read (2)')).not.toBeNull();
  });

  test('every block exposes its exact detail via a native SVG <title> (no hover needed to query it)', () => {
    const view = render(<TraceRibbon trace={trace([tool(0, 'read')])} />);
    const rect = view.container.querySelector('rect[data-step-kind]');
    expect(rect?.querySelector('title')?.textContent).toBe('Read: tool-0');
  });
});

describe('compact prop', () => {
  test('hides the legend and the turn-boundary row, and reduces block height', () => {
    const steps = [call(0), tool(1, 'read'), turn(2)];
    const normal = render(<TraceRibbon trace={trace(steps)} />);
    const normalBlockHeight = normal.container
      .querySelector('rect[data-step-kind]')
      ?.getAttribute('height');
    const normalTicks = normal.container.querySelectorAll('line[data-turn-boundary]').length;
    cleanup();

    const compact = render(<TraceRibbon trace={trace(steps)} compact />);
    const compactBlockHeight = compact.container
      .querySelector('rect[data-step-kind]')
      ?.getAttribute('height');
    const compactTicks = compact.container.querySelectorAll('line[data-turn-boundary]').length;

    expect(normalTicks).toBe(1);
    expect(compactTicks).toBe(0);
    expect(Number(compactBlockHeight)).toBeLessThan(Number(normalBlockHeight));
    // Legend text present in normal mode, absent in compact.
    expect(screen.queryByText(/Read \(1\)/)).toBeNull();
  });
});
