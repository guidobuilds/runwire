import type { SessionSummary } from '../api/types';

/** Compact token counts: 1234 → "1.2k", 3200000 → "3.2M", 0 → "0". */
export function formatTokens(n: number): string {
  if (n === 0) return '0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}${oneDecimal(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}${oneDecimal(abs / 1_000)}k`;
  return `${sign}${String(abs)}`;
}

function oneDecimal(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

/** Duration from milliseconds: "< 1 min", "18 min", "1 h 05 min". */
export function formatDuration(ms: number): string {
  const totalMin = Math.floor(Math.max(0, ms) / 60_000);
  if (totalMin < 1) return '< 1 min';
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours === 0) return `${minutes} min`;
  return `${hours} h ${String(minutes).padStart(2, '0')} min`;
}

/** Relative time. `now` is injected so the function stays pure. */
export function formatRelative(iso: string, now: Date | number | string): string {
  const then = new Date(iso).getTime();
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(then) || !Number.isFinite(nowMs)) return iso;
  const diffSec = Math.floor((nowMs - then) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return 'just now';
  const future = diffSec < 0;
  const units: Array<[number, string]> = [
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
    [86400 * 7, 'week'],
    [86400 * 30, 'month'],
    [86400 * 365, 'year'],
  ];
  let value = 1;
  let unit = 'minute';
  for (let i = units.length - 1; i >= 0; i--) {
    const entry = units[i];
    if (!entry) continue;
    const [secs, name] = entry;
    if (abs >= secs) {
      value = Math.floor(abs / secs);
      unit = name;
      break;
    }
  }
  const label = value === 1 ? unit : `${unit}s`;
  return future ? `in ${value} ${label}` : `${value} ${label} ago`;
}

/** Locale short date-time. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(d);
}

export function formatUsd(cost: { usd: number }): string {
  return `$${cost.usd.toFixed(2)}`;
}

/**
 * Git facts exactly as the domain model publishes them. Derived from
 * `SessionSummary` so a shape change in `packages/core` fails typecheck here
 * instead of silently reaching a formatter that no longer matches.
 */
export type GitFacts = NonNullable<SessionSummary['git']>;

/** First 7 characters of a commit sha — the conventional short form. */
export function shortCommit(commit: string): string {
  return commit.trim().slice(0, 7);
}

/**
 * Git facts as one line: "scout · main · a1b2c3d". Only the parts the harness
 * actually reported appear, in most-stable-first order; an object with none of
 * the three fields yields "" (callers fall back — see `formatUnknownValue`).
 */
export function formatGit(git: GitFacts): string {
  return [
    git.repoName?.trim(),
    git.branch?.trim(),
    git.commit?.trim() ? shortCommit(git.commit) : undefined,
  ]
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' · ');
}

/**
 * `SessionSummary.harnessVersion` as the domain model publishes it — the
 * version seen at the first and last event of the session.
 */
export type VersionRange = NonNullable<SessionSummary['harnessVersion']>;

/**
 * The harness version as one line: `1.2.3` when it never moved,
 * `1.2.3 → 1.2.4` when it did, and `""` when neither end carries content (the
 * caller then falls back to the shared absence rendering).
 */
export function formatVersionRange(version: { first?: string; last?: string } | undefined): string {
  const first = version?.first?.trim() ?? '';
  const last = version?.last?.trim() ?? '';
  if (first === '' && last === '') return '';
  if (first === '' || last === '' || first === last) return first === '' ? last : first;
  return `${first} → ${last}`;
}

/**
 * `SessionSummary.title` as the domain model publishes it: the text plus the
 * flag marking it as content-derived (D7 — the shell's title toggle is what
 * decides whether it is shown at all).
 */
export type TitleFacts = NonNullable<SessionSummary['title']>;

/** Visible marker for a value that cannot be described honestly at all. */
export const UNFORMATTED = '(unformatted)';

/**
 * Last resort for a value no field formatter claims.
 *
 * `String(value)` is deliberately never used here: for any non-primitive it
 * produces the literal text `[object Object]` (or `a,b` for an array), which is
 * wrong on-screen output with no error and no failing test. Primitives render as
 * themselves; anything structured renders as compact JSON, so the cell shows
 * what it actually holds; and a value JSON cannot describe (cycle, function,
 * symbol, empty object) degrades to a searchable `(unformatted)` marker.
 */
export function formatUnknownValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value === null || value === undefined) return UNFORMATTED;
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    return UNFORMATTED;
  }
  if (json === undefined || json === 'null' || json === '{}' || json === '[]') return UNFORMATTED;
  return json;
}

/**
 * Drops the `<harness>:` prefix and keeps the first 8 characters of the source id.
 * Session ids are `${harness}:${sourceId}` (see SessionSummary.id).
 */
export function shortId(sessionId: string): string {
  const colon = sessionId.indexOf(':');
  const source = colon === -1 ? sessionId : sessionId.slice(colon + 1);
  return source.slice(0, 8);
}
