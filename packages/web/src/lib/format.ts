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
 * Drops the `<harness>:` prefix and keeps the first 8 characters of the source id.
 * Session ids are `${harness}:${sourceId}` (see SessionSummary.id).
 */
export function shortId(sessionId: string): string {
  const colon = sessionId.indexOf(':');
  const source = colon === -1 ? sessionId : sessionId.slice(colon + 1);
  return source.slice(0, 8);
}
