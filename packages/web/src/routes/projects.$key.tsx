import { createFileRoute } from '@tanstack/react-router';

// Stub: f5 replaces the body with <SessionTable scope="project">.
function ProjectSessionsRoute() {
  return <h1>Project</h1>;
}

export const Route = createFileRoute('/projects/$key')({ component: ProjectSessionsRoute });
