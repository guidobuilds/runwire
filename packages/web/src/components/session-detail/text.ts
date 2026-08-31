/**
 * Longest on-screen run of a free-form string (session title, working directory).
 * BL-18: nothing in the domain model bounds these, so the header caps them and
 * keeps the full text in the hover `title` — the cap is the on-screen bound, the
 * attribute is the escape hatch, and neither is the only channel.
 */
export const MAX_TEXT = 120;

/** Single-line, length-capped rendering of a free-form string. */
export function clampText(text: string, max: number = MAX_TEXT): string {
  const oneLine = text.replace(/\s+/gu, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * `SessionSummary.harnessVersion` is `{ first, last }`. The implementation
 * moved to `lib/format.ts` when `defaultFormat` grew its own
 * `harnessVersion` branch (BL-15 residual): the detail header and a metric
 * cell must render the range identically, so there is exactly one function.
 * Re-exported here so this module stays the header's formatting entry point.
 */
export { formatVersionRange } from '../../lib/format';
