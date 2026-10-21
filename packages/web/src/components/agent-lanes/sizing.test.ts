import { expect, it } from 'vitest';
import { resolveCanvasSize } from './sizing';

it('shrinks after fullscreen and sidebar transitions without retaining the canvas width', () => {
  const expanded = resolveCanvasSize(
    { width: 1600, height: 900, clientWidth: 1600 },
    { width: 900, height: 448 },
    true,
    448,
  );
  expect(expanded).toEqual({ width: 1600, height: 900 });
  const inline = resolveCanvasSize(
    { width: 920, height: 900, clientWidth: 920 },
    expanded,
    false,
    448,
  );
  expect(inline).toEqual({ width: 920, height: 448 });
  expect(
    resolveCanvasSize({ width: 700, height: 448, clientWidth: 700 }, inline, false, 448),
  ).toEqual({ width: 700, height: 448 });
});

it('clamps to current client width and never feeds observed height into inline height', () => {
  const previous = { width: 1888, height: 1000 };
  expect(
    resolveCanvasSize({ width: 1888, height: 2000, clientWidth: 800 }, previous, false, 178),
  ).toEqual({ width: 800, height: 178 });
  expect(resolveCanvasSize({ width: 0, height: 0, clientWidth: 0 }, previous, false, 178)).toEqual({
    width: 0,
    height: 178,
  });
  expect(
    resolveCanvasSize({ width: 800.5, height: 600, clientWidth: 800 }, previous, true, 178),
  ).toEqual({ width: 800, height: 600 });
});
