import type { ReactNode } from 'react';

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
  const classes = [
    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
    TONE[tone],
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return <span className={classes}>{children}</span>;
}
