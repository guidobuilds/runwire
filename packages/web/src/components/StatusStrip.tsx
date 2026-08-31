import { useProjects, useRescan, useStatus } from '../api/queries';
import { formatRelative } from '../lib/format';
import { Button } from './ui/Button';

/**
 * The shell's status strip (design.md §9): when the data was last scanned, how
 * many root sessions it covers, and the Rescan control that refreshes both.
 *
 * Single instance per page, so it subscribes to its queries directly — the
 * hoisting rule that applies to bulk cell renderers (design.md §5) is not in
 * play here.
 */
export function StatusStrip() {
  const status = useStatus();
  const projects = useProjects();
  const rescan = useRescan();

  const startedAt = status.data?.lastReport?.startedAt;
  const lastScan = startedAt ? formatRelative(startedAt, Date.now()) : 'never';

  const rootSessions = projects.data?.reduce((sum, project) => sum + project.sessionCount, 0);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-zinc-200 px-4 py-1.5 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
      <span>Last scan {lastScan}</span>
      <span>
        {rootSessions === undefined ? '… root sessions' : `${rootSessions} root sessions`}
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={rescan.isPending}
        onClick={() => rescan.mutate()}
      >
        {rescan.isPending ? 'Scanning…' : 'Rescan'}
      </Button>
      {rescan.error ? (
        <span className="text-red-700 dark:text-red-400" role="alert">
          Rescan failed: {rescan.error instanceof Error ? rescan.error.message : 'unknown error'}
        </span>
      ) : null}
    </div>
  );
}
