import { useMemo } from 'react';
import { useStatus } from '../../api/queries';
import type { HarnessDirectory, HarnessInfo } from './model';

/**
 * Resolves capabilities + display name for every known adapter from ONE
 * `['status']` query, for callers that render many `MetricCell`s.
 *
 * This hook lives outside `SessionTable.tsx` on purpose. `SessionTable` takes
 * the directory as a prop and subscribes to nothing, which is what lets its
 * suite assert that a rendered session view holds **zero** `['status']`
 * observers (design.md §6, f5-t4). Route components call this once and hand the
 * result down; while status is still loading it returns `undefined`, the
 * documented loading value for `MetricCell.capabilities`.
 */
export function useHarnessDirectory(): HarnessDirectory | undefined {
  const { data } = useStatus();

  return useMemo(() => {
    if (!data) return undefined;
    const directory: Record<string, HarnessInfo> = {};
    for (const adapter of data.adapters) {
      directory[adapter.id] = {
        capabilities: adapter.capabilities,
        displayName: adapter.displayName,
      };
    }
    return directory;
  }, [data]);
}
