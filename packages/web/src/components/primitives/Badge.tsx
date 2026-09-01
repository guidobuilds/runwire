import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Badge as ShadcnBadge } from '../ui/badge';

/**
 * L2 wrapper around the CLI-vendored `ui/badge` (design.md §2). Scout's
 * `tone` semantics (neutral/info/warn/error/success) predate shadcn's own
 * `variant` axis and don't map onto it 1:1, so this keeps the exact `tone`
 * API the M4 hand-rolled `ui/Badge.tsx` exposed -- every call site needed
 * only an import-path change. Tone colors are unchanged from the hand-rolled
 * version (Tailwind palette utilities, not raw hex -- design.md §3's
 * "never hardcoded hex in components" is about literal hex codes, not
 * Tailwind class names).
 */
export type BadgeTone = 'neutral' | 'info' | 'warn' | 'error' | 'success';

export type BadgeProps = {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
};

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200',
  info: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  warn: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  error: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
};

export function Badge({ tone = 'neutral', children, className }: BadgeProps) {
  return (
    <ShadcnBadge
      variant="outline"
      className={cn(
        'rounded-full border-transparent px-2 py-0.5 font-medium',
        TONE[tone],
        className,
      )}
    >
      {children}
    </ShadcnBadge>
  );
}
