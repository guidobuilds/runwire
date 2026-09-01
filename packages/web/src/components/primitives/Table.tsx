import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';
import {
  TableBody as ShadcnTbody,
  TableCell as ShadcnTd,
  TableHead as ShadcnTh,
  TableHeader as ShadcnThead,
  TableRow as ShadcnTr,
  Table as TableRoot,
} from '../ui/table';

/**
 * L2 wrapper around the CLI-vendored `ui/table` (design.md §2): the vendored
 * primitives have no notion of a sortable header or a numeric column, so this
 * preserves the exact `Table`/`Thead`/`Tbody`/`Tr`/`Th`/`Td` API the M4
 * hand-rolled `ui/Table.tsx` exposed (`sortable`/`sortDirection`/`onSort` on
 * `Th`, `numeric` on `Td`) -- every call site needed only an import-path
 * change, not a rewrite.
 */
export type TableProps = HTMLAttributes<HTMLTableElement>;

export function Table(props: TableProps) {
  return <TableRoot {...props} />;
}

export function Thead(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <ShadcnThead {...props} />;
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
