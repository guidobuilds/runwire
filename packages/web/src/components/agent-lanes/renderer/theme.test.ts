import { expect, it, vi } from 'vitest';
import { laneTokens, readLaneTheme } from './theme';

it('reads one computed style snapshot per explicit theme refresh', () => {
  const element = document.createElement('div');
  const property = vi.fn((token: string) => ` light:${token} `);
  const computed = vi.spyOn(globalThis, 'getComputedStyle').mockReturnValue({
    getPropertyValue: property,
  } as unknown as CSSStyleDeclaration);
  try {
    const light = readLaneTheme(element);
    expect(computed).toHaveBeenCalledTimes(1);
    expect(property).toHaveBeenCalledTimes(laneTokens.length);
    expect(light['--lane-detection']).toBe('light:--lane-detection');
    property.mockImplementation((token) => `dark:${token}`);
    expect(readLaneTheme(element)['--lane-kind-agent']).toBe('dark:--lane-kind-agent');
    expect(computed).toHaveBeenCalledTimes(2);
    expect(light['--lane-kind-agent']).toBe('light:--lane-kind-agent');
  } finally {
    computed.mockRestore();
  }
});
