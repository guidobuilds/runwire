import type { ReactNode } from 'react';
import { Button } from '../ui/button';

export type QueryStateProps = {
  isPending?: boolean;
  isLoading?: boolean;
  error?: unknown;
  refetch?: () => unknown;
  notFound?: boolean;
  children: ReactNode;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.length > 0) return error;
  return 'Something went wrong';
}

export function QueryState({
  isPending,
  isLoading,
  error,
  refetch,
  notFound,
  children,
}: QueryStateProps) {
  if (isPending || isLoading) {
    return (
      <div className="animate-pulse space-y-2" role="status" aria-label="Loading">
        <div className="h-4 w-full rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-4 w-5/6 rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-4 w-2/3 rounded bg-zinc-200 dark:bg-zinc-800" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-start gap-2 text-sm" role="alert">
        <p className="text-red-700 dark:text-red-400">{errorMessage(error)}</p>
        {refetch ? (
          <Button variant="secondary" size="sm" onClick={() => void refetch()}>
            Retry
          </Button>
        ) : null}
      </div>
    );
  }

  if (notFound) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Not found</p>;
  }

  return <>{children}</>;
}
