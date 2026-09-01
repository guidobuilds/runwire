import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { HarnessLogoStack } from './HarnessLogoStack';

afterEach(() => {
  cleanup();
});

/**
 * Plain-DOM/class-list assertions (design.md/feature-list.json f2-t9): this
 * repo has no `@testing-library/jest-dom` (`toHaveClass` etc.) and no
 * snapshot-testing convention, so `querySelectorAll`/raw `className`/
 * `textContent`/`title` checks -- the same pattern `GroupCard.test.tsx` and
 * `compare.test.tsx` already use -- are the realistic ceiling here.
 */
describe('HarnessLogoStack', () => {
  test('dedups, caps at max=4, overlaps, rings, descends z-index, and overflows the rest as +N', () => {
    const { container } = render(
      <HarnessLogoStack
        harnessIds={['claude-code', 'codex', 'grok', 'opencode', 'pi', 'claude-code']}
        size="sm"
      />,
    );

    // Dedup collapses the repeated `claude-code` (6 -> 5 unique), then cap to
    // max=4 leaves exactly 4 rendered avatars: claude-code, codex, grok, opencode.
    const avatars = container.querySelectorAll('[data-slot="avatar"]');
    expect(avatars).toHaveLength(4);

    // Every avatar after the first carries the sm-size (-ml-2) overlap class;
    // the first does not.
    expect(avatars[0]?.className).not.toContain('-ml-2');
    for (const avatar of Array.from(avatars).slice(1)) {
      expect(avatar.className).toContain('-ml-2');
    }

    // Every avatar carries the fixed separation ring.
    for (const avatar of avatars) {
      expect(avatar.className).toContain('ring-2');
      expect(avatar.className).toContain('ring-card');
    }

    // Descending z-index in DOM order -- first item stays highest/on top.
    const zIndexes = Array.from(avatars).map((avatar) => {
      const match = avatar.className.match(/(?:^| )z-(\d+)(?: |$)/);
      return match ? Number(match[1]) : Number.NaN;
    });
    expect(zIndexes).toEqual([30, 20, 10, 0]);

    // 5 unique ids capped at 4 leaves exactly 1 overflow (`pi`, the fifth
    // first-seen id) -- rendered as a real shadcn AvatarGroupCount `+1` node
    // whose wrapping title names the omitted harness.
    const overflow = container.querySelector('[data-slot="avatar-group-count"]');
    expect(overflow).not.toBeNull();
    expect(overflow?.textContent).toBe('+1');
    expect(overflow?.className).toContain('ring-2');
    expect(overflow?.className).toContain('ring-card');
    const overflowTitle = overflow?.closest('[title]')?.getAttribute('title') ?? '';
    expect(overflowTitle).toBe('pi');
  });

  test('no overflow node when every unique id fits within max', () => {
    const { container } = render(
      <HarnessLogoStack harnessIds={['claude-code', 'codex']} size="sm" />,
    );
    expect(container.querySelectorAll('[data-slot="avatar"]')).toHaveLength(2);
    expect(container.querySelector('[data-slot="avatar-group-count"]')).toBeNull();
  });
});
