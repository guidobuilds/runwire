import { createFileRoute } from '@tanstack/react-router';

// Stub: f4 replaces the body with <ProjectsList>.
function ProjectsIndexRoute() {
  return <h1>Projects</h1>;
}

export const Route = createFileRoute('/projects/')({ component: ProjectsIndexRoute });
