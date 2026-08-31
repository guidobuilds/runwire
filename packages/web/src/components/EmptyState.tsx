import { useStatus } from '../api/queries';
import { Badge } from './ui/Badge';

/**
 * False when Scout has nothing to show: no scan has completed yet, or every
 * adapter parsed zero sources (design.md §9).
 *
 * While `GET /api/status` is still in flight the answer is unknown, and this
 * returns `true` on purpose — flashing the doctor-like empty state during a
 * normal load would tell the developer their machine has no sessions when it
 * simply has not been asked yet.
 */
export function useHasData(): boolean {
  const { data } = useStatus();
  if (!data) return true;
  const report = data.lastReport;
  if (!report) return false;
  const parsed = Object.values(report.perAdapter).reduce((sum, adapter) => sum + adapter.parsed, 0);
  return parsed > 0;
}

/**
 * Doctor-like no-data view: what each adapter probed, so the developer can see
 * why nothing was found without leaving the browser (design.md §9).
 */
export function EmptyState() {
  const { data } = useStatus();
  const adapters = data?.adapters ?? [];

  return (
    <section className="space-y-4 text-sm text-zinc-700 dark:text-zinc-300">
      <div>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          No sessions found
        </h2>
        <p className="mt-1">Scout scanned this machine and parsed no sessions.</p>
      </div>

      <ul className="space-y-3">
        {adapters.map((adapter) => (
          <li
            key={adapter.id}
            className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {adapter.displayName}
              </span>
              <Badge tone={adapter.probe.installed ? 'success' : 'warn'}>
                {adapter.probe.installed ? 'installed' : 'not installed'}
              </Badge>
            </div>
            <p className="mt-1">
              Roots: {adapter.probe.roots.length > 0 ? adapter.probe.roots.join(', ') : 'none'}
            </p>
            {adapter.probe.notes.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {adapter.probe.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>

      <p>
        Run <code className="font-mono">scout doctor</code> for details
      </p>
    </section>
  );
}
