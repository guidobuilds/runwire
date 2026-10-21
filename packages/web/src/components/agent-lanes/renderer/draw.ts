import type { Finding, RuleId } from '../detections';
import { IDLE_MS } from '../indicators/idle';
import type { LaneColumn, LaneModelData } from '../model';
import { bucket, bucketSize, ppc, tickStep, type Viewport, xOf } from '../viewport';
import { LANE_HEIGHT, type Layout, type LayoutOptions, layout, type Rect } from './layout';
import type { LaneTheme, LaneToken } from './theme';

export type FrameState = {
  width: number;
  height: number;
  view: Viewport;
  scrollY: number;
  dpr?: number;
};
export type DrawOptions = LayoutOptions & {
  enabledIndicators?: readonly string[];
  /** Findings must already be filtered by these rules; detection never runs inside draw. */
  enabledDetections?: readonly RuleId[];
  findings?: readonly Finding[];
  threshold?: number;
  selectedAgentId?: string | null;
  focusedFinding?: Finding | null;
  overview?: readonly number[];
};

export function truncateLabel(
  text: string,
  width: number,
  measure: (text: string) => number,
): string {
  if (measure(text) <= width) return text;
  for (let length = text.length - 1; length > 0; length--) {
    const candidate = `${text.slice(0, length)}…`;
    if (measure(candidate) <= width) return candidate;
  }
  return '';
}

export function axisTicks(view: Viewport, width: number): { index: number; label: string }[] {
  const step = Math.max(1, tickStep((view.span * 70) / Math.max(1, width)));
  const ticks = [];
  for (
    let index = Math.ceil(view.start / step) * step;
    index < view.start + view.span;
    index += step
  ) {
    ticks.push({ index, label: String(index + 1) });
  }
  return ticks;
}

export function idleCuts(cols: readonly LaneColumn[]) {
  return cols.flatMap((col, i) => {
    const previous = cols[i - 1];
    const duration = previous ? col.at - previous.at : 0;
    const minutes = Math.floor(duration / 60_000);
    const label = minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
    return duration > IDLE_MS ? [{ index: col.index, duration, label }] : [];
  });
}

function lowerBound(cols: readonly LaneColumn[], index: number): number {
  let low = 0;
  let high = cols.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((cols[mid]?.index ?? Infinity) < index) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function visibleColumns(
  cols: readonly LaneColumn[],
  from: number,
  to: number,
): LaneColumn[] {
  return cols.slice(lowerBound(cols, from), lowerBound(cols, to));
}

/** Caller memoizes by model revision and plot width: one value per navigator pixel. */
export function prepareOverview(model: LaneModelData, width: number): number[] {
  const bins = Array.from({ length: Math.max(0, Math.floor(width)) }, () => 0);
  for (const col of model.cols) {
    const index = Math.min(
      bins.length - 1,
      Math.floor((col.index / Math.max(1, model.callCount)) * bins.length),
    );
    if (index >= 0) bins[index] = (bins[index] ?? 0) + 1;
  }
  return bins;
}

function clip(ctx: CanvasRenderingContext2D, rect: Rect, draw: () => void) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  draw();
  ctx.restore();
}

/** Stateless complete frame in CSS pixels; the hook/shell owns requestAnimationFrame. */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  model: LaneModelData,
  state: FrameState,
  options: DrawOptions,
  theme: LaneTheme,
): Layout {
  const zones = layout(state.width, state.height, state.view, state.scrollY, model, options);
  const dpr = state.dpr ?? globalThis.devicePixelRatio ?? 1;
  const canvas = ctx.canvas;
  const pixelWidth = Math.round(state.width * dpr);
  const pixelHeight = Math.round(zones.height * dpr);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  canvas.style.width = `${state.width}px`;
  canvas.style.height = `${zones.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.fillStyle = theme['--lane-background'];
  ctx.fillRect(0, 0, zones.width, zones.height);
  ctx.font = '11px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1;
  const enabled = (id: string) =>
    !options.enabledIndicators || options.enabledIndicators.includes(id);
  const x = (index: number) => zones.axis.x + xOf(state.view, zones.axis.width, index);
  const pixels = ppc(state.view, zones.axis.width);
  const size = pixels > 0 ? bucketSize(pixels) : 1;
  const from = Math.floor(state.view.start / size) * size;
  const to = Math.ceil((state.view.start + state.view.span) / size) * size;
  const line = (x1: number, y1: number, x2: number, y2: number, token: LaneToken) => {
    ctx.strokeStyle = theme[token];
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  const findings = options.enabledDetections?.length === 0 ? [] : (options.findings ?? []);
  const visibleLanes = zones.lanes.filter(
    (lane) =>
      lane.y + LANE_HEIGHT > zones.lanesArea.y &&
      lane.y < zones.lanesArea.y + zones.lanesArea.height,
  );
  const placements = new Map(zones.lanes.map((lane) => [lane.agent.id, lane]));
  clip(ctx, zones.lanesArea, () => {
    for (const lane of visibleLanes) {
      const { agent, y } = lane;
      line(zones.axis.x, y + 29, zones.axis.x + zones.axis.width, y + 29, '--lane-grid');
      const cols = visibleColumns(agent.cols, from, to);
      for (const group of bucket(cols, size)) {
        const left = x(group.from);
        const width = Math.max(1, pixels * size - 1);
        ctx.fillStyle = theme[`--lane-kind-${group.kind}`];
        ctx.fillRect(left, y + 10, width, 14);
        if (group.tier) {
          ctx.fillStyle = theme[`--lane-tier-${group.tier}`];
          ctx.fillRect(left, y + 25, width, 3);
        }
      }
      for (const col of cols) {
        const cx = x(col.index) + pixels / 2;
        const marks = [
          ['skills', col.marks.skills, '--lane-skill'],
          ['mcp', col.marks.mcp, '--lane-kind-mcp'],
          ['failures', col.marks.failures, '--lane-failure'],
          ['subagents', col.marks.subagents, '--lane-kind-agent'],
        ] as const;
        marks.forEach(([id, count, token], i) => {
          if (enabled(id) && count) {
            ctx.fillStyle = theme[token];
            ctx.fillRect(cx - 4 + i * 2, y + 3, 2, 4);
          }
        });
        if (enabled('subagents')) {
          for (const childId of col.spawns) {
            const child = placements.get(childId);
            const first = child?.agent.cols[0];
            if (!child || !first) continue;
            line(cx, y + 17, x(first.index), child.y + 17, '--lane-kind-agent');
          }
        }
        for (const event of col.events) {
          const compaction = event.kind === 'compaction';
          if (!enabled(compaction ? 'compactions' : 'model-changes')) continue;
          ctx.setLineDash(compaction ? [] : [2, 2]);
          const eventX = x(col.index + (event.after ? 1 : 0));
          line(eventX, y, eventX, y + 29, compaction ? '--lane-compaction' : '--lane-tier-high');
          ctx.setLineDash([]);
        }
      }
      for (const finding of findings) {
        if (finding.agentId !== agent.id || finding.to < from || finding.from >= to) continue;
        ctx.strokeStyle = theme['--lane-detection'];
        ctx.lineWidth = options.focusedFinding === finding ? 3 : 1;
        ctx.strokeRect(x(finding.from), y + 1, (finding.to - finding.from + 1) * pixels, 28);
        ctx.lineWidth = 1;
      }
    }
    if (enabled('subagents')) {
      for (const lane of zones.lanes) {
        const parent = lane.agent.parentId ? placements.get(lane.agent.parentId) : undefined;
        const first = lane.agent.cols[0];
        const last = lane.agent.cols.at(-1);
        if (!parent || !first || !last || last.index < from || first.index >= to) continue;
        ctx.setLineDash([3, 3]);
        line(x(first.index), parent.y + 17, x(last.index + 1), parent.y + 17, '--lane-muted');
        ctx.setLineDash([]);
        // Retain the incoming connector if its spawn lies outside the visible range.
        if (first.index >= from && first.index < to) {
          const previous = parent.agent.cols[lowerBound(parent.agent.cols, first.index) - 1];
          if (!previous || previous.index < from) {
            line(x(first.index), parent.y + 17, x(first.index), lane.y + 17, '--lane-kind-agent');
          }
        }
      }
    }
  });
  clip(ctx, zones.labels, () => {
    for (const { agent, y, hidden } of visibleLanes) {
      ctx.fillStyle =
        theme[agent.id === options.selectedAgentId ? '--lane-surface' : '--lane-background'];
      ctx.fillRect(0, y, zones.labels.width, LANE_HEIGHT);
      ctx.fillStyle = theme['--lane-foreground'];
      const label = `${agent.agentType || agent.id}${hidden ? ` +${hidden} hidden` : ''}`;
      const indent = Math.min(60, agent.depth * 10) + 8;
      ctx.fillText(
        truncateLabel(
          label,
          zones.labels.width - indent - 6,
          (text) => ctx.measureText(text).width,
        ),
        indent,
        y + 16,
      );
    }
  });
  clip(ctx, zones.axis, () => {
    ctx.fillStyle = theme['--lane-muted'];
    for (const tick of axisTicks(state.view, zones.axis.width))
      ctx.fillText(tick.label, x(tick.index) + 2, 12);
    if (enabled('idle')) {
      // Include the preceding column to retain cuts at the viewport's left boundary.
      const start = Math.max(0, lowerBound(model.cols, state.view.start) - 1);
      const end = lowerBound(model.cols, state.view.start + state.view.span);
      for (const cut of idleCuts(model.cols.slice(start, end))) {
        ctx.fillStyle = theme['--lane-idle'];
        ctx.fillText(`// ${cut.label}`, x(cut.index), 21);
      }
    }
  });
  clip(ctx, zones.context, () => {
    ctx.fillStyle = theme['--lane-surface'];
    ctx.fillRect(zones.context.x, zones.context.y, zones.context.width, zones.context.height);
    if (!enabled('context')) return;
    const bottom = zones.context.y + zones.context.height - 6;
    const cy = (percent: number) => bottom - Math.min(100, Math.max(0, percent)) * 0.75;
    ctx.setLineDash([3, 3]);
    line(
      zones.context.x,
      cy(options.threshold ?? 85),
      zones.context.x + zones.context.width,
      cy(options.threshold ?? 85),
      '--lane-detection',
    );
    ctx.setLineDash([]);
    const agents = [...model.agents].sort(
      (a, b) => Number(a.id === options.selectedAgentId) - Number(b.id === options.selectedAgentId),
    );
    for (const agent of agents) {
      ctx.globalAlpha = !options.selectedAgentId || agent.id === options.selectedAgentId ? 1 : 0.18;
      ctx.strokeStyle = theme['--lane-context'];
      ctx.beginPath();
      let connected = false;
      for (const col of bucket(visibleColumns(agent.cols, from - size, to + size), size)) {
        if (col.maxContextPercent === null) {
          connected = false;
          continue;
        }
        const px = x(col.from) + (pixels * size) / 2;
        if (connected) ctx.lineTo(px, cy(col.maxContextPercent));
        else ctx.moveTo(px, cy(col.maxContextPercent));
        connected = true;
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });
  clip(ctx, zones.navigator, () => {
    const nav = zones.navigator;
    const nx = (index: number) => nav.x + (index / Math.max(12, model.callCount)) * nav.width;
    ctx.fillStyle = theme['--lane-muted'];
    const overview = options.overview ?? [];
    const peak = Math.max(1, ...overview);
    overview.forEach((count, i) => {
      ctx.fillRect(nav.x + i, nav.y + 25 - (count / peak) * 20, 1, (count / peak) * 20);
    });
    for (const finding of findings) {
      line(nx(finding.from), nav.y + 3, nx(finding.to + 1), nav.y + 3, '--lane-detection');
    }
    ctx.strokeStyle = theme['--lane-foreground'];
    ctx.strokeRect(
      nx(state.view.start),
      nav.y + 1,
      (state.view.span / Math.max(12, model.callCount)) * nav.width,
      28,
    );
  });
  if (zones.scrollbar && zones.thumb) {
    ctx.fillStyle = theme['--lane-surface'];
    ctx.fillRect(
      zones.scrollbar.x,
      zones.scrollbar.y,
      zones.scrollbar.width,
      zones.scrollbar.height,
    );
    ctx.fillStyle = theme['--lane-muted'];
    ctx.fillRect(zones.thumb.x + 2, zones.thumb.y, zones.thumb.width - 4, zones.thumb.height);
  }
  return zones;
}
