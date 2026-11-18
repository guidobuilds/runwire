import * as React from 'react';
import { cn } from '@/lib/utils';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

const CLOCK_TICK_MS = 30_000;

let nowSnapshot = Date.now();
const nowListeners = new Set<() => void>();
let nowInterval: ReturnType<typeof setInterval> | null = null;

function tickNow(): void {
  nowSnapshot = Date.now();
  for (const listener of nowListeners) listener();
}

function subscribeNow(listener: () => void): () => void {
  nowSnapshot = Date.now();
  nowListeners.add(listener);
  nowInterval ??= setInterval(tickNow, CLOCK_TICK_MS);
  return () => {
    nowListeners.delete(listener);
    if (nowListeners.size === 0 && nowInterval !== null) {
      clearInterval(nowInterval);
      nowInterval = null;
    }
  };
}

function getNowSnapshot(): number {
  return nowSnapshot;
}

export function useNow(): number {
  return React.useSyncExternalStore(subscribeNow, getNowSnapshot, getNowSnapshot);
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function formatRelative(iso: string | null, now: number): string {
  if (!iso) return '—';
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '—';

  const difference = now - time;
  const magnitude = Math.abs(difference);
  if (magnitude < MINUTE_MS) return 'just now';

  const prefix = difference < 0 ? 'in ' : '';
  const suffix = difference < 0 ? '' : ' ago';
  if (magnitude < HOUR_MS) return `${prefix}${Math.floor(magnitude / MINUTE_MS)}m${suffix}`;
  if (magnitude < DAY_MS) return `${prefix}${Math.floor(magnitude / HOUR_MS)}h${suffix}`;
  if (magnitude < MONTH_MS) return `${prefix}${Math.floor(magnitude / DAY_MS)}d${suffix}`;
  if (magnitude < YEAR_MS) return `${prefix}${Math.floor(magnitude / MONTH_MS)}mo${suffix}`;
  return `${prefix}${Math.floor(magnitude / YEAR_MS)}y${suffix}`;
}

export type RelativeDateProps = {
  value: string | null;
  className?: string;
  showAbsolute?: boolean;
  onToggle?: () => void;
};

export function RelativeDate({ value, className, showAbsolute, onToggle }: RelativeDateProps) {
  const now = useNow();
  const [pinned, setPinned] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);

  if (value === null || Number.isNaN(new Date(value).getTime())) {
    return <span className={className}>—</span>;
  }

  const controlled = showAbsolute !== undefined;
  const showAbsoluteText = controlled ? showAbsolute : pinned || hovered;

  return (
    <button
      aria-pressed={controlled ? showAbsolute : pinned}
      className={cn(
        'rounded-sm text-left underline decoration-dotted decoration-muted-foreground/60 underline-offset-4 outline-none transition-colors hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring/60',
        className,
      )}
      onClick={(event) => {
        event.stopPropagation();
        if (controlled) onToggle?.();
        else setPinned((previous) => !previous);
      }}
      onMouseEnter={controlled ? undefined : () => setHovered(true)}
      onMouseLeave={controlled ? undefined : () => setHovered(false)}
      type="button"
    >
      {showAbsoluteText ? formatDateTime(value) : formatRelative(value, now)}
    </button>
  );
}
