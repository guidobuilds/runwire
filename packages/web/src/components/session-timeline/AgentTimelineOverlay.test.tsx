import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { AgentTimelineOverlay } from './AgentTimelineOverlay';

/**
 * `AgentTimelineOverlay` is a thin `ui/dialog.tsx` wrapper (design.md §5,
 * f2-t5) -- its own contract is "does it open/close correctly and pass the
 * right agentId through," not "does SessionTimeline itself render correctly"
 * (SessionTimeline.test.tsx already owns that). `./SessionTimeline` is
 * mocked here so this file stays scoped to the wrapper's own behavior.
 */
vi.mock('./SessionTimeline', () => ({
  SessionTimeline: ({ id }: { id: string }) => <div data-testid="session-timeline-mock">{id}</div>,
}));

afterEach(() => cleanup());

describe('AgentTimelineOverlay', () => {
  test('agentId=null renders a closed Dialog with no SessionTimeline mounted', () => {
    render(<AgentTimelineOverlay agentId={null} onClose={() => {}} />);
    expect(screen.queryByTestId('session-timeline-mock')).toBeNull();
  });

  test('a non-null agentId opens the Dialog and mounts SessionTimeline with that exact id', () => {
    render(<AgentTimelineOverlay agentId="agent-42" onClose={() => {}} />);
    expect(screen.getByTestId('session-timeline-mock').textContent).toBe('agent-42');
  });

  test('a different agentId mounts SessionTimeline with THAT id, not a stale/hardcoded one', () => {
    const view = render(<AgentTimelineOverlay agentId="agent-a" onClose={() => {}} />);
    expect(screen.getByTestId('session-timeline-mock').textContent).toBe('agent-a');
    view.rerender(<AgentTimelineOverlay agentId="agent-b" onClose={() => {}} />);
    expect(screen.getByTestId('session-timeline-mock').textContent).toBe('agent-b');
  });

  test('DialogContent carries the required wide/tall sizing classes', () => {
    render(<AgentTimelineOverlay agentId="agent-42" onClose={() => {}} />);
    // Dialog content is portal-rendered (Base UI), not a descendant of the
    // render root -- query the document instead of `view.container`.
    const content = document.body.querySelector('[data-slot="dialog-content"]');
    expect(content).not.toBeNull();
    expect(content?.className).toContain('max-w-5xl');
    expect(content?.className).toContain('max-h-[85vh]');
    expect(content?.className).toContain('overflow-y-auto');
  });

  /**
   * Regression for f2-t8: the dialog rendered ~480-500px wide instead of the
   * intended ~1024px (`max-w-5xl`). Root cause was a CSS cascade conflict,
   * not a JS bug -- `ui/dialog.tsx`'s `DialogContent` base classes already
   * carry `sm:max-w-sm`, and `cn()`'s `twMerge` only dedupes classes sharing
   * the exact same variant/modifier group. An unprefixed `max-w-5xl` override
   * therefore left BOTH `sm:max-w-sm` and `max-w-5xl` in the final class
   * list; Tailwind v4 emits `sm:`-prefixed utilities in an `@media` block
   * *after* unprefixed ones, so at equal specificity the later, `sm:`-scoped
   * rule (24rem) always won over the unprefixed one (64rem) on any viewport
   * >=640px. The fix overrides with the matching `sm:max-w-5xl` prefix so
   * `twMerge` correctly drops the conflicting `sm:max-w-sm` -- this is a pure
   * CSS-cascade fix (jsdom/happy-dom don't run layout, so no test can assert
   * the resulting *pixel* width), so this test instead locks in the two
   * class-list facts that jsdom CAN see and that together guarantee the CSS
   * fix holds: the conflicting default is gone, and the correctly-scoped
   * override is present.
   */
  test('the sm:max-w-sm default is overridden, not merely shadowed, by sm:max-w-5xl', () => {
    render(<AgentTimelineOverlay agentId="agent-42" onClose={() => {}} />);
    const content = document.body.querySelector('[data-slot="dialog-content"]');
    expect(content).not.toBeNull();
    const classes = content?.className.split(/\s+/) ?? [];
    expect(classes).toContain('sm:max-w-5xl');
    expect(classes).not.toContain('max-w-5xl');
    expect(classes).not.toContain('sm:max-w-sm');
  });

  test('dismissing the dialog (Escape) calls onClose', () => {
    const onClose = vi.fn();
    render(<AgentTimelineOverlay agentId="agent-42" onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    dialog.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
