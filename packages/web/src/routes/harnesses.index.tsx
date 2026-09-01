import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useHarnesses, useHarnessSessions, useStatus } from '../api/queries';
import type { HarnessAggregate, StatusResponse } from '../api/types';
import { EmptyState, useHasData } from '../components/EmptyState';
import {
  GroupCard,
  sortByLatestActivityDesc,
  sparklineSeriesFromSessions,
  useDisplayNames,
} from '../components/GroupCard';
import { GroupGrid } from '../components/GroupGrid';
import { PageHeading } from '../components/PageHeading';
import { HarnessLogo } from '../components/primitives/HarnessLogo';
import { QueryState } from '../components/primitives/QueryState';

type AdapterInfo = StatusResponse['adapters'][number];

type MergedHarness = HarnessAggregate & { emptyVariant?: 'installed-no-sessions' };

/**
 * `useHarnesses()` only ever returns a harness with at least one root session
 * (`ScoutStore.getHarnesses()` derives its list from `getRoots()`), so an
 * installed-but-empty adapter never appears there at all. Merges in a
 * zero-session placeholder for every adapter `GET /api/status` reports as
 * installed and not already present -- brief §4.3's "installed but nothing
 * found yet" is a real state, not an artifact of an incomplete aggregate, and
 * this is client-side only (no new endpoint, design.md §5).
 */
export function mergeInstalledHarnesses(
  aggregates: readonly HarnessAggregate[],
  adapters: readonly AdapterInfo[],
): MergedHarness[] {
  const present = new Set(aggregates.map((aggregate) => aggregate.harness));
  const placeholders: MergedHarness[] = adapters
    .filter((adapter) => adapter.probe.installed && !present.has(adapter.id))
    .map((adapter) => ({
      harness: adapter.id,
      sessionCount: 0,
      projects: [],
      aggregateUsage: {},
      emptyVariant: 'installed-no-sessions',
    }));
  return [...aggregates, ...placeholders];
}

type HarnessCardProps = {
  aggregate: HarnessAggregate;
  displayNameFor: (harnessId: string) => string;
  onOpen: (id: string) => void;
};

/** A harness with at least one session: fetches its own root sessions for the sparkline. */
function HarnessCard({ aggregate, displayNameFor, onOpen }: HarnessCardProps) {
  const sessions = useHarnessSessions(aggregate.harness);
  const series = sessions.data
    ? sparklineSeriesFromSessions(sessions.data.summaries, sessions.data.rollups)
    : [];
  const name = displayNameFor(aggregate.harness);

  return (
    <GroupCard
      direction="harness"
      name={name}
      avatar={<HarnessLogo harnessId={aggregate.harness} displayName={name} size="lg" />}
      sessionCount={aggregate.sessionCount}
      crossDimension={aggregate.projects}
      latestActivityAt={aggregate.latestActivityAt}
      aggregateUsage={aggregate.aggregateUsage}
      sparklineSeries={series}
      onOpen={() => onOpen(aggregate.harness)}
    />
  );
}

type EmptyHarnessCardProps = {
  harnessId: string;
  displayNameFor: (harnessId: string) => string;
  onOpen: (id: string) => void;
};

/**
 * The zero-session placeholder: a distinct component (not a branch inside
 * `HarnessCard`) so it never calls `useHarnessSessions` at all -- there is
 * nothing to fetch, and a session fetch for a harness the aggregate already
 * proves is empty would be a wasted request. Rendering it as its own
 * component type, chosen by the caller's `.map()`, keeps this rule-of-hooks
 * clean rather than skipping a hook conditionally inside one component.
 */
function EmptyHarnessCard({ harnessId, displayNameFor, onOpen }: EmptyHarnessCardProps) {
  const name = displayNameFor(harnessId);
  return (
    <GroupCard
      direction="harness"
      name={name}
      avatar={<HarnessLogo harnessId={harnessId} displayName={name} size="lg" />}
      sessionCount={0}
      crossDimension={[]}
      aggregateUsage={{}}
      sparklineSeries={[]}
      emptyVariant="installed-no-sessions"
      onOpen={() => onOpen(harnessId)}
    />
  );
}

function HarnessesIndexRoute() {
  const navigate = useNavigate();
  const harnesses = useHarnesses();
  const status = useStatus();
  const displayNameFor = useDisplayNames();
  const hasData = useHasData();

  if (!hasData) return <EmptyState />;

  const onOpen = (id: string) => {
    void navigate({ to: '/harnesses/$id', params: { id } });
  };

  const merged = mergeInstalledHarnesses(harnesses.data ?? [], status.data?.adapters ?? []);

  return (
    <section className="space-y-4">
      <PageHeading
        eyebrow="Scout"
        title="Harnesses"
        description="Every installed harness, grouped from sessions across every project."
      />

      <QueryState
        isPending={harnesses.isPending}
        error={harnesses.error}
        refetch={harnesses.refetch}
      >
        <GroupGrid>
          {sortByLatestActivityDesc(merged).map((aggregate) =>
            aggregate.emptyVariant === 'installed-no-sessions' ? (
              <EmptyHarnessCard
                key={aggregate.harness}
                harnessId={aggregate.harness}
                displayNameFor={displayNameFor}
                onOpen={onOpen}
              />
            ) : (
              <HarnessCard
                key={aggregate.harness}
                aggregate={aggregate}
                displayNameFor={displayNameFor}
                onOpen={onOpen}
              />
            ),
          )}
        </GroupGrid>
      </QueryState>
    </section>
  );
}

export const Route = createFileRoute('/harnesses/')({ component: HarnessesIndexRoute });
