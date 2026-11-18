export type TimeDomainMs = { start: number; end: number };

export function toMs(iso: string | null): number | null {
  if (iso === null) return null;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed;
}

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
    if (startMs !== null && (end === null || startMs > end))
      end = Math.max(end ?? startMs, startMs);
  }
  if (start === null || end === null) return null;
  return { start, end: Math.max(start, end) };
}

const pad = (value: number) => String(value).padStart(2, '0');

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

export function relativeLabel(ms: number, domainStart: number): string {
  const diff = Math.max(0, ms - domainStart);
  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `+${hours}h ${pad(minutes)}m`;
  return `+${minutes}m ${pad(seconds)}s`;
}
