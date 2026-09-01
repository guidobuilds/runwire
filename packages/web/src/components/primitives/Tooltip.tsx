import type { ReactNode } from 'react';
import { TooltipContent, Tooltip as TooltipRoot, TooltipTrigger } from '../ui/tooltip';

export type TooltipProps = {
  content: string;
  children: ReactNode;
  className?: string;
};

/**
 * L2 wrapper around the CLI-vendored `ui/tooltip` (design.md §2), keeping the
 * `content` + `children` API the M4 hand-rolled `ui/Tooltip.tsx` (a plain
 * `<span title>`) exposed -- most call sites needed only an import-path
 * change.
 *
 * Deliberate choice, recorded here rather than silently made: the trigger
 * keeps a native `title` attribute carrying the same string alongside the
 * rich Base UI popup. `MetricCell`'s adversary-verified test suite
 * (BL-1/BL-2/BL-3, `.forge/lessons.md`) asserts provenance via
 * `getByTitle(...)` -- present synchronously, with no hover/interaction and
 * no async popup-open state. Base UI's `Tooltip.Popup` is portal-rendered and
 * closed by default (opens only on hover/focus after a delay), so it cannot
 * serve as a drop-in replacement for that query without rewriting the whole
 * suite to a hover-simulation strategy -- which has no in-repo precedent for
 * Base UI's floating positioning under happy-dom (Vitest's test
 * environment), and the task's own instructions say not to silently
 * improvise on that hardened contract. Keeping `title` is additive, not a
 * second competing tooltip with independent content: same source string,
 * so it cannot go out of sync with the rich popup it sits beside.
 */
export function Tooltip({ content, children, className }: TooltipProps) {
  return (
    <TooltipRoot>
      <TooltipTrigger
        render={
          <span title={content} className={className}>
            {children}
          </span>
        }
      />
      <TooltipContent>{content}</TooltipContent>
    </TooltipRoot>
  );
}
