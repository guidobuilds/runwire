import { scaleLinear } from '@visx/scale';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

/**
 * Shared timeline domain/scale/cursor/selection state for `SessionTimeline`'s
 * four tracks (design.md §3.1/§3.2). One `TimelineDomain` and `xScale` drive
 * every track's x-axis; `cursorTime`/`cursorPinned` drive the single shared
 * `SharedCursor` overlay instead of four independent per-track hover states.
 * `selectedEventId` backs the `EventInspector` sheet's detail view;
 * `selectedClusterIds` backs its list view (f10-t3 fix: a clustered marker
 * click used to jump straight to its representative member, silently
 * dropping every other member the cluster badge counted — clicking one now
 * opens a list of every member instead, and `selectedEventId` narrows that
 * list to one). `selectedRange` is a real setter with real state even though
 * no MVP UI mutates it yet, so later zoom/select work is additive rather
 * than a context reshape.
 */

export type TimelineDomain = readonly [number, number]; // [0, maxElapsedMs]

/** `@visx/scale`'s `scaleLinear<number>(...)` return type, named without a direct `@visx/vendor`/`d3-scale` import (neither is a declared `packages/web` dependency). */
type LinearScale = ReturnType<typeof scaleLinear<number>>;

export type TimelineContextValue = {
  domain: TimelineDomain;
  xScale: LinearScale; // @visx/scale scaleLinear, domain -> [0, width]
  width: number; // nominal SVG width (viewBox units, not CSS px)
  cursorTime: number | null; // elapsed ms; hovered or pinned
  cursorPinned: boolean;
  selectedEventId: string | null;
  /**
   * The full member-id list of a clicked cluster, in tooltip order
   * (earliest first) — set by `selectCluster`, independent of
   * `selectedEventId` so `EventInspector` can show a list (this set, no
   * event chosen yet) then narrow to a detail view (`selectedEventId` set)
   * while keeping the list around for a "back" affordance. Never mutated by
   * `selectEvent` — only `selectCluster` and `closeInspector` touch it — so
   * picking a member from the open list doesn't lose its way back.
   */
  selectedClusterIds: readonly string[] | null;
  selectedRange: TimelineDomain | null; // reserved for later zoom/select; unused MVP (always null)
  setCursorTime: (ms: number | null) => void;
  pinCursor: (ms: number) => void;
  clearCursor: () => void;
  selectEvent: (id: string | null) => void;
  selectCluster: (ids: readonly string[]) => void;
  closeInspector: () => void;
  setSelectedRange: (range: TimelineDomain | null) => void;
};

const TimelineContext = createContext<TimelineContextValue | null>(null);

/** Nominal SVG viewBox width (px), matching `TraceRibbon`'s existing default-width convention. Exported so `SessionTimeline` can use the same fallback before its `useContainerWidth` measurement resolves (f8). */
export const DEFAULT_WIDTH = 480;

/**
 * Shared label-gutter layout (f8): every track/axis row reserves this same
 * fixed-width HTML cell + `gap-2` (8px) before its plot `<svg>`, so every
 * track's SVG genuinely starts at the identical real-pixel x-origin --
 * `AgentTrack`'s per-lane label (with its own visible text/depth indent) uses
 * a cell of this width, and `TokenTrack`/`HarnessTrack`/`ComponentTrack`/
 * `TimelineAxis` each render an empty placeholder cell of the same width, so
 * none of them (nor `SharedCursor`, which is inset by the matching
 * `LABEL_GUTTER_PX`) drift out of alignment with AgentTrack's label column.
 * `LABEL_GUTTER_PX` is `10rem` (160px at the default root font size) + the
 * `gap-2` (8px) every row places between its label cell and its plot `<svg>`.
 */
export const LABEL_GUTTER_WIDTH = 'w-40';
export const LABEL_GUTTER_PX = 168;

export type TimelineProviderProps = {
  domain: TimelineDomain;
  width?: number;
  children: ReactNode;
};

export function TimelineProvider({
  domain,
  width = DEFAULT_WIDTH,
  children,
}: TimelineProviderProps) {
  const [cursorTime, setCursorTimeState] = useState<number | null>(null);
  const [cursorPinned, setCursorPinned] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedClusterIds, setSelectedClusterIds] = useState<readonly string[] | null>(null);
  const [selectedRange, setSelectedRangeState] = useState<TimelineDomain | null>(null);

  const [domainMin, domainMax] = domain;
  const xScale = useMemo(
    () => scaleLinear<number>({ domain: [domainMin, domainMax], range: [0, width] }),
    [domainMin, domainMax, width],
  );

  // Pinning freezes `cursorTime`: once pinned, hover callers (`setCursorTime`,
  // fired continuously from onMouseMove) must never overwrite it — only
  // `pinCursor` (a new pin, e.g. a click on a different position) or
  // `clearCursor` (explicit unpin, e.g. a click-outside listener on the
  // tracks container) may change it while pinned (design.md §3.5).
  const setCursorTime = useCallback(
    (ms: number | null) => {
      if (cursorPinned) return;
      setCursorTimeState(ms);
    },
    [cursorPinned],
  );

  const pinCursor = useCallback((ms: number) => {
    setCursorTimeState(ms);
    setCursorPinned(true);
  }, []);

  const clearCursor = useCallback(() => {
    setCursorPinned(false);
    setCursorTimeState(null);
  }, []);

  // Deliberately never touches `selectedClusterIds` -- see that field's own
  // doc comment. A fresh single-mark click (AgentTrack/TokenTrack, or an
  // unclustered Harness/Component mark) always finds it already `null`
  // (the sheet is modal, so nothing else is clickable while a cluster list
  // is open); picking a member out of an open list relies on it staying put.
  const selectEvent = useCallback((id: string | null) => {
    setSelectedEventId(id);
  }, []);

  const selectCluster = useCallback((ids: readonly string[]) => {
    setSelectedClusterIds(ids);
    setSelectedEventId(null);
  }, []);

  const closeInspector = useCallback(() => {
    setSelectedEventId(null);
    setSelectedClusterIds(null);
  }, []);

  // Real setter (state present) even though no MVP caller mutates it via UI
  // yet, so later zoom work is additive, not a context reshape.
  const setSelectedRange = useCallback((range: TimelineDomain | null) => {
    setSelectedRangeState(range);
  }, []);

  const value = useMemo<TimelineContextValue>(
    () => ({
      domain,
      xScale,
      width,
      cursorTime,
      cursorPinned,
      selectedEventId,
      selectedClusterIds,
      selectedRange,
      setCursorTime,
      pinCursor,
      clearCursor,
      selectEvent,
      selectCluster,
      closeInspector,
      setSelectedRange,
    }),
    [
      domain,
      xScale,
      width,
      cursorTime,
      cursorPinned,
      selectedEventId,
      selectedClusterIds,
      selectedRange,
      setCursorTime,
      pinCursor,
      clearCursor,
      selectEvent,
      selectCluster,
      closeInspector,
      setSelectedRange,
    ],
  );

  return <TimelineContext.Provider value={value}>{children}</TimelineContext.Provider>;
}

export function useTimeline(): TimelineContextValue {
  const context = useContext(TimelineContext);
  if (!context) {
    throw new Error('useTimeline must be used within a TimelineProvider.');
  }
  return context;
}
