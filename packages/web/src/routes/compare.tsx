import {
  createFileRoute,
  Link,
  type SearchSchemaInput,
  useNavigate,
  useSearch,
} from '@tanstack/react-router';
import { useEffect, useMemo } from 'react';
import { useCompareSessions } from '../api/queries';
import type { Metric } from '../api/types';
import { CompareCell } from '../components/compare/CompareCell';
import { CompareRibbons } from '../components/compare/CompareRibbons';
import { PageHeading } from '../components/PageHeading';
import { Badge } from '../components/primitives/Badge';
import { HarnessLogo } from '../components/primitives/HarnessLogo';
import { QueryState } from '../components/primitives/QueryState';
import { Table, Tbody, Td, Th, Thead, Tr } from '../components/primitives/Table';
import { useHarnessDirectory } from '../components/session-table/harness-directory';
import type { SessionRow } from '../components/session-table/model';
import { toSessionRows } from '../components/session-table/model';
import { Button, buttonVariants } from '../components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '../components/ui/empty';
import type { FieldKey } from '../lib/capabilities';
import { setTray, usePrefs } from '../state/prefs';

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

type MetricRowDef = {
  key: string;
  label: string;
  field: FieldKey;
  align: 'left' | 'right';
  getMetric: (row: SessionRow) => Metric<unknown> | undefined;
};

/** The metric rows below Harness/Project (design.md §5's row list). `suffix`
 * is the same "(incl.)"/"(excl.)" label `SessionTable` puts on its own usage
 * columns -- `toSessionRows` already resolves `usage` against the same
 * global `prefs.inclusive` toggle, so reusing the label keeps the two
 * screens honest about which total is on screen. */
function metricRowDefs(suffix: string): MetricRowDef[] {
  return [
    { key: 'model', label: 'Model', field: 'model', align: 'left', getMetric: (row) => row.model },
    { key: 'mode', label: 'Mode', field: 'mode', align: 'left', getMetric: (row) => row.mode },
    {
      key: 'durationMs',
      label: 'Duration',
      field: 'durationMs',
      align: 'right',
      getMetric: (row) => row.durationMs,
    },
    {
      key: 'uncachedInput',
      label: `Input ${suffix}`,
      field: 'uncachedInput',
      align: 'right',
      getMetric: (row) => row.usage.uncachedInput,
    },
    {
      key: 'cachedInput',
      label: `Cached ${suffix}`,
      field: 'cachedInput',
      align: 'right',
      getMetric: (row) => row.usage.cachedInput,
    },
    {
      key: 'output',
      label: `Output ${suffix}`,
      field: 'output',
      align: 'right',
      getMetric: (row) => row.usage.output,
    },
    {
      key: 'subagents',
      label: 'Subagents',
      field: 'subagents',
      align: 'right',
      getMetric: (row) => row.subagents,
    },
  ];
}

/**
 * Compare view (design.md §5, docs/PRODUCT-UI.md §4.6): metric-label column +
 * N session columns. D40 -- exactly two special cell treatments beyond plain
 * (`CompareCell` owns that; no third "incomparable" bucket), and no winner
 * highlighting anywhere in this component -- this view gives evidence, not a
 * verdict.
 */
function CompareRoute() {
  const ids = useCompareIds();
  const navigate = useNavigate();
  const prefs = usePrefs();
  const harnesses = useHarnessDirectory();
  const { data, isPending, error, refetch } = useCompareSessions(ids);

  // Keeps `prefs.compareTray` (the shell's badge count, and what "Compare
  // sessions" seeds on the next visit) in sync with whatever this screen is
  // actually showing, including right after a column remove (which
  // re-navigates to a smaller `ids` below). `useCompareIds()` hands back the
  // SAME array identity for one selection (its own contract, pinned below),
  // so this effect runs once per distinct selection, never once per render.
  useEffect(() => {
    setTray(ids);
  }, [ids]);

  const sessionRows = useMemo(
    () => (data ? toSessionRows(data.summaries, data.rollups, prefs) : []),
    [data, prefs],
  );
  // URL order is compare column order (this file's own `parseCompareIds` doc
  // comment) -- never re-sort by whatever order the server returned
  // summaries in. An id that did not resolve (deleted/unknown harness data)
  // simply gets no column, rather than a broken one.
  const rows = useMemo(() => {
    const byId = new Map(sessionRows.map((row) => [row.id, row]));
    return ids.map((id) => byId.get(id)).filter((row): row is SessionRow => row !== undefined);
  }, [ids, sessionRows]);

  const removeColumn = (id: string) => {
    const next = ids.filter((existing) => existing !== id);
    void navigate({ to: '/compare', search: { ids: next.join(',') } });
  };

  if (ids.length === 0) {
    return (
      <section className="space-y-4">
        <PageHeading
          eyebrow="Compare"
          title="Compare sessions"
          description="Evidence, side by side — no winner, no auto-computed verdict."
        />
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No sessions to compare yet</EmptyTitle>
            <EmptyDescription>
              Add sessions to the compare tray from the Sessions table, then come back here.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Link to="/" className={buttonVariants({ variant: 'default' })}>
              Go to Sessions
            </Link>
          </EmptyContent>
        </Empty>
      </section>
    );
  }

  const suffix = prefs.inclusive ? '(incl.)' : '(excl.)';
  const rowDefs = metricRowDefs(suffix);

  return (
    <section className="space-y-4">
      <PageHeading
        eyebrow="Compare"
        title="Compare sessions"
        description="Evidence, side by side — no winner, no auto-computed verdict."
      />

      <QueryState isPending={isPending} error={error} refetch={refetch}>
        {rows.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <Table>
                <Thead>
                  <Tr>
                    <Th scope="col">Metric</Th>
                    {rows.map((row) => (
                      <Th key={row.id} scope="col">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate" title={row.label}>
                              {row.label}
                            </span>
                            {/*
                             * Compare resolves sessions by explicit id and is
                             * never narrowed by the global "Automated"
                             * preference (packages/server/src/routes.ts) -- the
                             * tray persists, so comparing sessions the tables
                             * currently refuse to list is a reachable state.
                             * Dropping the column would delete the user's own
                             * selection; labelling it explains why this session
                             * is here and not over there.
                             */}
                            {row.isAutomated && !prefs.showAutomated ? (
                              <Badge tone="neutral" className="shrink-0 text-[10px]">
                                automated
                              </Badge>
                            ) : null}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Remove ${row.label} from comparison`}
                            onClick={() => removeColumn(row.id)}
                          >
                            <span aria-hidden="true">×</span>
                          </Button>
                        </div>
                      </Th>
                    ))}
                  </Tr>
                </Thead>
                <Tbody>
                  <Tr>
                    <Th scope="row">Harness</Th>
                    {rows.map((row) => (
                      <Td key={row.id}>
                        <HarnessLogo
                          harnessId={row.harness}
                          displayName={harnesses?.[row.harness]?.displayName}
                          size="sm"
                        />
                      </Td>
                    ))}
                  </Tr>
                  <Tr>
                    <Th scope="row">Project</Th>
                    {rows.map((row) => (
                      <Td key={row.id}>
                        <span className="flex flex-col">
                          <span>{row.projectName}</span>
                          {row.projectWorktree ? (
                            <span className="text-xs text-muted-foreground">
                              {row.projectWorktree}
                            </span>
                          ) : null}
                        </span>
                      </Td>
                    ))}
                  </Tr>
                  {rowDefs.map((def) => (
                    <Tr key={def.key}>
                      <Th scope="row">{def.label}</Th>
                      {rows.map((row) => (
                        <Td key={row.id} numeric={def.align === 'right'}>
                          <CompareCell
                            field={def.field}
                            harness={row.harness}
                            capabilities={harnesses?.[row.harness]?.capabilities}
                            displayName={harnesses?.[row.harness]?.displayName}
                            metric={def.getMetric(row)}
                          />
                        </Td>
                      ))}
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>

            <div className="space-y-2">
              <h2 className="text-sm font-medium text-foreground">Trace</h2>
              <CompareRibbons rows={rows.map((row) => ({ id: row.id, label: row.label }))} />
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            None of the selected sessions could be found — they may have been removed by a rescan.
          </p>
        )}
      </QueryState>
    </section>
  );
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
