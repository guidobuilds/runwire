import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { setInclusive, setShowTitles, usePrefs } from '../state/prefs';
import { StatusStrip } from './StatusStrip';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Toggle } from './ui/Toggle';

const NAV_LINK =
  'rounded-md px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800';
const NAV_LINK_ACTIVE = 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100';

/**
 * The application shell (design.md §9): navigation, the global Compare action,
 * the two display toggles, the status strip, and the routed view.
 *
 * `dark:` variants follow the OS appearance; there is no in-app theme switch.
 */
export function AppShell() {
  const prefs = usePrefs();
  const navigate = useNavigate();
  const trayCount = prefs.compareTray.length;

  return (
    <div className="min-h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <span className="text-base font-semibold">Scout</span>

          <nav className="flex items-center gap-1">
            <Link to="/projects" className={NAV_LINK} activeProps={{ className: NAV_LINK_ACTIVE }}>
              Projects
            </Link>
            <Link to="/harnesses" className={NAV_LINK} activeProps={{ className: NAV_LINK_ACTIVE }}>
              Harnesses
            </Link>
          </nav>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 lg:ml-auto">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                // Comma-joined, in tray order — design.md §8's `/compare?ids=a,b`.
                // `routes/compare.tsx` normalises a list to the same form, so the
                // join is for readability of the URL, not for correctness.
                void navigate({ to: '/compare', search: { ids: prefs.compareTray.join(',') } });
              }}
            >
              Compare sessions
              <Badge tone={trayCount > 0 ? 'info' : 'neutral'}>{trayCount}</Badge>
            </Button>

            <Toggle label="Inclusive" checked={prefs.inclusive} onCheckedChange={setInclusive} />
            <Toggle label="Titles" checked={prefs.showTitles} onCheckedChange={setShowTitles} />
          </div>
        </div>

        <StatusStrip />
      </header>

      <main className="px-4 py-4">
        <Outlet />
      </main>
    </div>
  );
}
