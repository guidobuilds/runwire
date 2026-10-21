type CanvasSize = { width: number; height: number };
type ContainerSize = CanvasSize & { clientWidth: number };

/** Only the wrapper determines width; inline height comes exclusively from lane count (S45). */
export function resolveCanvasSize(
  container: ContainerSize,
  previous: CanvasSize,
  fullscreen: boolean,
  inlineHeight: number,
): CanvasSize {
  const width = Math.max(0, Math.min(container.width, container.clientWidth));
  const height = fullscreen ? Math.max(0, container.height) : inlineHeight;
  return previous.width === width && previous.height === height ? previous : { width, height };
}
