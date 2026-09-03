import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { MarkTooltip } from './MarkTooltip';
import { TimelineProvider, useTimeline } from './TimelineContext';

afterEach(() => cleanup());

/** Sets `hoveredMark` via a real context call, matching how a track's own hit-test would. */
function Setter({
  content,
  clientX,
  clientY,
}: {
  content: string;
  clientX: number;
  clientY: number;
}) {
  const { setHoveredMark } = useTimeline();
  return (
    <button type="button" onClick={() => setHoveredMark({ content, clientX, clientY })}>
      set
    </button>
  );
}

describe('MarkTooltip', () => {
  test('renders nothing when hoveredMark is null', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]}>
        <MarkTooltip />
      </TimelineProvider>,
    );
    expect(view.container.querySelector('[data-slot="mark-tooltip"]')).toBeNull();
  });

  test('renders the hovered mark content, position:fixed and offset from the raw pointer position', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]}>
        <Setter content={'Line one\nLine two'} clientX={100} clientY={200} />
        <MarkTooltip />
      </TimelineProvider>,
    );
    fireEvent.click(view.getByText('set'));
    const el = view.container.querySelector('[data-slot="mark-tooltip"]') as HTMLElement | null;
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe('Line one\nLine two');
    // `fixed` is a Tailwind class (position: fixed), not an inline style.
    expect(el?.className).toContain('fixed');
    // Offset, never exactly under the pointer.
    expect(Number.parseFloat(el?.style.left ?? 'NaN')).toBeGreaterThan(100);
    expect(Number.parseFloat(el?.style.top ?? 'NaN')).toBeGreaterThan(200);
  });

  test("is styled to match ui/tooltip.tsx TooltipContent's static classes (rounded-md bg-foreground px-3 py-1.5 text-xs text-background) plus whitespace-pre-line", () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]}>
        <Setter content="tip" clientX={0} clientY={0} />
        <MarkTooltip />
      </TimelineProvider>,
    );
    fireEvent.click(view.getByText('set'));
    const el = view.container.querySelector('[data-slot="mark-tooltip"]');
    for (const cls of [
      'rounded-md',
      'bg-foreground',
      'px-3',
      'py-1.5',
      'text-xs',
      'text-background',
      'whitespace-pre-line',
    ]) {
      expect(el?.className).toContain(cls);
    }
  });

  test('does not render a Base UI Tooltip/anchor element -- no data-slot="tooltip*" markup', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]}>
        <Setter content="tip" clientX={0} clientY={0} />
        <MarkTooltip />
      </TimelineProvider>,
    );
    fireEvent.click(view.getByText('set'));
    expect(view.container.querySelector('[data-slot="tooltip"]')).toBeNull();
    expect(view.container.querySelector('[data-slot="tooltip-trigger"]')).toBeNull();
    expect(view.container.querySelector('[data-slot="tooltip-content"]')).toBeNull();
  });
});
