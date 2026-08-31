import { createRootRoute } from '@tanstack/react-router';
import { AppShell } from '../components/AppShell';

// AppShell renders its own <Outlet/>, so it is the root component directly.
export const Route = createRootRoute({ component: AppShell });
