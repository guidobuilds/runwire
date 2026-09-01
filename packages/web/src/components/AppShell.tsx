import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useHarnesses, useProjects } from '../api/queries';
import { setInclusive, setShowTitles, usePrefs } from '../state/prefs';
import { CommandPalette } from './CommandPalette';
import { Badge } from './primitives/Badge';
import { LabeledSwitch } from './primitives/LabeledSwitch';
import { StatusStrip } from './StatusStrip';
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from './ui/breadcrumb';
import { Button } from './ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from './ui/sidebar';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { TooltipProvider } from './ui/tooltip';

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
 * Built on shadcn's real `Sidebar`/`Breadcrumb` primitive families
 * (`ui/sidebar.tsx`, `ui/breadcrumb.tsx`, installed via `shadcn add`, not
 * hand-rolled) so the mobile Sheet fallback, the collapsible rail, and the
 * keyboard shortcut (Cmd/Ctrl+B) all come for free.
 *
 * `dark:` variants follow the OS appearance; there is no in-app theme switch.
 */
export function AppShell() {
  const prefs = usePrefs();
  const navigate = useNavigate();
  const trayCount = prefs.compareTray.length;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // First path segment drives both the sidebar's active-item highlighting and
  // (via `breadcrumbLabel`) the topbar breadcrumb, so both stay in lockstep
  // with a single read of the current route.
  const firstSegment = pathname.split('/')[1] ?? '';

  const projects = useProjects();
  const harnesses = useHarnesses();
  const sessionCount = projects.data?.reduce((sum, project) => sum + project.sessionCount, 0);
  const projectCount = projects.data?.length;
  const harnessCount = harnesses.data?.length;

  return (
    <TooltipProvider>
      <SidebarProvider>
        <Sidebar>
          <SidebarHeader>
            <div className="flex items-center gap-2 px-2 py-1">
              <span className="text-base font-semibold">Scout</span>
              <Badge tone="neutral" className="ml-auto">
                LOCAL
              </Badge>
            </div>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Explore</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={firstSegment === ''}
                      render={
                        <Link to="/" activeOptions={{ exact: true }}>
                          <span>Sessions</span>
                          <span className="ml-auto text-xs text-muted-foreground">
                            {sessionCount ?? ''}
                          </span>
                        </Link>
                      }
                    />
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={firstSegment === 'projects'}
                      render={
                        <Link to="/projects">
                          <span>Projects</span>
                          <span className="ml-auto text-xs text-muted-foreground">
                            {projectCount ?? ''}
                          </span>
                        </Link>
                      }
                    />
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={firstSegment === 'harnesses'}
                      render={
                        <Link to="/harnesses">
                          <span>Harnesses</span>
                          <span className="ml-auto text-xs text-muted-foreground">
                            {harnessCount ?? ''}
                          </span>
                        </Link>
                      }
                    />
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter>
            {/* Non-functional placeholders (brief §5): present, not wired. */}
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton type="button">Settings</SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton type="button">Help</SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <SidebarSeparator />
            <p className="px-2 py-1 text-xs text-muted-foreground">Local data only</p>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>

        <SidebarInset>
          <header className="border-b border-border">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
              <SidebarTrigger />

              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbPage>{breadcrumbLabel(pathname)}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>

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

          {/* Not a second `<main>` -- `SidebarInset` above already renders one
              (`data-slot="sidebar-inset"`), and a nested `main` would create a
              second landmark. `data-slot="app-content"` marks the routed
              region for the focus-order test without claiming the role. */}
          <div data-slot="app-content" className="flex-1 px-4 py-4">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
