import { cleanup, fireEvent, render } from '@testing-library/react';
import { scaleLinear } from '@visx/scale';
import { useEffect } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { buildAgentSpans } from '../../lib/timeline';
import { buildAgentTree } from '../../lib/tree';
import { makeSummary, metric } from '../session-detail/fixtures';
import { AgentTrack } from './AgentTrack';
import { SharedCursor } from './SharedCursor';
import { LABEL_GUTTER_PX, TimelineProvider, useTimeline } from './TimelineContext';
import { TokenTrack } from './TokenTrack';

afterEach(() => cleanup());

/** Test-only child that pins the shared cursor to `at` ms on mount, matching how a real track's click/hover handler would drive `TimelineContext`. */
function PinCursor({ at }: { at: number }) {
  const { pinCursor } = useTimeline();
  useEffect(() => {
    pinCursor(at);
  }, [pinCursor, at]);
  return null;
}

describe('no cursor', () => {
  test('renders nothing when no consumer has set a cursor', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]} width={480}>
        <SharedCursor />
      </TimelineProvider>,
    );
    expect(view.container.querySelector('[data-slot="shared-cursor"]')).toBeNull();
  });
});

describe('pinned cursor', () => {
  test('renders one overlay div positioned as a percentage of the container width', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]} width={480}>
        <PinCursor at={500} />
        <SharedCursor />
      </TimelineProvider>,
    );
    const overlay = view.container.querySelector('[data-slot="shared-cursor"]');
    expect(overlay).not.toBeNull();
    // domain [0, 1000], width 480 -> xScale(500) = 240 -> 240/480*100 = 50%.
    expect((overlay as HTMLElement).style.left).toBe('50%');
  });

  test('is a pure presentational overlay: pointer-events disabled, no interactive handlers', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]} width={480}>
        <PinCursor at={500} />
        <SharedCursor />
      </TimelineProvider>,
    );
    const overlay = view.container.querySelector('[data-slot="shared-cursor"]') as HTMLElement;
    expect(overlay.className).toContain('pointer-events-none');
    expect(overlay.onclick).toBeNull();
    expect(overlay.onmousemove).toBeNull();
  });

  test('renders at xScale(cursorTime) against a real, non-480px container width (f8): not merely "renders without crashing"', () => {
    // f8's archiveWhen requires a committed test that mocks a real container
    // width other than DEFAULT_WIDTH (480, the value every other test in this
    // file uses) and asserts SharedCursor's rendered `left` position matches
    // xScale(cursorTime) computed against that real width -- otherwise a
    // regression that silently falls back to the hardcoded default width
    // could ship undetected, since every other committed test here happens
    // to already be at 480. Uses 777px, matching the width the independent
    // verify pass already hand-confirmed generalizes correctly as a
    // disposable scratch check before this test made that check durable.
    const domain: [number, number] = [0, 3000];
    const width = 777;
    const cursorTime = 1200;

    const view = render(
      <TimelineProvider domain={domain} width={width}>
        <PinCursor at={cursorTime} />
        <SharedCursor />
      </TimelineProvider>,
    );
    const overlay = view.container.querySelector('[data-slot="shared-cursor"]') as HTMLElement;
    expect(overlay).not.toBeNull();

    // Independently construct the same shape of xScale SharedCursor consumes
    // (domain -> [0, width]) against this fixture's real 777px width, and
    // convert cursorTime through it directly -- not a hand-typed expected
    // percentage that could itself be wrong.
    const realWidthScale = scaleLinear<number>({ domain, range: [0, width] });
    const expectedLeftPx = realWidthScale(cursorTime);
    const expectedLeftPercent = (expectedLeftPx / width) * 100;

    // Sanity: this fixture's numbers are genuinely distinct from every other
    // test in this file, not a coincidental match to a default-width result.
    expect(expectedLeftPx).toBeCloseTo(310.8, 5);
    expect(expectedLeftPercent).toBeCloseTo(40, 5);

    expect(Number.parseFloat(overlay.style.left)).toBeCloseTo(expectedLeftPercent, 5);
  });
});

describe('cross-track shared-cursor round trip (f8)', () => {
  /**
   * Reproduces the exact geometry `SessionTimeline`'s real composition
   * guarantees once a browser resolves the layout: every track's plot `<svg>`
   * and `SharedCursor`'s positioned ancestor (the `data-slot=
   * "shared-cursor-inset"` wrapper, whose `left` style is set directly from
   * `LABEL_GUTTER_PX`, f8) all share one identical `{left, width}` real-pixel
   * rect — happy-dom has no real layout engine
   * (`session-timeline-track-hover-contract`/`useContainerWidth.test.ts`'s
   * own documented gap), so this stubs that shared rect explicitly on both
   * tracks' `<svg>`s and on the cursor's positioned ancestor, rather than
   * trusting jsdom/happy-dom to compute it from the Tailwind classes.
   *
   * This is a true round trip, not a "renders something" smoke test:
   * (1) hovering `AgentTrack` at a real screen X and (2) hovering `TokenTrack`
   * at the SAME real screen X must produce the SAME `cursorTime` (proving
   * every track's plot area starts at the identical real-pixel x-origin,
   * f8's core bug); and (3) `SharedCursor`'s own rendered `left: X%`, when
   * converted back to a real screen X against that same shared rect, must
   * land back at the original real screen X (proving the cursor overlay
   * itself — not just the tracks' own hover handlers — is positioned in the
   * same coordinate space, not offset by the label gutter or padding).
   */
  test('hovering AgentTrack and TokenTrack at the same real px X yields the same cursorTime, and SharedCursor renders back at that same real px X', () => {
    const PLOT_LEFT = LABEL_GUTTER_PX; // matches SessionTimeline's shared-cursor-inset wrapper's `left` style
    const PLOT_WIDTH = 480;
    const ROOT_ANCHOR = '2026-08-31T09:00:00.000Z';

    const summaries = [
      makeSummary({ id: 'root', depth: 0, timing: { startedAt: metric(ROOT_ANCHOR) } }),
    ];
    const root = buildAgentTree('root', summaries);
    if (!root) throw new Error('fixture root missing');
    const spans = buildAgentSpans(ROOT_ANCHOR, summaries);

    function Readout() {
      const { cursorTime } = useTimeline();
      return <div data-testid="cursor">{String(cursorTime)}</div>;
    }

    const view = render(
      <TimelineProvider domain={[0, 1000]} width={PLOT_WIDTH}>
        <AgentTrack root={root} spans={spans} />
        <TokenTrack
          points={[
            {
              id: 'call:a#0',
              agentId: 'root',
              at: 0,
              cumulative: 10,
              delta: 10,
              input: 6,
              output: 4,
              model: 'claude-x',
            },
          ]}
        />
        {/* Mirrors SessionTimeline's real inset wrapper around SharedCursor. */}
        <div data-testid="cursor-ancestor" style={{ position: 'absolute' }}>
          <SharedCursor />
        </div>
        <Readout />
      </TimelineProvider>,
    );

    const sharedRect = {
      left: PLOT_LEFT,
      width: PLOT_WIDTH,
      top: 0,
      right: PLOT_LEFT + PLOT_WIDTH,
      x: PLOT_LEFT,
      y: 0,
      toJSON: () => ({}),
    };
    const stub = (el: Element, height: number) => {
      (el as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
        ({ ...sharedRect, bottom: height, height }) as DOMRect;
    };

    const agentSvg = view.container.querySelector('svg[aria-label="root span"]');
    const tokenSvg = view.container.querySelector('[data-slot="token-track"] svg');
    const cursorAncestor = view.getByTestId('cursor-ancestor');
    if (!agentSvg || !tokenSvg) throw new Error('expected both tracks to render an svg');
    stub(agentSvg, 22);
    stub(tokenSvg, 64);
    stub(cursorAncestor, 200);

    // Real screen X: plot-left + 240px into the 480px-wide plot area = the
    // domain midpoint of [0, 1000], i.e. cursorTime 500.
    const REAL_X = PLOT_LEFT + 240;

    fireEvent.mouseMove(agentSvg, { clientX: REAL_X });
    const cursorFromAgent = view.getByTestId('cursor').textContent;
    expect(cursorFromAgent).toBe('500');

    fireEvent.mouseMove(tokenSvg, { clientX: REAL_X });
    const cursorFromToken = view.getByTestId('cursor').textContent;
    expect(cursorFromToken).toBe(cursorFromAgent);

    const overlay = view.container.querySelector('[data-slot="shared-cursor"]') as HTMLElement;
    expect(overlay).not.toBeNull();
    const leftPercent = Number.parseFloat(overlay.style.left);
    const renderedRealX = PLOT_LEFT + (leftPercent / 100) * PLOT_WIDTH;
    expect(renderedRealX).toBeCloseTo(REAL_X, 5);
  });
});
