import type { TokenField } from '@scout/core';

// Shared, pure, locale-safe formatting helpers for the session profile page.
// See .forge/session-profile-v2/design.md "Web layer files" and grill.md G10.

export const TOKEN_FIELDS = [
  'uncachedInput',
  'cachedInput',
  'cacheWrite',
  'output',
  'reasoningOutput',
] as const satisfies readonly TokenField[];

export const FIELD_LABELS: Record<TokenField, string> = {
  uncachedInput: 'Uncached input',
  cachedInput: 'Cached input',
  cacheWrite: 'Cache write',
  output: 'Output',
  reasoningOutput: 'Reasoning output',
};

/** Compact ("1.2K") notation, 1 fraction digit. */
export function formatCompact(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

/** Plain grouped number, no compact notation. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

/** `null` means the source never reported this field (not zero). */
export function formatReported(value: number | null): string {
  return value === null ? 'Not reported' : formatNumber(value);
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

/** Fixed HH:MM:SS (24h, local time, zero-padded) — a stable shape across
 * locales, unlike Intl.DateTimeFormat's locale-dependent time rendering. */
export function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatCurrency(value: number | null): string {
  if (value == null) return '—';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

/** Maps the two reserved model-legend buckets (see profile-usage/profile-timeline's
 * top-7 + unknown/other convention) to a human label; any other model id passes through. */
export function readableModel(model: string): string {
  if (model === 'unknown') return 'Unknown model';
  if (model === 'other') return 'Other models';
  return model;
}
