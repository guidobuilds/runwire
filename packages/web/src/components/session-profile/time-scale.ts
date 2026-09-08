/** Shared wall-clock scale helpers for the agent graph and the token chart —
 * both charts must agree on the same domain and tick formatting so they read
 * as one shared timeline (G6/G7). Pure, no React/Recharts dependency. */

export type TimeDomainMs = { start: number; end: number };

/** Parses an ISO timestamp to epoch ms. Null/invalid input returns null —
 * never NaN, never a fabricated 0. */
export function toMs(iso: string | null): number | null {
  if (iso === null) return null;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Builds the shared ms domain from every usable start/end pair. A row that
 * contributes only one usable bound (e.g. `endedAt: null`) still contributes
 * that one bound. Returns null when nothing in the input set is usable —
 * callers must render the empty/fallback state rather than a fabricated
 * domain. */
export function buildTimeDomain(
  inputs: readonly { start: string | null; end: string | null }[],
): TimeDomainMs | null {
  let start: number | null = null;
  let end: number | null = null;
  for (const input of inputs) {
    const startMs = toMs(input.start);
    if (startMs !== null && (start === null || startMs < start)) start = startMs;
    const endMs = toMs(input.end);
    if (endMs !== null && (end === null || endMs > end)) end = endMs;
    // A row with only a start (open-ended) still pushes the domain end
    // forward if it is the latest known instant so open-ended bars aren't
    // clipped to whatever else is on screen.
    if (startMs !== null && (end === null || startMs > end))
      end = Math.max(end ?? startMs, startMs);
  }
  if (start === null || end === null) return null;
  return { start, end: Math.max(start, end) };
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Returns a tick formatter for the given domain: `HH:MM` for spans of an
 * hour or more, `HH:MM:SS` for shorter spans where minute-level ticks would
 * collapse distinct instants. */
export function tickFormatter(domain: TimeDomainMs): (ms: number) => string {
  const span = domain.end - domain.start;
  const showSeconds = span < 60 * 60 * 1000;
  return (ms: number) => {
    const date = new Date(ms);
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    if (!showSeconds) return `${hh}:${mm}`;
    return `${hh}:${mm}:${pad(date.getSeconds())}`;
  };
}

/** Formats an instant relative to the domain start, e.g. `+3m 12s` or
 * `+1h 04m`. Negative offsets (should not occur once a domain is built
 * correctly) are clamped to zero rather than shown as negative. */
export function relativeLabel(ms: number, domainStart: number): string {
  const diff = Math.max(0, ms - domainStart);
  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `+${hours}h ${pad(minutes)}m`;
  return `+${minutes}m ${pad(seconds)}s`;
}
