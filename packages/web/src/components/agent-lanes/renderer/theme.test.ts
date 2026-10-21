import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { laneRoleSwatches, laneTokens, readLaneTheme } from './theme';

const css = readFileSync('src/index.css', 'utf8');

it('maps every kind and tier to its own stable renderer token', () => {
  const { kinds, tiers } = laneRoleSwatches();
  expect(kinds.map(({ token }) => token)).toEqual([
    '--lane-kind-agent',
    '--lane-kind-mcp',
    '--lane-kind-write',
    '--lane-kind-exec',
    '--lane-kind-look',
    '--lane-kind-other',
    '--lane-kind-reply',
  ]);
  expect(tiers.map(({ token }) => token)).toEqual([
    '--lane-tier-high',
    '--lane-tier-mid',
    '--lane-tier-low',
  ]);
});

it('separates audited palette collisions in both themes and keeps compactions high contrast', () => {
  for (const block of [
    css.split(':root {')[1]?.split('}')[0],
    css.split('.dark {')[1]?.split('}')[0],
  ]) {
    const values = new Map(
      [...String(block).matchAll(/(--lane-[\w-]+): ([^;]+);/g)].map((match) => [
        match[1],
        match[2],
      ]),
    );
    expect(values.get('--lane-compaction')).toBe('var(--lane-foreground)');
    expect(values.get('--lane-kind-other')).toMatch(/^#([0-9a-f]{2})\1\1$/);
    for (const [left, right] of [
      ['kind-other', 'skill'],
      ['tier-high', 'kind-agent'],
      ['tier-mid', 'kind-look'],
      ['tier-low', 'kind-write'],
      ['kind-mcp', 'context'],
      ['kind-reply', 'idle'],
      ['kind-reply', 'muted'],
      ['skill', 'tier-high'],
    ])
      expect(values.get(`--lane-${left}`)).not.toBe(values.get(`--lane-${right}`));
    expect(new Set(laneRoleSwatches().kinds.map(({ token }) => values.get(token))).size).toBe(7);
  }
});

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
