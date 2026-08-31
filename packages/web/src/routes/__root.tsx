import { createRootRoute, Outlet } from '@tanstack/react-router';

// Stub: f4 replaces the body with <AppShell>.
function RootLayout() {
  return <Outlet />;
}

export const Route = createRootRoute({ component: RootLayout });
