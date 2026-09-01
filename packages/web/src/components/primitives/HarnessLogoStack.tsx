import { cn } from '../../lib/utils';
import { AvatarGroupCount } from '../ui/avatar';
import { HarnessLogo, type HarnessLogoSize } from './HarnessLogo';

export type HarnessLogoStackProps = {
  /** Raw harness ids -- deduped and order-preserved (first occurrence wins) internally. */
  harnessIds: readonly string[];
  displayNameFor?: (harnessId: string) => string;
  size?: HarnessLogoSize;
  max?: number;
  className?: string;
};

/** Overlap margin between consecutive avatars -- ~50% of each size's diameter. */
const OVERLAP_CLASSES: Record<HarnessLogoSize, string> = {
  xs: '-ml-1.5',
  sm: '-ml-2',
  md: '-ml-3',
  lg: '-ml-4',
};

/** `AvatarGroupCount`'s own size scale, matched to `HarnessLogoSize` (its ambient `group-has-*` sizing never triggers here since `HarnessLogo` sizes via `className`, not the shadcn `size` prop). */
const COUNT_SIZE_CLASSES: Record<HarnessLogoSize, string> = {
  xs: 'size-3 text-[9px] [&>svg]:size-2',
  sm: 'size-4 text-xs [&>svg]:size-2.5',
  md: 'size-6 text-sm [&>svg]:size-3',
  lg: 'size-8 text-sm [&>svg]:size-4',
};

/** Descending stacking order, first-highest, matching design.md §3.4. */
const Z_CLASSES = ['z-30', 'z-20', 'z-10', 'z-0'] as const;

function zIndexFor(index: number): string {
  return Z_CLASSES[index] ?? 'z-0';
}

/**
 * Minimally-overlapping collection of harness marks (design.md §3.4). Built
 * on `HarnessLogo` (itself on shadcn `Avatar`) plus shadcn `AvatarGroupCount`
 * for the `+N` overflow slot -- the plain flex wrapper (rather than shadcn's
 * `AvatarGroup`) is deliberate: `AvatarGroup`'s own overlap/ring are
 * descendant-selector classes on the *container*, baked to one fixed value
 * and `ring-background`, which cannot cleanly carry this component's four
 * different per-size overlap values or the fixed `ring-card` color without
 * a CSS specificity fight; applying `-ml-*`/`ring-2 ring-card`/`z-*` directly
 * on each avatar keeps the mechanism simple and directly assertable.
 */
export function HarnessLogoStack({
  harnessIds,
  displayNameFor,
  size = 'sm',
  max = 4,
  className,
}: HarnessLogoStackProps) {
  const deduped = [...new Set(harnessIds)];
  const visible = deduped.slice(0, max);
  const overflow = deduped.slice(max);
  const countIsFirst = visible.length === 0;

  return (
    <div className={cn('flex items-center', className)}>
      {visible.map((harnessId, index) => (
        <HarnessLogo
          key={harnessId}
          harnessId={harnessId}
          displayName={displayNameFor?.(harnessId)}
          size={size}
          className={cn(index > 0 && OVERLAP_CLASSES[size], 'ring-2 ring-card', zIndexFor(index))}
        />
      ))}
      {overflow.length > 0 ? (
        <span title={overflow.map((id) => displayNameFor?.(id) ?? id).join(', ')}>
          <AvatarGroupCount
            className={cn(
              COUNT_SIZE_CLASSES[size],
              !countIsFirst && OVERLAP_CLASSES[size],
              'ring-2 ring-card',
              zIndexFor(visible.length),
            )}
          >
            {`+${overflow.length}`}
          </AvatarGroupCount>
        </span>
      ) : null}
    </div>
  );
}
