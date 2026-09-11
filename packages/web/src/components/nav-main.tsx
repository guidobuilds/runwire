import { Link, useMatchRoute } from '@tanstack/react-router';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';

// f6: "Quick Create" + the mail-icon button (fictional CLI-scaffolded chrome
// with no Scout equivalent) were dropped. Items with a `url` render as real
// TanStack Router links and pick up active-route styling via `isActive`; items
// with an `onClick` (actions such as Scan) render an enabled button; items with
// neither ("Projects"/"Harnesses" -- no views built yet) render as inert,
// disabled buttons rather than linking to a route that doesn't exist.
export type NavMainItem = {
  title: string;
  url?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
};

export function NavMain({ items }: { items: NavMainItem[] }) {
  const matchRoute = useMatchRoute();

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          {items.map((item) =>
            item.url ? (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  tooltip={item.title}
                  isActive={matchRoute({ to: item.url, fuzzy: true }) !== false}
                  render={<Link to={item.url} />}
                >
                  {item.icon}
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ) : item.onClick ? (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton tooltip={item.title} onClick={item.onClick}>
                  {item.icon}
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ) : (
              // No `tooltip` here: SidebarMenuButton wraps tooltip-bearing
              // buttons in Base UI's TooltipTrigger, which intercepts `disabled`
              // into `data-trigger-disabled` instead of a real native `disabled`
              // attribute (verified empirically). Without `tooltip`, `disabled`
              // passes straight through to the underlying <button>.
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton disabled>
                  {item.icon}
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ),
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
