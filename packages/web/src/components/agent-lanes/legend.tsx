import { laneRoleSwatches } from './renderer/theme';

export type LegendProps = { bucketSize: number };

export function Legend({ bucketSize }: LegendProps) {
  const { kinds, tiers } = laneRoleSwatches();
  return (
    <section
      aria-label="Agent lanes legend"
      className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t px-3 py-2 text-xs"
    >
      {[...kinds, ...tiers].map(({ label, token }) => (
        <span key={token} className="inline-flex items-center gap-1">
          <span
            aria-hidden="true"
            className="inline-block size-2 rounded-sm"
            style={{ backgroundColor: `var(${token})` }}
          />
          {label}
        </span>
      ))}
      <span className="ml-auto text-muted-foreground">
        1 column = {bucketSize} {bucketSize === 1 ? 'call' : 'calls'}
      </span>
    </section>
  );
}
