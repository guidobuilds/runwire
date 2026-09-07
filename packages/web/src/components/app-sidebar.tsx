import {
  CircleHelpIcon,
  FolderIcon,
  LayoutDashboardIcon,
  ServerIcon,
  Settings2Icon,
  TerminalIcon,
} from 'lucide-react';
import type * as React from 'react';
import { NavMain } from '@/components/nav-main';
import { NavSecondary } from '@/components/nav-secondary';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';

// Scout branding + navigation. `navClouds`/`documents` from the CLI-generated
// dashboard-01 block had no Scout equivalent (fictional proposal/document-library
// nav) and were dropped rather than repurposed. f6: "Projects"/"Harnesses" are
// inert placeholders (no views yet); user-account chrome removed entirely (local-
// only app, no accounts).
const data = {
  navMain: [
    {
      title: 'Sessions',
      url: '/sessions',
      icon: <LayoutDashboardIcon />,
    },
    {
      title: 'Projects',
      icon: <FolderIcon />,
    },
    {
      title: 'Harnesses',
      icon: <ServerIcon />,
    },
  ],
  navSecondary: [
    {
      title: 'Settings',
      url: '#',
      icon: <Settings2Icon />,
    },
    {
      title: 'Get Help',
      url: '#',
      icon: <CircleHelpIcon />,
    },
  ],
};
export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[slot=sidebar-menu-button]:p-1.5!"
              render={<a href="/sessions" />}
            >
              <TerminalIcon className="size-5!" />
              <span className="text-base font-semibold">Scout</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
    </Sidebar>
  );
}
