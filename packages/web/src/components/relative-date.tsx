import * as React from 'react';
import { cn } from '@/lib/utils';

// Shared date display for the web UI: one relative-date control used by the
// sessions table and the profile header, plus the single absolute formatter.
//
// `formatDateTime` lives here (and is re-exported by
// `session-profile/format.ts`) so there is exactly one locale absolute format;
// the events table keeps its own fixed `formatTime` and is intentionally not a
// consumer of this module.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

/**
 * One shared minute-scale clock for every relative date on the page. Cells
 * subscribe/unsubscribe; the interval only exists while at least one is
 * mounted, so a table with 50 dates still runs a single timer.
 */
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

/** The current time, shared across every relative date on the page. */
export function useNow(): number {
  return React.useSyncExternalStore(subscribeNow, getNowSnapshot, getNowSnapshot);
}

/** Locale absolute date+time, `—` for null/invalid. Single source for the
 * dashboard and the profile header. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * Locale-free compact age: `just now`, `5m ago`, `3h ago`, `2d ago`,
 * `4mo ago`, `1y ago`. Future timestamps read `in 5m` instead of a negative
 * age. Null/invalid (and anything under a minute, either direction) is
 * handled explicitly so a clock skew can never render `-1m ago`.
 */
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
  /** ISO-8601 timestamp; null or unparseable renders a plain em dash. */
  value: string | null;
  className?: string;
  /**
   * Controlled display mode. When provided, the cell renders exactly this
   * format and never reacts to hover; activation reports a toggle request
   * through `onToggle` so the sessions table can flip a whole date column.
   * Leave undefined for the profile's uncontrolled hover/pin cell.
   */
  showAbsolute?: boolean;
  /** Called on click/Enter/Space in controlled mode; the owner decides the
   * resulting column format. Ignored when the cell is uncontrolled. */
  onToggle?: () => void;
};

/**
 * A date cell that shows the relative age by default.
 *
 * Uncontrolled (the profile header): hover (or keyboard focus + Enter/Space)
 * temporarily reveals the exact local date+time, and a click pins that exact
 * value for this cell only until it is clicked again.
 *
 * Controlled (`showAbsolute` given, the dashboard columns): the cell renders
 * exactly the requested format and never changes on hover; activation asks the
 * owner to toggle. Clicks always stop propagating so a date control inside a
 * row never triggers row navigation. Null/invalid values render a
 * non-interactive em dash either way.
 */
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
