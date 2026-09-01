import { cn } from '../../lib/utils';

export type HarnessBadgeProps = {
  harnessId: string;
  /** Falls back to `harnessId` while status is still loading. */
  displayName?: string;
  className?: string;
};

/**
 * Deterministic tone per harness id (hashed, not per-row/per-index), so the
 * same harness always renders the same color across one table or grid.
 */
const TONES = [
  'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
  'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
] as const;

function toneFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return TONES[hash % TONES.length] ?? TONES[0];
}

/**
 * Small letter-avatar + display name for a harness (design.md §5's "harness
 * letter-badge"). Lives under `primitives/` — design.md §2 names `HarnessBadge`
 * directly as an anticipated L2 primitive — so the group-card work (f6) reuses
 * this instead of a second implementation.
 */
export function HarnessBadge({ harnessId, displayName, className }: HarnessBadgeProps) {
  const label = displayName ?? harnessId;
  const letter = label.trim().charAt(0).toUpperCase() || '?';

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span
        aria-hidden="true"
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
          toneFor(harnessId),
        )}
      >
        {letter}
      </span>
      <span>{label}</span>
    </span>
  );
}
