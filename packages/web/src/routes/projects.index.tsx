import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ProjectsList } from '../components/ProjectsList';

function ProjectsIndexRoute() {
  const navigate = useNavigate();
  return (
    <ProjectsList
      onOpen={(key) => {
        // `$key` is passed raw (design.md §2); the router percent-encodes it and
        // the server decodes once.
        void navigate({ to: '/projects/$key', params: { key } });
      }}
    />
  );
}

export const Route = createFileRoute('/projects/')({ component: ProjectsIndexRoute });
