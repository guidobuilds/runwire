import { FlaskConical } from 'lucide-react';
import { HARNESS_LOGO_MARKUP } from '../../assets/harness-logos';
import { cn } from '../../lib/utils';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { LetterAvatar } from './LetterAvatar';

export type HarnessLogoSize = 'xs' | 'sm' | 'md' | 'lg';

export type HarnessLogoProps = {
  harnessId: string;
  /** For title/aria-label only -- never rendered as visible text (D-LOGO-1). */
  displayName?: string;
  size?: HarnessLogoSize;
  className?: string;
};

/** size (design.md §3.2's shared xs/sm/md/lg scale) -> avatar dimension. */
const SIZE_CLASSES: Record<HarnessLogoSize, string> = {
  xs: 'size-3',
  sm: 'size-4',
  md: 'size-6',
  lg: 'size-8',
};

const HARNESS_LOGO_MARKUP_BY_ID = HARNESS_LOGO_MARKUP as Record<string, string | undefined>;

/**
 * Single-harness brand mark (design.md §3.2). Known ids render the vendored,
 * inlined SVG (`assets/harness-logos`); `fake` gets a fixed neutral
 * placeholder (D-LOGO-2); any other unrecognized id falls back to
 * `LetterAvatar`. The display name survives only as `title`/`aria-label` --
 * nothing is ever rendered as visible on-screen text (D-LOGO-1).
 */
export function HarnessLogo({ harnessId, displayName, size = 'sm', className }: HarnessLogoProps) {
  const label = displayName ?? harnessId;
  const markup = HARNESS_LOGO_MARKUP_BY_ID[harnessId];

  return (
    <Avatar title={label} aria-label={label} className={cn(SIZE_CLASSES[size], className)}>
      <AvatarFallback className="bg-transparent">
        {markup ? (
          <span
            className="flex size-full items-center justify-center text-foreground [&_svg]:size-full"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: static vendored SVG content (packages/web/src/assets/harness-logos), never user-controlled
            dangerouslySetInnerHTML={{ __html: markup }}
          />
        ) : harnessId === 'fake' ? (
          <span className="flex size-full items-center justify-center rounded-full bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
            <FlaskConical className="size-2/3" />
          </span>
        ) : (
          <LetterAvatar label={label} size={size} className="size-full" />
        )}
      </AvatarFallback>
    </Avatar>
  );
}
