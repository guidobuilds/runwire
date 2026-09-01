import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';
import {
  TableBody as ShadcnTbody,
  TableCell as ShadcnTd,
  TableHead as ShadcnTh,
  TableHeader as ShadcnThead,
  TableRow as ShadcnTr,
} from '../ui/table';

/**
 * L2 wrapper around the CLI-vendored `ui/table` (design.md §2): the vendored
 * primitives have no notion of a sortable header or a numeric column, so this
 * preserves the exact `Table`/`Thead`/`Tbody`/`Tr`/`Th`/`Td` API the M4
 * hand-rolled `ui/Table.tsx` exposed (`sortable`/`sortDirection`/`onSort` on
 * `Th`, `numeric` on `Td`) -- every call site needed only an import-path
 * change, not a rewrite.
 */
export type TableProps = HTMLAttributes<HTMLTableElement> & {
  /**
   * Classes for the single scroll-owning container div. Deliberately NOT
   * delegating to vendored `ui/table.tsx`'s own `Table` here: that component
   * bundles its own `<div data-slot="table-container" className="... w-full
   * overflow-x-auto">` with no way to inject extra classes into that specific
   * div. Wrapping THAT in a second `overflow-y-auto` div (as an earlier build
   * did) nests two overflow-auto containers -- per the CSS spec a div with
   * overflow-x: auto also computes overflow-y: auto, so the inert inner div
   * becomes a second valid sticky-positioning containing block and wins over
   * the outer one that actually scrolls, breaking `<Thead sticky>`. See
   * `.forge/lessons.md`'s `nested-overflow-auto-breaks-sticky-th`. This
   * reproduces just the vendored `Table` function's container+table pairing
   * locally so there is exactly one scroll container. Defaults to
   * `overflow-x-auto` (matching the vendored default) when omitted; a caller
   * that also needs vertical scroll (e.g. a sticky-header region) should pass
   * both axes here, e.g. `"overflow-auto max-h-[...]"`, instead of adding an
   * ancestor wrapper.
   */
  containerClassName?: string;
};

export function Table({ containerClassName, className, ...props }: TableProps) {
  return (
    <div
      data-slot="table-container"
      className={cn('relative w-full', containerClassName ?? 'overflow-x-auto')}
    >
      <table
        data-slot="table"
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  );
}

export type TheadProps = HTMLAttributes<HTMLTableSectionElement> & {
  /**
   * Cascades sticky positioning + an opaque background onto every `th`
   * inside via a descendant-selector class on the `<thead>` itself (the
   * same pattern the vendored `ui/table.tsx` already uses for
   * `[&_tr]:border-b`) -- callers get a sticky header with one prop instead
   * of annotating each `Th` individually. `top-0`/`z-10` are relative to the
   * nearest scrolling ancestor, so this only pins within whatever wrapper
   * the caller scrolls (datatable-filters-revamp).
   */
  sticky?: boolean;
};

export function Thead({ sticky, className, ...props }: TheadProps) {
  return (
    <ShadcnThead
      className={cn(
        sticky && '[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-background',
        className,
      )}
      {...props}
    />
  );
}

export function Tbody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <ShadcnTbody {...props} />;
}

export function Tr(props: HTMLAttributes<HTMLTableRowElement>) {
  return <ShadcnTr {...props} />;
}

export type ThProps = ThHTMLAttributes<HTMLTableCellElement> & {
  sortable?: boolean;
  sortDirection?: 'ascending' | 'descending' | 'none';
  onSort?: () => void;
  children: ReactNode;
};

export function Th({
  sortable,
  sortDirection = 'none',
  onSort,
  children,
  className,
  ...props
}: ThProps) {
  const indicator =
    !sortable || sortDirection === 'none' ? null : sortDirection === 'ascending' ? ' ▲' : ' ▼';

  return (
    <ShadcnTh aria-sort={sortable ? sortDirection : undefined} className={className} {...props}>
      {sortable ? (
        <button
          type="button"
          className="inline-flex items-center gap-0.5 hover:text-foreground"
          onClick={onSort}
        >
          {children}
          {indicator}
        </button>
      ) : (
        children
      )}
    </ShadcnTh>
  );
}

export type TdProps = TdHTMLAttributes<HTMLTableCellElement> & {
  numeric?: boolean;
};

export function Td({ numeric, className, ...props }: TdProps) {
  return (
    <ShadcnTd
      className={cn(numeric ? 'text-right tabular-nums' : undefined, className)}
      {...props}
    />
  );
}
