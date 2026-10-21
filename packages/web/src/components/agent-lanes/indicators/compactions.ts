import type { LaneModelData } from '../model';

export function compactions(model: LaneModelData) {
  return model.cols.flatMap((col) =>
    col.events.flatMap((event) =>
      event.kind === 'compaction'
        ? [
            {
              agentId: col.agentId,
              index: col.index,
              position: event.after ? ('after' as const) : ('before' as const),
              event,
            },
          ]
        : [],
    ),
  );
}
