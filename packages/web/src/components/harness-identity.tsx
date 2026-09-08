import { CodeXmlIcon } from 'lucide-react';
import type { ComponentPropsWithoutRef } from 'react';
import claudeCodeIcon from '@/assets/harnesses/claude-code.svg';
import opencodeIcon from '@/assets/harnesses/opencode.svg';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type Harness = {
  id: string;
  displayName: string;
};

const HARNESS_ICONS: Record<string, { src: string; invertInDark?: boolean }> = {
  'claude-code': { src: claudeCodeIcon },
  opencode: { src: opencodeIcon, invertInDark: true },
};

type HarnessIdentityProps = ComponentPropsWithoutRef<'span'> & {
  harness: Harness;
  showId?: boolean;
};

/** Brand assets sourced from https://thesvg.org/icon/claude-code and
 * https://thesvg.org/icon/opencode. Unknown adapters retain a neutral fallback
 * so imported third-party harnesses never render a broken image. */
export function HarnessIdentity({
  harness,
  showId = false,
  className,
  ...props
}: HarnessIdentityProps) {
  const icon = HARNESS_ICONS[harness.id];
  const label = showId ? `${harness.displayName} (${harness.id})` : harness.displayName;

  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={label}
        render={
          <span
            className={cn('inline-flex size-6 items-center justify-center', className)}
            {...props}
          />
        }
      >
        {icon ? (
          <img
            alt=""
            aria-hidden="true"
            className={cn('size-4 shrink-0', icon.invertInDark && 'dark:invert')}
            data-harness-icon={harness.id}
            src={icon.src}
          />
        ) : (
          <CodeXmlIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
