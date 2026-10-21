import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFullscreen } from './use-fullscreen';

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'fullscreenElement');
  Reflect.deleteProperty(document, 'exitFullscreen');
  Reflect.deleteProperty(document.documentElement, 'requestFullscreen');
});

describe('lanes fullscreen lifecycle', () => {
  it('requests native fullscreen, exits it on Escape, and handles browser exit', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn().mockResolvedValue(undefined);
    let native: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => native });
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: request,
    });
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
    const { result } = renderHook(() =>
      useFullscreen({ current: document.createElement('section') }),
    );
    await act(async () => result.current.toggle());
    expect(result.current.fullscreen).toBe(true);
    expect(request).toHaveBeenCalledOnce();
    native = document.documentElement;
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(result.current.fullscreen).toBe(false);
    expect(exit).toHaveBeenCalledOnce();
    native = null;
    await act(async () => result.current.toggle());
    act(() => document.dispatchEvent(new Event('fullscreenchange')));
    expect(result.current.fullscreen).toBe(false);
  });
});
