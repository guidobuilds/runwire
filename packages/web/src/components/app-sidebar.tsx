import { useNavigate } from '@tanstack/react-router';
import {
  CircleHelpIcon,
  FolderIcon,
  LayoutDashboardIcon,
  ScanSearchIcon,
  ServerIcon,
  Settings2Icon,
} from 'lucide-react';
import type * as React from 'react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { NavMain, type NavMainItem } from '@/components/nav-main';
import { NavSecondary } from '@/components/nav-secondary';
import { RunwireMark } from '@/components/runwire-mark';
import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { useScanMutation } from '@/queries/scan';

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
  ] satisfies NavMainItem[],
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

function ScanConfirmDialog({
  open,
  isPending,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  isPending: boolean;
  error: string | undefined;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm scan"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
        <h2 className="text-lg font-semibold">Scan for sessions</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Runwire re-reads every harness source and imports new or changed sessions into the local
          database. This can take a moment.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Scan configuration is not available yet.
        </p>
        {isPending ? (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            Scanning…
          </p>
        ) : null}
        {error !== undefined ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            Scan failed: {error}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" type="button" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={isPending}>
            Run scan
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const [scanOpen, setScanOpen] = useState(false);
  const navigate = useNavigate();
  const scan = useScanMutation();

  const navMain: NavMainItem[] = [
    ...data.navMain,
    {
      title: 'Scan',
      icon: <ScanSearchIcon />,
      onClick: () => {
        scan.reset();
        setScanOpen(true);
      },
    },
  ];

  const confirmScan = () => {
    scan.mutate(undefined, {
      onSuccess: () => {
        setScanOpen(false);
        void navigate({ to: '/sessions' });
      },
    });
  };

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[slot=sidebar-menu-button]:p-1.5!"
              render={<a href="/sessions" />}
            >
              <RunwireMark className="size-5 shrink-0" />
              <span className="text-base font-semibold tracking-tight">runwire</span>
              <span
                className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-medium text-[10px] text-amber-700 uppercase tracking-wide dark:text-amber-400"
                title="Runwire is early beta: interfaces and data may change"
              >
                beta
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <ScanConfirmDialog
        open={scanOpen}
        isPending={scan.isPending}
        error={scan.error instanceof Error ? scan.error.message : undefined}
        onCancel={() => setScanOpen(false)}
        onConfirm={confirmScan}
      />
    </Sidebar>
  );
}
