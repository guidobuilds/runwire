import { cn } from '../../lib/utils';

export type LetterAvatarSize = 'xs' | 'sm' | 'md' | 'lg';

export type LetterAvatarProps = {
  /** Seeds both the displayed letter and the deterministic tone. */
  label: string;
  size?: LetterAvatarSize;
  className?: string;
};

/**
 * Consolidated hash/tone letter-avatar (design.md §3.1). Byte-identical hash
 * algorithm to the two duplicates this replaces --
 * `HarnessBadge.tsx`'s `TONES`/`toneFor` and `GroupCard.tsx`'s
 * `AVATAR_TONES`/`avatarTone` -- so existing visual output for project-card
 * and harness-card avatars is unchanged.
 */
const TONES = [
  'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
  'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
] as const;

/** Deterministic tone per hashed label, so the same seed always renders the same color. */
export function toneFor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  return TONES[hash % TONES.length] ?? TONES[0];
}

export function initial(label: string): string {
  return label.trim().charAt(0).toUpperCase() || '?';
}

/** size (design.md §3.2's shared xs/sm/md/lg scale) -> [dimension, text size]. */
const SIZE_CLASSES: Record<LetterAvatarSize, string> = {
  xs: 'size-3 text-[9px]',
  sm: 'size-4 text-xs',
  md: 'size-6 text-sm',
  lg: 'size-8 text-sm',
};

/** Hashed-tone + first-letter circle, the shared fallback identity mark. */
export function LetterAvatar({ label, size = 'sm', className }: LetterAvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-semibold',
        SIZE_CLASSES[size],
        toneFor(label),
        className,
      )}
    >
      {initial(label)}
    </span>
  );
}
