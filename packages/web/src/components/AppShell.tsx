import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useHarnesses, useProjects } from '../api/queries';
import { setInclusive, setShowTitles, usePrefs } from '../state/prefs';
import { CommandPalette } from './CommandPalette';
import { Badge } from './primitives/Badge';
import { LabeledSwitch } from './primitives/LabeledSwitch';
import { StatusStrip } from './StatusStrip';
import { Button } from './ui/button';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { TooltipProvider } from './ui/tooltip';

const NAV_LINK =
  'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground';
const NAV_LINK_ACTIVE = 'bg-sidebar-accent font-medium text-sidebar-accent-foreground';

/**
 * Route pathname -> topbar breadcrumb text (design.md §5). A pure function
 * (not a hook) so it stays testable without a router, and so an unknown
 * pathname degrades to a capitalized first segment instead of throwing.
 */
export function breadcrumbLabel(pathname: string): string {
  const [, first = ''] = pathname.split('/');
  switch (first) {
    case '':
      return 'Sessions';
    case 'projects':
      return 'Projects';
    case 'harnesses':
      return 'Harnesses';
    case 'compare':
      return 'Compare';
    case 'sessions':
      return 'Session detail';
    default:
      return first.charAt(0).toUpperCase() + first.slice(1);
  }
}

/**
 * The application shell (design.md §5/§9): sidebar navigation with live
 * counts, the topbar (breadcrumb, ⌘K search, the global Compare action, and
 * the two display toggles), the status strip, and the routed view. The two
 * toggles and the Compare tray badge render once here -- not per-route -- so
 * they stay visible and functional on every screen.
 *
 * `dark:` variants follow the OS appearance; there is no in-app theme switch.
 */
export function AppShell() {
  const prefs = usePrefs();
  const navigate = useNavigate();
  const trayCount = prefs.compareTray.length;
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const projects = useProjects();
  const harnesses = useHarnesses();
  const sessionCount = projects.data?.reduce((sum, project) => sum + project.sessionCount, 0);
  const projectCount = projects.data?.length;
  const harnessCount = harnesses.data?.length;

  return (
    <TooltipProvider>
      <div className="flex min-h-screen bg-background text-foreground">
        <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
          <div className="flex items-center gap-2 px-4 py-3">
            <span className="text-base font-semibold">Scout</span>
            <Badge tone="neutral" className="ml-auto">
              LOCAL
            </Badge>
          </div>

          <nav className="flex flex-1 flex-col gap-0.5 px-2" aria-label="Explore">
            <p className="px-2 pt-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Explore
            </p>
            <Link
              to="/"
              className={NAV_LINK}
              activeProps={{ className: NAV_LINK_ACTIVE }}
              activeOptions={{ exact: true }}
            >
              <span>Sessions</span>
              <span className="ml-auto text-xs text-muted-foreground">{sessionCount ?? ''}</span>
            </Link>
            <Link to="/projects" className={NAV_LINK} activeProps={{ className: NAV_LINK_ACTIVE }}>
              <span>Projects</span>
              <span className="ml-auto text-xs text-muted-foreground">{projectCount ?? ''}</span>
            </Link>
            <Link to="/harnesses" className={NAV_LINK} activeProps={{ className: NAV_LINK_ACTIVE }}>
              <span>Harnesses</span>
              <span className="ml-auto text-xs text-muted-foreground">{harnessCount ?? ''}</span>
            </Link>
          </nav>

          <div className="flex flex-col gap-0.5 px-2 pb-2">
            {/* Non-functional placeholders (brief §5): present, not wired. */}
            <button
              type="button"
              className="flex items-center rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              Settings
            </button>
            <button
              type="button"
              className="flex items-center rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              Help
            </button>
          </div>

          <p className="border-t border-sidebar-border px-4 py-3 text-xs text-muted-foreground">
            Local data only
          </p>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-border">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
              <nav aria-label="Breadcrumb" className="text-sm font-medium">
                {breadcrumbLabel(pathname)}
              </nav>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 lg:ml-auto">
                <CommandPalette />

                <ToggleGroup
                  aria-label="Inclusive or exclusive totals"
                  value={[prefs.inclusive ? 'inclusive' : 'exclusive']}
                  onValueChange={(next) => {
                    // A single-select segmented control must always keep
                    // exactly one option pressed; Base UI's own toggle
                    // semantics allow un-pressing the active item down to an
                    // empty selection, which this ignores rather than lets
                    // through as "neither".
                    if (next.length === 0) return;
                    setInclusive(next.includes('inclusive'));
                  }}
                >
                  <ToggleGroupItem value="inclusive">Inclusive</ToggleGroupItem>
                  <ToggleGroupItem value="exclusive">Exclusive</ToggleGroupItem>
                </ToggleGroup>

                <LabeledSwitch
                  label="Titles"
                  checked={prefs.showTitles}
                  onCheckedChange={setShowTitles}
                />

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
              </div>
            </div>

            <StatusStrip />
          </header>

          <main className="flex-1 px-4 py-4">
            <Outlet />
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
