import { createFileRoute, type SearchSchemaInput, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';

/**
 * What a caller may hand to `navigate`/`Link`. `SearchSchemaInput` is what
 * splits this from the validated output: without it TanStack demands the
 * *output* shape from every caller.
 *
 * The shell passes `tray.join(',')`; a list is accepted too and normalised to
 * the same comma form, so no caller can produce a URL the route cannot read.
 */
export type CompareSearchInput = { ids?: string | readonly string[] } & SearchSchemaInput;

/**
 * What `validateSearch` guarantees, what TanStack serialises into the URL, and
 * what every component reads.
 *
 * `ids` is the **normalised comma-joined string**, not a list, and that is
 * deliberate: TanStack Router serialises the *validated output*, so design.md
 * §8's comma form is a property of this type.
 *
 * What this type fixes is the **value**, `'a,b'` — not how the address bar
 * renders it. TanStack's default stringifier is `URLSearchParams.toString()`,
 * which percent-encodes the separator, so the emitted query is `?ids=a%2Cb`
 * and it decodes to §8's `ids=a,b`. A hand-typed `/compare?ids=a,b` with a
 * literal comma is honoured on the way in and yields the same selection. Both
 * halves are asserted in `compare.test.tsx`. Emitting a literal comma would
 * need a router-wide `stringifySearch` and is out of scope.
 *
 * A `string[]` output serialises as JSON (`?ids=%5B%22a%22%5D`) and, because
 * the validator runs a second time during route matching, is then re-validated
 * from a list nobody parses back.
 *
 * Components turn it into the list with {@link parseCompareIds} — or, inside
 * the route, with {@link useCompareIds}.
 */
export type CompareSearch = { ids?: string };

/**
 * `'a,b,c'` -> `['a', 'b', 'c']`. Trimmed, de-duplicated, empties dropped, URL
 * order preserved (design.md §4: URL order is compare column order, so this
 * must never sort).
 *
 * Total over everything that can reach it, which is more than the URL: a comma
 * string, a list of ids (what a caller may pass to `navigate`, and what the
 * router hands back when a search param repeats), `undefined`, and any other
 * value. Non-string members are dropped rather than coerced — `String(v)` here
 * would turn a stray object into the id `[object Object]` and then request it.
 */
export function parseCompareIds(raw: unknown): string[] {
  const parts: string[] = [];
  const take = (value: unknown): void => {
    if (typeof value !== 'string') return;
    for (const part of value.split(',')) parts.push(part.trim());
  };

  if (Array.isArray(raw)) {
    for (const item of raw as readonly unknown[]) take(item);
  } else {
    take(raw);
  }

  const seen = new Set<string>();
  for (const id of parts) {
    if (id.length > 0) seen.add(id);
  }
  return [...seen];
}

/**
 * The route's search validator, exported so a test can drive the real one.
 *
 * Idempotent by construction — `validateCompareSearch(validateCompareSearch(x))`
 * equals `validateCompareSearch(x)` for every `x` — which the route needs
 * because TanStack runs it twice: once over the caller's input when building
 * the location, once over the already-validated search when matching it.
 *
 * An empty selection yields `undefined` rather than `''`, so the URL is a bare
 * `/compare` (design.md §8: an empty tray opens the selector alone).
 */
export function validateCompareSearch(search: CompareSearchInput): CompareSearch {
  const ids = parseCompareIds(search.ids);
  return { ids: ids.length > 0 ? ids.join(',') : undefined };
}

// Stub: f7 replaces the body with <CompareSelector> + <CompareView>.
function CompareRoute() {
  return <h1>Compare</h1>;
}

export const Route = createFileRoute('/compare')({
  validateSearch: validateCompareSearch,
  component: CompareRoute,
});

/**
 * The compare selection in URL order — the one accessor a component under
 * `/compare` should use. Keeps the string/list split in one place so no caller
 * has to remember that the search param is a comma string.
 *
 * The array identity is **stable across renders** and changes only when the raw
 * `ids` string does. That is part of the contract, not an optimisation:
 * design.md §8 asks for `setTray(ids)` on mount, whose obvious spelling is
 * `useEffect(() => setTray(ids), [ids])`, and an accessor that allocated a fresh
 * array per call re-fired that effect on every render (verification-f4-fix.md
 * U3). Pinned by `compare.test.tsx`.
 */
export function useCompareIds(): string[] {
  const search = useSearch({ strict: false }) as CompareSearch;
  return useMemo(() => parseCompareIds(search.ids), [search.ids]);
}
