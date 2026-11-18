import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCanvasGestures } from './use-canvas-gestures';

let canvas: HTMLCanvasElement;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
beforeEach(() => {
  canvas = document.createElement('canvas');
  document.body.append(canvas);
  frames = new Map();
  nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => {
  canvas.remove();
  vi.unstubAllGlobals();
});
function flush() {
  const current = [...frames.values()];
  frames.clear();
  act(() => {
    for (const callback of current) callback(0);
  });
}
function wheel(init: WheelEventInit) {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 484, ...init });
  act(() => {
    canvas.dispatchEvent(event);
  });
  return event;
}
function setup(fullscreen = false) {
  const draw = vi.fn();
  let renders = 0;
  const hook = renderHook(() => {
    renders++;
    return useCanvasGestures({
      canvasRef: { current: canvas },
      width: 800,
      height: 600,
      callCount: 100,
      maxScrollY: 300,
      fullscreen,
      onDraw: draw,
    });
  });
  flush();
  draw.mockClear();
  return { ...hook, draw, renders: () => renders };
}

it('owns viewport refs, batches actions and subscriptions, fits and cancels pending frames', () => {
  const { result, draw, renders, unmount } = setup();
  const listener = vi.fn();
  const unsubscribe = result.current.subscribe(listener);
  act(() => {
    result.current.zoom(2);
    result.current.pan(5, 40);
    result.current.redraw();
  });
  expect(result.current.stateRef.current).toEqual({ view: { start: 30, span: 50 }, scrollY: 40 });
  expect(frames.size).toBe(1);
  flush();
  expect(draw).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(renders()).toBe(1);
  unsubscribe();
  act(() => {
    result.current.fit();
  });
  expect(result.current.stateRef.current.view).toEqual({ start: 0, span: 100 });
  unmount();
  expect(frames.size).toBe(0);
});

it('preserves inline page scroll except real zoom and accepts fullscreen wheel zoom', () => {
  const { result, unmount } = setup();
  expect(wheel({ deltaY: -100 }).defaultPrevented).toBe(false);
  expect(result.current.stateRef.current.view.span).toBe(100);
  expect(wheel({ deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(true);
  expect(result.current.stateRef.current.view.span).toBeLessThan(100);
  const before = result.current.stateRef.current.view.start;
  expect(wheel({ deltaX: 20 }).defaultPrevented).toBe(false);
  expect(result.current.stateRef.current.view.start).toBeGreaterThan(before);
  expect(wheel({ deltaY: 30, clientX: 20 }).defaultPrevented).toBe(false);
  expect(wheel({ deltaY: 30, shiftKey: true }).defaultPrevented).toBe(false);
  expect(result.current.stateRef.current.scrollY).toBe(60);
  unmount();
  const full = setup(true);
  expect(wheel({ deltaY: -100 }).defaultPrevented).toBe(true);
  expect(full.result.current.stateRef.current.view.span).toBeLessThan(100);
});

it('handles focused keyboard, double-click fit and two-axis pointer drag', () => {
  const { result } = setup(true);
  const key = (key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    act(() => {
      canvas.dispatchEvent(event);
    });
    return event;
  };
  expect(key('+').defaultPrevented).toBe(false);
  canvas.tabIndex = 0;
  canvas.focus();
  expect(key('+').defaultPrevented).toBe(true);
  const start = result.current.stateRef.current.view.start;
  key('ArrowRight');
  key('ArrowDown');
  expect(result.current.stateRef.current.view.start).toBeGreaterThan(start);
  expect(result.current.stateRef.current.scrollY).toBe(30);
  act(() => {
    canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: 400, clientY: 100, button: 0 }));
    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 380, clientY: 80 }));
    canvas.dispatchEvent(new MouseEvent('pointerup'));
  });
  expect(result.current.stateRef.current.scrollY).toBe(50);
  act(() => {
    canvas.dispatchEvent(new MouseEvent('dblclick'));
  });
  expect(result.current.stateRef.current.view.span).toBe(100);
  key('+');
  key('0');
  expect(result.current.stateRef.current.view.span).toBe(100);
});
