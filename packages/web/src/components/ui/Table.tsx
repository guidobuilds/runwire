import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';

export type TableProps = HTMLAttributes<HTMLTableElement>;

export function Table({ className, ...props }: TableProps) {
  return (
    <div className="overflow-x-auto">
      <table
        className={['w-full border-collapse text-sm text-zinc-800 dark:text-zinc-200', className]
          .filter(Boolean)
          .join(' ')}
        {...props}
      />
    </div>
  );
}

export function Thead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={['border-b border-zinc-200 dark:border-zinc-700', className]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  );
}

export function Tbody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...props} />;
}

export function Tr({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={['border-b border-zinc-100 dark:border-zinc-800', className]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  );
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
  const classes = [
    'px-2 py-1.5 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <th aria-sort={sortable ? sortDirection : undefined} className={classes} {...props}>
      {sortable ? (
        <button
          type="button"
          className="inline-flex items-center gap-0.5 hover:text-zinc-800 dark:hover:text-zinc-100"
          onClick={onSort}
        >
          {children}
          {indicator}
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export type TdProps = TdHTMLAttributes<HTMLTableCellElement> & {
  numeric?: boolean;
};

export function Td({ numeric, className, ...props }: TdProps) {
  const classes = ['px-2 py-1.5', numeric ? 'text-right tabular-nums' : undefined, className]
    .filter(Boolean)
    .join(' ');
  return <td className={classes} {...props} />;
}
