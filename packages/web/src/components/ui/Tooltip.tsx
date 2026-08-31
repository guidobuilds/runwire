import type { ReactNode } from 'react';

/**
 * Default tooltip: native `title` on a wrapping span (zero dependency).
 * Radix was not taken — hover provenance on MetricCell is a title string,
 * matching design.md §0 closed decision 2.
 */
export type TooltipProps = {
  content: string;
  children: ReactNode;
  className?: string;
};

export function Tooltip({ content, children, className }: TooltipProps) {
  return (
    <span title={content} className={className}>
      {children}
    </span>
  );
}
