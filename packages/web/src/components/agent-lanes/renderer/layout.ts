import type { LaneModelData, ModelAgent } from '../model';
import type { Viewport } from '../viewport';

export const LABEL_WIDTH = 168;
export const AXIS_HEIGHT = 26;
export const LANE_HEIGHT = 30;
export const CONTEXT_HEIGHT = 92;
export const NAVIGATOR_HEIGHT = 30;
export const SCROLLBAR_WIDTH = 12;
export type Rect = { x: number; y: number; width: number; height: number };
export type LayoutOptions = { fullscreen?: boolean; collapsed?: ReadonlySet<string> };
export type LanePlacement = { agent: ModelAgent; y: number; hidden: number };
export type Layout = {
  width: number;
  height: number;
  view: Viewport;
  labels: Rect;
  axis: Rect;
  lanesArea: Rect;
  context: Rect;
  navigator: Rect;
  scrollbar: Rect | null;
  thumb: Rect | null;
  lanes: LanePlacement[];
  scrollY: number;
  maxScrollY: number;
};

export function layout(
  width: number,
  height: number,
  view: Viewport,
  scrollY: number,
  model: LaneModelData,
  options: LayoutOptions = {},
): Layout {
  width = Math.max(0, width);
  height = Math.max(0, height);
  const lanes: LanePlacement[] = [];
  const hiddenBy = new Map<string, LanePlacement>();
  for (const agent of model.agents) {
    const ancestor = agent.parentId ? hiddenBy.get(agent.parentId) : undefined;
    if (ancestor) {
      ancestor.hidden++;
      hiddenBy.set(agent.id, ancestor);
      continue;
    }
    const placement = { agent, y: 0, hidden: 0 };
    lanes.push(placement);
    if (options.collapsed?.has(agent.id)) hiddenBy.set(agent.id, placement);
  }
  const available = Math.max(0, height - AXIS_HEIGHT - CONTEXT_HEIGHT - NAVIGATOR_HEIGHT);
  const laneHeight = Math.min(
    available,
    (options.fullscreen ? lanes.length : Math.min(10, lanes.length)) * LANE_HEIGHT,
  );
  const maxScrollY = Math.max(0, lanes.length * LANE_HEIGHT - laneHeight);
  scrollY = Math.max(0, Math.min(maxScrollY, scrollY));
  const scrollbarWidth = maxScrollY > 0 ? Math.min(width, SCROLLBAR_WIDTH) : 0;
  const labelWidth = Math.min(width, LABEL_WIDTH);
  const plotWidth = Math.max(0, width - labelWidth - scrollbarWidth);
  const axis = { x: labelWidth, y: 0, width: plotWidth, height: AXIS_HEIGHT };
  const lanesArea = { ...axis, y: AXIS_HEIGHT, height: laneHeight };
  const labels = { x: 0, y: AXIS_HEIGHT, width: labelWidth, height: laneHeight };
  const context = { ...axis, y: AXIS_HEIGHT + laneHeight, height: CONTEXT_HEIGHT };
  const navigator = { ...axis, y: context.y + CONTEXT_HEIGHT, height: NAVIGATOR_HEIGHT };
  const scrollbar = scrollbarWidth
    ? { x: width - scrollbarWidth, y: AXIS_HEIGHT, width: scrollbarWidth, height: laneHeight }
    : null;
  const thumbHeight = Math.min(
    laneHeight,
    Math.max(20, laneHeight ** 2 / (lanes.length * LANE_HEIGHT)),
  );
  const thumb = scrollbar
    ? {
        ...scrollbar,
        y: scrollbar.y + (scrollY / maxScrollY) * (laneHeight - thumbHeight),
        height: thumbHeight,
      }
    : null;
  lanes.forEach((lane, index) => {
    lane.y = AXIS_HEIGHT + index * LANE_HEIGHT - scrollY;
  });
  return {
    width,
    height: navigator.y + NAVIGATOR_HEIGHT,
    view,
    labels,
    axis,
    lanesArea,
    context,
    navigator,
    scrollbar,
    thumb,
    lanes,
    scrollY,
    maxScrollY,
  };
}
