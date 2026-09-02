import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { scaleLinear } from '@visx/scale';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { SessionTrace, TraceStep } from '../../api/types';
import { makeRollup, makeSummary, metric } from '../session-detail/fixtures';
import { SessionTimeline } from './SessionTimeline';
import { LABEL_GUTTER_PX } from './TimelineContext';

const shared = vi.hoisted(() => ({
  sessionResult: { isPending: false, error: null, data: undefined } as Record<string, unknown>,
  traceResult: { isPending: false, error: null, data: undefined } as Record<string, unknown>,
  tracesById: {} as Record<string, { isPending: boolean; error: null; data: unknown }>,
  caps: [
    'usage.perCall',
    'usage.cumulative',
    'usage.cacheWrite',
    'usage.reasoning',
    'timing',
    'model',
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
  ] as string[],
}));

vi.mock('../../api/queries', () => ({
  useSession: () => shared.sessionResult,
  useTrace: () => shared.traceResult,
  useTraces: (ids: readonly string[]) =>
    ids.map((id) => shared.tracesById[id] ?? { isPending: false, error: null, data: undefined }),
  useAdapterCapabilities: () => shared.caps,
  useAdapterDisplayName: () => 'Fake Harness',
}));

const ROOT_START = '2026-08-31T09:00:00.000Z';

function iso(offsetMs: number): string {
  return new Date(Date.parse(ROOT_START) + offsetMs).toISOString();
}

function trace(steps: TraceStep[], axisStartedAt?: string): SessionTrace {
  return {
    id: 'fake:root',
    steps,
    models: ['sonnet-4'],
    axis: { steps: steps.length, startedAt: axisStartedAt },
    totals: { uncachedInput: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoningOutput: 0 },
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('no timing data', () => {
  test("shows the explicit empty state, matching TraceRibbon's pattern, when resolveRootAnchor returns undefined", () => {
    const root = makeSummary({ id: 'fake:root', timing: {} });
    shared.sessionResult = {
      isPending: false,
      error: null,
      data: {
        summary: root,
        rollup: makeRollup({ id: 'fake:root' }),
        subtree: { summaries: [root], rollups: { 'fake:root': makeRollup({ id: 'fake:root' }) } },
        diagnostics: [],
      },
    };
    shared.traceResult = { isPending: false, error: null, data: undefined };
    shared.tracesById = {};

    render(<SessionTimeline id="fake:root" />);
    expect(screen.getByText('No timing data available')).not.toBeNull();
    expect(screen.getByRole('img', { name: 'No timing data available' })).not.toBeNull();
  });

  test('does not crash and renders nothing extra while the base session query is still pending', () => {
    shared.sessionResult = { isPending: true, error: null, data: undefined };
    shared.traceResult = { isPending: true, error: null, data: undefined };
    shared.tracesById = {};

    const view = render(<SessionTimeline id="fake:root" />);
    expect(view.container.textContent).toBe('');
  });
});

describe('real fixture data', () => {
  const ROOT = makeSummary({
    id: 'fake:root',
    timing: { startedAt: metric(ROOT_START) },
  });
  const CHILD = makeSummary({
    id: 'fake:child',
    parentId: 'fake:root',
    depth: 1,
    relation: 'subagent',
    agentType: 'Explore',
    timing: { startedAt: metric(iso(500)) },
  });

  function setup() {
    shared.sessionResult = {
      isPending: false,
      error: null,
      data: {
        summary: ROOT,
        rollup: makeRollup({
          id: 'fake:root',
          inclusive: {
            usage: { output: metric(9000) },
            counts: { toolCalls: metric(3), subagents: metric(1) },
          },
          descendants: 1,
        }),
        subtree: {
          summaries: [ROOT, CHILD],
          rollups: {
            'fake:root': makeRollup({ id: 'fake:root' }),
            'fake:child': makeRollup({ id: 'fake:child' }),
          },
        },
        diagnostics: [],
      },
    };
    const rootTrace = trace(
      [
        {
          kind: 'call',
          i: 0,
          model: 'sonnet-4',
          at: iso(0),
          usage: { uncachedInput: 100, output: 50 },
          cum: {
            uncachedInput: 100,
            cachedInput: 0,
            cacheWrite: 0,
            output: 50,
            reasoningOutput: 0,
          },
          blocks: { text: 1, thinking: 0, toolUse: 0 },
        },
        { kind: 'tool', i: 1, category: 'read', name: 'src/index.ts', at: iso(1000) },
        {
          kind: 'tool',
          i: 2,
          category: 'mcp',
          name: 'mcp__github__search',
          at: iso(2000),
          durationMs: 500,
        },
      ],
      ROOT_START,
    );
    shared.traceResult = { isPending: false, error: null, data: rootTrace };
    shared.tracesById = {
      'fake:root': { isPending: false, error: null, data: rootTrace },
      'fake:child': { isPending: false, error: null, data: trace([], iso(500)) },
    };
  }

  test('renders the summary bar and all four tracks against real derived data', () => {
    setup();
    render(<SessionTimeline id="fake:root" />);
    expect(screen.queryByText('No timing data available')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Timeline' })).not.toBeNull();
    // TimelineSummaryBar: agent count (2 subtree members), mcp call count (1).
    expect(screen.getByText('2')).not.toBeNull();
    expect(screen.getByText('1')).not.toBeNull();
    // Every track + axis rendered.
    expect(document.querySelector('[data-slot="token-track"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="agent-track"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="timeline-axis"]')).not.toBeNull();
    expect(document.querySelector('[data-harness-id]')).not.toBeNull();
    expect(document.querySelector('[data-component-id]')).not.toBeNull();
  });

  test("the tracks container is the shared-cursor overlay's positioned ancestor", () => {
    setup();
    render(<SessionTimeline id="fake:root" />);
    const container = document.querySelector('[data-slot="timeline-tracks"]');
    expect(container?.className).toContain('relative');
  });

  test('the tracks container carries no padding/border of its own -- those classes moved to an outer wrapper (f8)', () => {
    setup();
    render(<SessionTimeline id="fake:root" />);
    const container = document.querySelector('[data-slot="timeline-tracks"]');
    expect(container?.className).not.toMatch(/\bp-3\b/);
    expect(container?.className).not.toMatch(/\bborder\b/);
    // The removed classes must still exist SOMEWHERE (an outer wrapper), not
    // be silently dropped -- otherwise the tracks box would lose its card
    // styling entirely rather than just relocating it.
    expect(document.querySelector('.rounded-lg.border.border-border.bg-card.p-3')).not.toBeNull();
  });

  test('wires useContainerWidth into TimelineContext.width (via every track/axis viewBox), not the hardcoded DEFAULT_WIDTH', () => {
    setup();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    // A container measured at 700px real CSS px, minus the shared
    // LABEL_GUTTER_PX (168) every track/axis row reserves for its label
    // cell, should drive TimelineContext.width to 532 -- not DEFAULT_WIDTH
    // (480), proving the real measurement (not the hardcoded fallback) is
    // what reaches xScale's range and every track's viewBox.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 700,
      height: 0,
      top: 0,
      left: 0,
      right: 700,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    render(<SessionTimeline id="fake:root" />);

    const axisSvg = document.querySelector('[data-slot="timeline-axis"] svg');
    expect(axisSvg?.getAttribute('viewBox')).toBe('0 0 532 24');
  });

  test("the SharedCursor inset wrapper's real rendered left offset is derived from LABEL_GUTTER_PX (f8) -- not an independently hand-typed value that could drift out of sync", () => {
    setup();
    render(<SessionTimeline id="fake:root" />);
    // Reads the real rendered inline style off the actual composed tree, not
    // a stub/constant re-derivation -- if a future change to
    // `LABEL_GUTTER_PX`/`LABEL_GUTTER_WIDTH` isn't mirrored into this
    // wrapper's inset, this assertion (unlike SharedCursor.test.tsx's
    // round-trip test, which stubs its rect from the constant itself) would
    // fail against the real component tree.
    const wrapper = document.querySelector(
      '[data-slot="shared-cursor-inset"]',
    ) as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper?.style.left).toBe(`${LABEL_GUTTER_PX}px`);
  });

  test('falls back to DEFAULT_WIDTH (480) before the container has been measured (measured width still 0)', () => {
    setup();
    // No getBoundingClientRect/ResizeObserver stubs at all here -- happy-dom
    // defaults to a zeroed rect, so measuredWidth stays 0 and the axis must
    // use the pre-measurement DEFAULT_WIDTH fallback, not a degenerate 0 or
    // negative width.
    render(<SessionTimeline id="fake:root" />);
    const axisSvg = document.querySelector('[data-slot="timeline-axis"] svg');
    expect(axisSvg?.getAttribute('viewBox')).toBe('0 0 480 24');
  });

  describe('drag-to-zoom (f9)', () => {
    /**
     * Global rect stub, matching the established `wires useContainerWidth...`
     * test's convention above. `left:0,width:800` for EVERY element
     * (container, `shared-cursor-inset` plot wrapper, and every track's own
     * `<svg>`) -- `ZoomBrush`'s drag-position math and every track's own
     * hover-position math both resolve `pointerToElapsedMs` against this
     * SAME stubbed rect, so a hand-computed expected `xScale` value (below)
     * is directly comparable to what the real component tree renders.
     */
    function stubRects() {
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      );
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
        width: 800,
        height: 0,
        top: 0,
        left: 0,
        right: 800,
        bottom: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect);
    }

    // Fixture's real full-session extent, hand-derived from `setup()`'s
    // steps (not copied from `computeMaxElapsed`'s implementation): the mcp
    // componentEvent's end (`at:2000` + `durationMs:500`) is the widest of
    // agentSpans (max start 500, no ends present)/tokenSeries (0)/
    // harnessEvents (1000).
    const MAX_ELAPSED = 2500;
    const PLOT_WIDTH = 800 - LABEL_GUTTER_PX; // 632

    function dragTo(container: Element, fromClientX: number, toClientX: number) {
      fireEvent.mouseDown(container, { clientX: fromClientX, button: 0 });
      fireEvent.mouseMove(container, { clientX: toClientX });
      fireEvent.mouseUp(container, { clientX: toClientX });
    }

    test('a drag-select narrows the shared domain, and a track mark re-renders at the new xScale position -- not the original full-session domain', () => {
      setup();
      stubRects();
      render(<SessionTimeline id="fake:root" />);

      const container = document.querySelector('[data-slot="timeline-tracks"]') as HTMLElement;
      expect(container).not.toBeNull();

      // The single HarnessTrack mark in this fixture: category 'read' at
      // elapsed 1000ms, no durationMs (rendered as a tick, `x = xScale(at)`).
      const preScale = scaleLinear<number>({ domain: [0, MAX_ELAPSED], range: [0, PLOT_WIDTH] });
      const expectedXPre = preScale(1000);
      const markPre = document.querySelector('[data-harness-id]');
      expect(markPre).not.toBeNull();
      // The single fixture mark (category 'read', no durationMs) renders as
      // an instant dot (f10) -- `cx`, not a rect's `x`.
      expect(Number.parseFloat(markPre?.getAttribute('cx') ?? 'NaN')).toBeCloseTo(expectedXPre, 5);

      // clientX 160 -> elapsed 500ms, clientX 480 -> elapsed 1500ms, against
      // the pre-zoom domain [0,2500] and this stub's 800px rect (the nominal
      // viewBox width, 632, cancels out of the ratio -- `pointerToElapsedMs`'s
      // own documented 3-step conversion).
      dragTo(container, 160, 480);

      // "Reset zoom" now renders, proving `isZoomed` flowed correctly from
      // `SessionTimeline`'s own domain state into `TimelineSummaryBar`.
      expect(screen.getByRole('button', { name: 'Reset zoom' })).not.toBeNull();

      const postScale = scaleLinear<number>({ domain: [500, 1500], range: [0, PLOT_WIDTH] });
      const expectedXPost = postScale(1000);
      // Sanity: genuinely a different rendered position, not a coincidence
      // of the two hand-computed scales agreeing.
      expect(expectedXPost).not.toBeCloseTo(expectedXPre, 1);

      const markPost = document.querySelector('[data-harness-id]');
      expect(markPost).not.toBeNull();
      expect(Number.parseFloat(markPost?.getAttribute('cx') ?? 'NaN')).toBeCloseTo(
        expectedXPost,
        5,
      );
    });

    test('click-to-select still resolves to the correct underlying event after zooming -- the data shown is unaffected by the visual zoom', () => {
      setup();
      stubRects();
      render(<SessionTimeline id="fake:root" />);
      const container = document.querySelector('[data-slot="timeline-tracks"]') as HTMLElement;

      dragTo(container, 160, 480);
      expect(screen.getByRole('button', { name: 'Reset zoom' })).not.toBeNull();

      // A separate, later plain click (not the drag's own trailing click,
      // which `ZoomBrush` deliberately suppresses -- see
      // `ZoomBrush.test.tsx`'s dedicated suppression tests) resets that
      // suppression flag, matching how a real second user interaction would.
      fireEvent.mouseDown(container, { clientX: 480, button: 0 });
      fireEvent.mouseUp(container, { clientX: 480 });

      const markPost = document.querySelector('[data-harness-id]');
      expect(markPost).not.toBeNull();
      if (markPost) fireEvent.click(markPost);

      // HarnessEvent.at=1000ms -> "0:01", the real underlying timestamp,
      // unaffected by the domain the mark happens to currently render under.
      // Scoped to the opened EventInspector sheet -- a post-zoom axis tick
      // can legitimately show the same "0:01" label elsewhere on the page.
      const sheet = document.querySelector('[data-slot="event-inspector"]') as HTMLElement;
      expect(sheet).not.toBeNull();
      expect(within(sheet).getByText('0:01')).not.toBeNull();
    });

    test('the "Reset zoom" button restores the full-session domain', () => {
      setup();
      stubRects();
      render(<SessionTimeline id="fake:root" />);
      const container = document.querySelector('[data-slot="timeline-tracks"]') as HTMLElement;

      dragTo(container, 160, 480);
      const resetButton = screen.getByRole('button', { name: 'Reset zoom' });
      fireEvent.click(resetButton);

      expect(screen.queryByRole('button', { name: 'Reset zoom' })).toBeNull();
      const preScale = scaleLinear<number>({ domain: [0, MAX_ELAPSED], range: [0, PLOT_WIDTH] });
      const mark = document.querySelector('[data-harness-id]');
      expect(mark).not.toBeNull();
      expect(Number.parseFloat(mark?.getAttribute('cx') ?? 'NaN')).toBeCloseTo(preScale(1000), 5);
    });

    test('double-clicking the tracks container also resets to the full-session domain (secondary affordance)', () => {
      setup();
      stubRects();
      render(<SessionTimeline id="fake:root" />);
      const container = document.querySelector('[data-slot="timeline-tracks"]') as HTMLElement;

      dragTo(container, 160, 480);
      expect(screen.getByRole('button', { name: 'Reset zoom' })).not.toBeNull();

      fireEvent.doubleClick(container);

      expect(screen.queryByRole('button', { name: 'Reset zoom' })).toBeNull();
    });

    test('a non-drag click on the tracks container does not narrow the domain (no spurious zoom from a plain click)', () => {
      setup();
      stubRects();
      render(<SessionTimeline id="fake:root" />);
      const container = document.querySelector('[data-slot="timeline-tracks"]') as HTMLElement;

      fireEvent.mouseDown(container, { clientX: 300, button: 0 });
      fireEvent.mouseUp(container, { clientX: 300 });

      expect(screen.queryByRole('button', { name: 'Reset zoom' })).toBeNull();
    });

    test("changing the session id re-seeds domain to the new session's full range, discarding any in-progress zoom (f9-t1's own domain-reseed expectedOutcome -- previously only covered by a deleted verify-time scratch test, see lessons.md session-timeline-drag-overlay-vs-click-passthrough addendum)", () => {
      setup();
      stubRects();
      const view = render(<SessionTimeline id="fake:root" />);
      const container = document.querySelector('[data-slot="timeline-tracks"]') as HTMLElement;

      dragTo(container, 160, 480);
      expect(screen.getByRole('button', { name: 'Reset zoom' })).not.toBeNull();

      // Swap in a different session with a different full-session extent --
      // mocked the same way `setup()` does, but a distinct id/trace so a
      // stale zoomed domain carried over from session A would be visibly
      // wrong here (both in the button's presence and the mark's position).
      const OTHER_ROOT = makeSummary({
        id: 'fake:other',
        timing: { startedAt: metric(ROOT_START) },
      });
      shared.sessionResult = {
        isPending: false,
        error: null,
        data: {
          summary: OTHER_ROOT,
          rollup: makeRollup({ id: 'fake:other' }),
          subtree: {
            summaries: [OTHER_ROOT],
            rollups: { 'fake:other': makeRollup({ id: 'fake:other' }) },
          },
          diagnostics: [],
        },
      };
      const otherTrace = trace(
        [{ kind: 'tool', i: 0, category: 'exec', name: 'npm run build', at: iso(5000) }],
        ROOT_START,
      );
      shared.traceResult = { isPending: false, error: null, data: otherTrace };
      shared.tracesById = { 'fake:other': { isPending: false, error: null, data: otherTrace } };

      view.rerender(<SessionTimeline id="fake:other" />);

      // No stale "Reset zoom" affordance carried over from session A's
      // [500,1500] zoomed domain -- the new session must start fully zoomed
      // out.
      expect(screen.queryByRole('button', { name: 'Reset zoom' })).toBeNull();
      const mark = document.querySelector('[data-harness-id]');
      expect(mark).not.toBeNull();
      // Session B's own full extent is [0, 5000] (its only event, at=5000,
      // no durationMs -- computeMaxElapsed's widest value). If the reseed
      // effect failed to fire, this would instead render against the stale
      // [500, 1500] domain from session A.
      const scale = scaleLinear<number>({ domain: [0, 5000], range: [0, PLOT_WIDTH] });
      expect(Number.parseFloat(mark?.getAttribute('cx') ?? 'NaN')).toBeCloseTo(scale(5000), 5);
    });
  });
});
