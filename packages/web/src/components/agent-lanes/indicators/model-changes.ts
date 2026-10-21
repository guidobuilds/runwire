import type { LaneModelData } from '../model';

export function modelChanges(model: LaneModelData) {
  return model.cols.flatMap((col) =>
    col.events.flatMap((event) =>
      event.kind === 'model-change'
        ? [
            {
              agentId: col.agentId,
              index: col.index,
              position: event.after ? ('after' as const) : ('before' as const),
              dashed: true,
              event,
            },
          ]
        : [],
    ),
  );
}
