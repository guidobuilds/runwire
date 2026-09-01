import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useProjectSessions, useProjects } from '../api/queries';
import type { ProjectAggregate } from '../api/types';
import { EmptyState, useHasData } from '../components/EmptyState';
import {
  GroupCard,
  sortByLatestActivityDesc,
  sparklineSeriesFromSessions,
  useDisplayNames,
} from '../components/GroupCard';
import { GroupGrid } from '../components/GroupGrid';
import { PageHeading } from '../components/PageHeading';
import { Badge } from '../components/primitives/Badge';
import { QueryState } from '../components/primitives/QueryState';

type ProjectCardProps = {
  aggregate: ProjectAggregate;
  displayNameFor: (harnessId: string) => string;
  onOpen: (key: string) => void;
};

/**
 * One project's own root-session list, fetched here (not in the route body)
 * so each card owns exactly one `useProjectSessions` call -- `GroupGrid` maps
 * a variable-length, query-driven list, and hooks cannot live inside that
 * loop (design.md §4/§5: the sparkline is derived client-side, no new
 * endpoint).
 */
function ProjectCard({ aggregate, displayNameFor, onOpen }: ProjectCardProps) {
  const sessions = useProjectSessions(aggregate.project.key);
  const series = sessions.data
    ? sparklineSeriesFromSessions(sessions.data.summaries, sessions.data.rollups)
    : [];

  return (
    <GroupCard
      direction="project"
      name={aggregate.project.name}
      avatarLabel={aggregate.project.name}
      sessionCount={aggregate.sessionCount}
      crossDimension={aggregate.harnesses.map(displayNameFor)}
      latestActivityAt={aggregate.latestActivityAt}
      aggregateUsage={aggregate.aggregateUsage}
      sparklineSeries={series}
      meta={
        <>
          <Badge>{aggregate.project.identity}</Badge>
          {aggregate.project.worktree ? (
            <Badge tone="info">worktree: {aggregate.project.worktree}</Badge>
          ) : null}
        </>
      }
      onOpen={() => onOpen(aggregate.project.key)}
    />
  );
}

function ProjectsIndexRoute() {
  const navigate = useNavigate();
  const projects = useProjects();
  const displayNameFor = useDisplayNames();
  const hasData = useHasData();

  if (!hasData) return <EmptyState />;

  const onOpen = (key: string) => {
    // `$key` is passed raw (design.md §2); the router percent-encodes it and
    // the server decodes once.
    void navigate({ to: '/projects/$key', params: { key } });
  };

  return (
    <section className="space-y-4">
      <PageHeading
        eyebrow="Scout"
        title="Projects"
        description="Every detected project, grouped from sessions across every harness."
      />

      <QueryState isPending={projects.isPending} error={projects.error} refetch={projects.refetch}>
        <GroupGrid>
          {sortByLatestActivityDesc(projects.data ?? []).map((aggregate) => (
            <ProjectCard
              key={aggregate.project.key}
              aggregate={aggregate}
              displayNameFor={displayNameFor}
              onOpen={onOpen}
            />
          ))}
        </GroupGrid>
      </QueryState>
    </section>
  );
}

export const Route = createFileRoute('/projects/')({ component: ProjectsIndexRoute });
