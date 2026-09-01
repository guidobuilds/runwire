import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

export type GroupGridProps = {
  children: ReactNode;
  className?: string;
};

/**
 * Responsive layout for `GroupCard[]` (design.md §2/§5) -- purely a grid
 * wrapper, no data fetching or card markup of its own, so it stays identical
 * for Projects and Harnesses.
 */
export function GroupGrid({ children, className }: GroupGridProps) {
  return (
    <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3', className)}>
      {children}
    </div>
  );
}
