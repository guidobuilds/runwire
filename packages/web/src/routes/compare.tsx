import { createFileRoute } from '@tanstack/react-router';

export type CompareSearch = { ids: string[] };

/**
 * `?ids=a,b,c` -> `['a', 'b', 'c']`. Trimmed, de-duplicated, empties dropped,
 * URL order preserved (design.md §4: URL order is compare column order, so this
 * must never sort). Anything that is not a string yields an empty list.
 */
export function parseCompareIds(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (id.length > 0) seen.add(id);
  }
  return [...seen];
}

// Stub: f7 replaces the body with <CompareSelector> + <CompareView>.
function CompareRoute() {
  return <h1>Compare</h1>;
}

export const Route = createFileRoute('/compare')({
  validateSearch: (search: Record<string, unknown>): CompareSearch => ({
    ids: parseCompareIds(search.ids),
  }),
  component: CompareRoute,
});
