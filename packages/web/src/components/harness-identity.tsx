import { CodeXmlIcon } from 'lucide-react';
import type { ComponentPropsWithoutRef } from 'react';
import claudeCodeIcon from '@/assets/harnesses/claude-code.svg';
import opencodeIcon from '@/assets/harnesses/opencode.svg';
import piIcon from '@/assets/harnesses/pi.svg';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type Harness = {
  id: string;
  displayName: string;
};

const HARNESS_ICONS: Record<string, { src: string; invertInDark?: boolean }> = {
  'claude-code': { src: claudeCodeIcon },
  opencode: { src: opencodeIcon, invertInDark: true },
  pi: { src: piIcon, invertInDark: true },
};

export function HarnessIcon({ id, className }: { id: string; className?: string }) {
  const icon = HARNESS_ICONS[id];
  if (!icon) {
    return (
      <CodeXmlIcon
        aria-hidden="true"
        className={cn('size-4 shrink-0 text-muted-foreground', className)}
      />
    );
  }
  return (
    <img
      alt=""
      aria-hidden="true"
      className={cn('size-4 shrink-0', icon.invertInDark && 'dark:invert', className)}
      data-harness-icon={id}
      src={icon.src}
    />
  );
}

type HarnessIdentityProps = ComponentPropsWithoutRef<'span'> & {
  harness: Harness;
  showId?: boolean;
};

export function HarnessIdentity({
  harness,
  showId = false,
  className,
  ...props
}: HarnessIdentityProps) {
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
        <HarnessIcon id={harness.id} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
