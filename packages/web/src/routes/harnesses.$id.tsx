import { createFileRoute } from '@tanstack/react-router';

// Stub: f5 replaces the body with <SessionTable scope="harness">.
function HarnessSessionsRoute() {
  return <h1>Harness</h1>;
}

export const Route = createFileRoute('/harnesses/$id')({ component: HarnessSessionsRoute });
