import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { LABEL_WIDTH, SCROLLBAR_WIDTH } from './renderer/layout';
import { clamp, fitView, pan, type Viewport, zoom } from './viewport';

export type CanvasViewState = { view: Viewport; scrollY: number };
export type CanvasGestureOptions = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  width: number;
  height: number;
  callCount: number;
  maxScrollY: number;
  fullscreen?: boolean;
  resetKey?: string;
  onDraw: (state: CanvasViewState) => void;
};

export function useCanvasGestures(options: CanvasGestureOptions) {
  const latest = useRef(options);
  const stateRef = useRef<CanvasViewState>({ view: fitView(options.callCount), scrollY: 0 });
  const frame = useRef<number | null>(null);
  const subscribers = useRef(new Set<(state: CanvasViewState) => void>());
  const actions = useMemo(() => {
    const redraw = () => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const snapshot = { view: { ...stateRef.current.view }, scrollY: stateRef.current.scrollY };
        latest.current.onDraw(snapshot);
        for (const listener of subscribers.current) listener(snapshot);
      });
    };
    const setView = (view: Viewport, scrollY = stateRef.current.scrollY) => {
      stateRef.current = {
        view: clamp(view, latest.current.callCount),
        scrollY: Math.max(0, Math.min(latest.current.maxScrollY, scrollY)),
      };
      redraw();
    };
    const plotWidth = () =>
      Math.max(
        0,
        latest.current.width - LABEL_WIDTH - (latest.current.maxScrollY > 0 ? SCROLLBAR_WIDTH : 0),
      );
    return {
      stateRef,
      redraw,
      setView,
      fit: () => setView(fitView(latest.current.callCount)),
      pan: (calls: number, vertical = 0) =>
        setView(
          pan(stateRef.current.view, calls, latest.current.callCount),
          stateRef.current.scrollY + vertical,
        ),
      zoom: (factor: number, cursor = plotWidth() / 2) =>
        setView(zoom(stateRef.current.view, factor, cursor, plotWidth(), latest.current.callCount)),
      subscribe: (listener: (state: CanvasViewState) => void) => {
        subscribers.current.add(listener);
        return () => {
          subscribers.current.delete(listener);
        };
      },
      plotWidth,
    };
  }, []);
  useLayoutEffect(() => {
    latest.current = options;
    actions.setView(stateRef.current.view);
  }, [options, actions]);
  useEffect(() => {
    void options.resetKey;
    actions.setView(fitView(latest.current.callCount), 0);
  }, [options.resetKey, actions]);
  useEffect(() => {
    const canvas = options.canvasRef.current;
    if (!canvas) return;
    const position = (event: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const wheel = (event: WheelEvent) => {
      const config = latest.current;
      const { x } = position(event);
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? config.height : 1;
      const dx = event.deltaX * unit;
      const dy = event.deltaY * unit;
      const realZoom = event.ctrlKey || event.metaKey;
      if (realZoom) {
        event.preventDefault();
        actions.zoom(Math.exp(-Math.max(-600, Math.min(600, dy)) * 0.002), x - LABEL_WIDTH);
      } else if (x < LABEL_WIDTH || event.shiftKey) {
        if (config.fullscreen) event.preventDefault();
        actions.pan(0, dy || dx);
      } else if (Math.abs(dx) > Math.abs(dy)) {
        if (config.fullscreen) event.preventDefault();
        actions.pan((dx / Math.max(1, actions.plotWidth())) * stateRef.current.view.span);
      } else if (config.fullscreen) {
        event.preventDefault();
        actions.zoom(Math.exp(-Math.max(-600, Math.min(600, dy)) * 0.002), x - LABEL_WIDTH);
      }
    };
    let drag: { x: number; y: number; id: number } | null = null;
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      canvas.focus();
      drag = { ...position(event), id: event.pointerId };
      canvas.setPointerCapture?.(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      const point = position(event);
      actions.pan(
        ((drag.x - point.x) / Math.max(1, actions.plotWidth())) * stateRef.current.view.span,
        drag.y - point.y,
      );
      drag = { ...point, id: event.pointerId };
    };
    const up = () => {
      drag = null;
    };
    const doubleClick = () => actions.fit();
    const key = (event: KeyboardEvent) => {
      if (document.activeElement !== canvas || event.ctrlKey || event.metaKey || event.altKey)
        return;
      const step = stateRef.current.view.span * 0.1;
      switch (event.key) {
        case '0':
          actions.fit();
          break;
        case '+':
        case '=':
          actions.zoom(1.25);
          break;
        case '-':
        case '−':
          actions.zoom(0.8);
          break;
        case 'ArrowLeft':
          actions.pan(-step);
          break;
        case 'ArrowRight':
          actions.pan(step);
          break;
        case 'ArrowUp':
          actions.pan(0, -30);
          break;
        case 'ArrowDown':
          actions.pan(0, 30);
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);
    canvas.addEventListener('dblclick', doubleClick);
    canvas.addEventListener('keydown', key);
    return () => {
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('lostpointercapture', up);
      canvas.removeEventListener('dblclick', doubleClick);
      canvas.removeEventListener('keydown', key);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [options.canvasRef, actions]);
  return actions;
}
