import { useQuery } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { sessionProfileLanesOptions } from '@/queries/session-profile';
import { sessionQueryOptions } from '@/queries/sessions';
import { detect, type Finding, type RuleId, rules } from './detections';
import { indicators as catalog } from './indicators';
import { LaneTooltip } from './lane-tooltip';
import { buildModel, type LaneModelData } from './model';
import { drawFrame, prepareOverview } from './renderer/draw';
import { hitTest } from './renderer/hit-test';
import { LANE_HEIGHT, type Layout, layout } from './renderer/layout';
import { readLaneTheme } from './renderer/theme';
import { Toolbar } from './toolbar';
import { type CanvasViewState, useCanvasGestures } from './use-canvas-gestures';
import { useFullscreen } from './use-fullscreen';
import { bucketSize, fit as fitView, ppc, xOf } from './viewport';

export type AgentLanesProps = {
  sessionId: string;
  onOpenNode: (id: string) => void;
  onNodeCount: (count: number | null) => void;
};

function readPreference<T>(key: string, fallback: T, valid: (value: unknown) => value is T): T {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`agent-lanes:${key}`) ?? 'null');
    return valid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function usePreference<T>(key: string, fallback: T, valid: (value: unknown) => value is T) {
  const [value, setValue] = useState(() => readPreference(key, fallback, valid));
  useEffect(() => {
    try {
      localStorage.setItem(`agent-lanes:${key}`, JSON.stringify(value));
    } catch {
      /* Storage is optional. */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

export function AgentLanes(props: AgentLanesProps) {
  const query = useQuery(sessionProfileLanesOptions(props.sessionId, { scope: 'tree' }));
  const model = useMemo(() => (query.data ? buildModel(query.data) : null), [query.data]);
  // dataUpdatedAt intentionally re-runs this after refetches with structurally
  // identical data, restoring the node count the route header consumes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional refresh trigger
  useEffect(() => {
    props.onNodeCount(model && !query.isFetching ? Math.max(0, model.agents.length - 1) : null);
  }, [model, props.onNodeCount, query.isFetching, query.dataUpdatedAt]);
  if (query.isPending)
    return (
      <div role="status" aria-label="Loading agent lanes">
        <Skeleton className="h-72 w-full" />
      </div>
    );
  if (query.isError || !model)
    return (
      <div role="alert" className="rounded-lg border p-4 text-sm">
        <p>Failed to load agent lanes.</p>
        <Button size="sm" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </div>
    );
  return <LanesPanel key={props.sessionId} {...props} model={model} />;
}

type Hover = { agentId: string; column: number; endColumn: number; x: number; y: number };

function LanesPanel({ model, onOpenNode, sessionId }: AgentLanesProps & { model: LaneModelData }) {
  // Subscribe to the route's already-fetched session without a redundant metadata request.
  const session = useQuery({ ...sessionQueryOptions(sessionId), enabled: false });
  const frame = useRef<HTMLElement | null>(null);
  const container = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const columnLine = useRef<HTMLDivElement | null>(null);
  const zonesRef = useRef<Layout | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [focusedFinding, setFocusedFinding] = useState<Finding | null>(null);
  const [indicators, setIndicators] = usePreference(
    'indicators',
    catalog.map((item) => item.id),
    (value): value is string[] =>
      Array.isArray(value) &&
      value.every((id) => catalog.some((item) => item.id === id)) &&
      new Set(value).size === value.length,
  );
  const [detections, setDetections] = usePreference<RuleId[]>(
    'detections',
    rules.map((rule) => rule.id),
    (value): value is RuleId[] =>
      Array.isArray(value) &&
      value.every((id) => rules.some((rule) => rule.id === id)) &&
      new Set(value).size === value.length,
  );
  const [contextThreshold, setContextThreshold] = usePreference(
    'threshold',
    85,
    (value): value is number =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100,
  );
  const { fullscreen, toggle } = useFullscreen(frame);
  const [size, setSize] = useState({ width: 900, height: 448 });
  const [theme, setTheme] = useState(() => readLaneTheme(document.documentElement));
  const findings = useMemo(
    () => detect(model, detections, contextThreshold),
    [model, detections, contextThreshold],
  );
  const available = useMemo(
    () => detect(model, undefined, contextThreshold),
    [model, contextThreshold],
  );
  const zones = useMemo(
    () =>
      layout(size.width, size.height, fitView(model.callCount), 0, model, {
        collapsed,
        fullscreen,
      }),
    [size, model, collapsed, fullscreen],
  );
  const overview = useMemo(
    () => prepareOverview(model, zones.axis.width),
    [model, zones.axis.width],
  );
  const inlineHeight = 148 + Math.min(10, zones.lanes.length) * LANE_HEIGHT;
  const updateHover = (current: Layout) => {
    const point = pointer.current;
    const hit = point ? hitTest(point.x, point.y, current) : null;
    const line = columnLine.current;
    if (line) {
      const visible =
        hit?.column !== null && hit?.column !== undefined && hit.column < model.callCount;
      line.style.display = visible ? 'block' : 'none';
      if (visible)
        line.style.left = `${current.axis.x + xOf(current.view, current.axis.width, hit.column ?? 0)}px`;
      line.style.height = `${current.height}px`;
    }
    if (
      !point ||
      hit?.zone !== 'lane' ||
      !hit.lane ||
      hit.column === null ||
      hit.column >= model.callCount
    ) {
      setHover((previous) => (previous === null ? previous : null));
      return;
    }
    const bucket = bucketSize(ppc(current.view, current.axis.width));
    const column = Math.floor(hit.column / bucket) * bucket;
    const next = {
      agentId: hit.lane,
      column,
      endColumn: Math.min(model.callCount - 1, column + bucket - 1),
      x: Math.max(0, Math.min(size.width - 296, point.x + 12)),
      y: Math.max(0, Math.min(current.height - 100, point.y + 16)),
    };
    setHover((previous) =>
      previous &&
      Object.keys(next).every((key) => previous[key as keyof Hover] === next[key as keyof Hover])
        ? previous
        : next,
    );
  };
  const gestures = useCanvasGestures({
    canvasRef: canvas,
    width: size.width,
    height: size.height,
    callCount: model.callCount,
    maxScrollY: zones.maxScrollY,
    fullscreen,
    resetKey: sessionId,
    onDraw: (state: CanvasViewState) => {
      const current = layout(size.width, size.height, state.view, state.scrollY, model, {
        collapsed,
        fullscreen,
      });
      zonesRef.current = current;
      const context = canvas.current?.getContext('2d');
      if (context)
        drawFrame(
          context,
          model,
          { ...state, ...size },
          {
            collapsed,
            fullscreen,
            enabledIndicators: indicators,
            enabledDetections: detections,
            findings,
            threshold: contextThreshold,
            selectedAgentId,
            focusedFinding,
            overview,
          },
          theme,
        );
      updateHover(current);
    },
  });
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const resize = () =>
      setSize((previous) => {
        const rect = element.getBoundingClientRect();
        const next = {
          width: rect.width || previous.width,
          height: fullscreen ? rect.height || previous.height : inlineHeight,
        };
        return previous.width === next.width && previous.height === next.height ? previous : next;
      });
    resize();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', resize);
      return () => window.removeEventListener('resize', resize);
    }
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fullscreen, inlineHeight]);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(readLaneTheme(document.documentElement)));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!focusedFinding) return;
    const index = zones.lanes.findIndex((lane) => lane.agent.id === focusedFinding.agentId);
    gestures.setView(
      { start: focusedFinding.from - 2, span: focusedFinding.to - focusedFinding.from + 5 },
      Math.max(0, index) * LANE_HEIGHT,
    );
  }, [focusedFinding, zones.lanes, gestures]);
  const collapse = (id: string) => {
    setFocusedFinding(null);
    setSelectedAgentId(id);
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const focusFinding = (finding: Finding) => {
    setFocusedFinding(finding);
    setSelectedAgentId(finding.agentId);
    setCollapsed((previous) => {
      const next = new Set(previous);
      let agent = model.byId.get(finding.agentId);
      while (agent) {
        next.delete(agent.id);
        agent = agent.parentId ? model.byId.get(agent.parentId) : undefined;
      }
      return next;
    });
    setHover(null);
  };
  const summary = `Agent lanes: ${model.callCount} calls, ${model.agents.length} agents, ${findings.length} findings. Arrow keys pan; plus and minus zoom; 0 fits all calls.`;
  return (
    <section
      ref={frame}
      aria-label="Agent lanes"
      className="flex min-h-0 flex-col rounded-lg border bg-background"
      style={fullscreen ? { position: 'fixed', inset: 0, zIndex: 50 } : undefined}
      onPointerLeave={() => {
        pointer.current = null;
        gestures.redraw();
      }}
    >
      <Toolbar
        model={model}
        harness={session.data?.harness.displayName ?? 'Unknown harness'}
        indicators={indicators}
        detections={detections}
        contextThreshold={contextThreshold}
        findings={findings}
        availableCount={available.length}
        lanes={zones.lanes}
        collapsed={collapsed}
        fullscreen={fullscreen}
        onIndicator={(id) =>
          setIndicators((previous) =>
            previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id],
          )
        }
        onDetection={(id) => {
          setFocusedFinding(null);
          setDetections((previous) =>
            previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id],
          );
        }}
        onThreshold={(value) => {
          setFocusedFinding(null);
          setContextThreshold(value);
        }}
        onFinding={focusFinding}
        onCollapse={collapse}
        onOpenNode={onOpenNode}
        onZoom={gestures.zoom}
        onFit={gestures.fit}
        onFullscreen={toggle}
      />
      {model.callCount > 20_000 ? (
        <p role="status" className="px-3 text-xs">
          This large session may make the panel slow.
        </p>
      ) : null}
      {model.excludedNullAtCount > 0 ? (
        <p className="px-3 text-xs">
          {model.excludedNullAtCount} calls without timestamps excluded.
        </p>
      ) : null}
      <div
        ref={container}
        className="relative min-h-0 overflow-hidden"
        style={fullscreen ? { flex: 1 } : { height: inlineHeight }}
      >
        <canvas
          ref={canvas}
          tabIndex={0}
          aria-label={summary}
          className="block focus-visible:outline-2 focus-visible:outline-ring"
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            pointer.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
            gestures.redraw();
          }}
          onClick={(event) => {
            const current = zonesRef.current;
            if (!current) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const hit = hitTest(event.clientX - rect.left, event.clientY - rect.top, current);
            if (hit.zone === 'label' && hit.lane) collapse(hit.lane);
            else if (hit.lane) setSelectedAgentId(hit.lane);
          }}
        />
        <div
          ref={columnLine}
          aria-hidden="true"
          className="pointer-events-none absolute top-0 hidden w-px bg-foreground/30"
        />
        {hover ? <LaneTooltip model={model} {...hover} onOpenNode={onOpenNode} /> : null}
      </div>
      {focusedFinding ? (
        <p
          role="status"
          aria-label="Focused finding"
          className="sr-only"
        >{`${focusedFinding.agentId}: ${focusedFinding.text} (calls ${focusedFinding.from + 1}–${focusedFinding.to + 1})`}</p>
      ) : null}
    </section>
  );
}
