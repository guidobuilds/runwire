import { cn } from '../../lib/utils';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type ConfidenceDotProps = {
  level: ConfidenceLevel;
  /**
   * When true, the dot carries no accessible name of its own and is hidden
   * from assistive technology (`aria-hidden`). Use this when the dot sits
   * beside another element that already announces the same confidence grade
   * -- `MetricCell`'s `~`/`?` marker, in particular (see that file) -- so a
   * screen reader doesn't announce "medium confidence" twice for one value.
   * Standalone uses (chart legends/headers, f4/f7) leave this `false` (the
   * default) so the dot is the sole carrier of the signal there.
   */
  decorative?: boolean;
  className?: string;
};

/**
 * D36 (docs/DECISIONS.md): confidence is a color dot, strictly a provenance
 * signal, never a verdict -- it must never be the only channel carrying the
 * signal (the a11y layer below is how that constraint is met when the dot is
 * used standalone). Colors resolve the `--confidence-*` tokens (design.md
 * §3) via a Tailwind arbitrary-value class referencing the CSS custom
 * property directly, not a literal hex value.
 */
const DOT_TONE: Record<ConfidenceLevel, string> = {
  high: 'bg-[var(--confidence-high)]',
  medium: 'bg-[var(--confidence-medium)]',
  low: 'bg-[var(--confidence-low)]',
};

export function ConfidenceDot({ level, decorative = false, className }: ConfidenceDotProps) {
  const a11yProps = decorative
    ? { 'aria-hidden': true as const }
    : { role: 'img' as const, 'aria-label': `${level} confidence` };

  return (
    <span
      {...a11yProps}
      className={cn('inline-block size-1.5 shrink-0 rounded-full', DOT_TONE[level], className)}
    />
  );
}
