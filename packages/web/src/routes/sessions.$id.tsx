import { createFileRoute } from '@tanstack/react-router';

// Stub: f6 replaces the body with <SessionDetail>.
function SessionDetailRoute() {
  return <h1>Session</h1>;
}

export const Route = createFileRoute('/sessions/$id')({ component: SessionDetailRoute });
