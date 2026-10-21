import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

export function useFullscreen(frame: RefObject<HTMLElement | null>) {
  const [fullscreen, setFullscreen] = useState(false);
  const active = useRef(false);
  const target = useRef<HTMLElement | null>(null);
  const exit = useCallback(() => {
    active.current = false;
    setFullscreen(false);
    if (document.fullscreenElement === target.current) {
      void document.exitFullscreen?.().catch(() => {});
    }
  }, []);
  const enter = useCallback(() => {
    active.current = true;
    setFullscreen(true);
    try {
      // Include shadcn's body portals so menus remain visible in native fullscreen.
      target.current = frame.current?.ownerDocument.documentElement ?? null;
      void target.current
        ?.requestFullscreen?.()
        .then(() => {
          if (!active.current && document.fullscreenElement === target.current) {
            void document.exitFullscreen?.().catch(() => {});
          }
        })
        .catch(() => {});
    } catch {
      // Fixed-position expanded mode also works without browser fullscreen permission.
    }
  }, [frame]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') exit();
    };
    const change = () => {
      if (!document.fullscreenElement) exit();
    };
    document.addEventListener('keydown', key);
    document.addEventListener('fullscreenchange', change);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('fullscreenchange', change);
      active.current = false;
      if (target.current && document.fullscreenElement === target.current)
        void document.exitFullscreen?.().catch(() => {});
    };
  }, [exit]);
  return { fullscreen, toggle: fullscreen ? exit : enter };
}
