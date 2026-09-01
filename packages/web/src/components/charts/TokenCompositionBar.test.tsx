import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import type { Capability, Metric, Usage } from '../../api/types';
import { formatTokens } from '../../lib/format';
import { CONFIDENCE_OPACITY, USAGE_COLOR } from './chart-theme';
import { TokenCompositionBar } from './TokenCompositionBar';

const ALL_USAGE_CAPS: Capability[] = [
  'usage.perCall',
  'usage.cumulative',
  'usage.cacheWrite',
  'usage.reasoning',
];

function metric(partial: Pick<Metric, 'value'> & Partial<Metric>): Metric {
  return { confidence: 'high', source: 'fake/usage#req1', ...partial };
}

function rectFor(container: HTMLElement, field: string): SVGRectElement | null {
  return container.querySelector(`rect[data-field="${field}"]`);
}

describe('TokenCompositionBar', () => {
  afterEach(() => {
    cleanup();
  });

  test('rect widths are proportional to value/total, and every segment gets its exact legend value', () => {
    const usage: Usage = {
      uncachedInput: metric({ value: 100 }),
      cachedInput: metric({ value: 50 }),
      cacheWrite: metric({ value: 25 }),
      output: metric({ value: 80 }),
      reasoningOutput: metric({ value: 20 }),
    };
    const width = 240;
    const total = 100 + 50 + 25 + 80 + 20;
    const { container } = render(
      <TokenCompositionBar usage={usage} harness="fake" capabilities={ALL_USAGE_CAPS} />,
    );

    const expectedWidths: Record<string, number> = {
      uncachedInput: (100 / total) * width,
      cachedInput: (50 / total) * width,
      cacheWrite: (25 / total) * width,
      output: (80 / total) * width,
      reasoningOutput: (20 / total) * width,
    };
    for (const [field, expectedWidth] of Object.entries(expectedWidths)) {
      const rect = rectFor(container, field);
      expect(rect).not.toBeNull();
      expect(Number(rect?.getAttribute('width'))).toBeCloseTo(expectedWidth, 6);
    }

    for (const value of [100, 50, 25, 80, 20]) {
      expect(screen.getAllByText(formatTokens(value)).length).toBeGreaterThan(0);
    }
  });

  test('capability-absent segment: no geometry, legend renders n/a', () => {
    const usage: Usage = {
      uncachedInput: metric({ value: 100 }),
      cachedInput: metric({ value: 30 }),
      output: metric({ value: 50 }),
      reasoningOutput: metric({ value: 10 }),
      // cacheWrite absent, and the harness below doesn't declare usage.cacheWrite.
    };
    const capsWithoutCacheWrite: Capability[] = [
      'usage.perCall',
      'usage.cumulative',
      'usage.reasoning',
    ];
    const { container } = render(
      <TokenCompositionBar usage={usage} harness="fake" capabilities={capsWithoutCacheWrite} />,
    );

    expect(rectFor(container, 'cacheWrite')).toBeNull();
    expect(screen.getByText('n/a')).not.toBeNull();
  });

  test('field-absent (but capable) segment: no geometry, legend renders an em dash', () => {
    const usage: Usage = {
      uncachedInput: metric({ value: 100 }),
      cachedInput: metric({ value: 30 }),
      output: metric({ value: 50 }),
      reasoningOutput: metric({ value: 10 }),
      // cacheWrite genuinely missing from this session, though the harness can report it.
    };
    const { container } = render(
      <TokenCompositionBar usage={usage} harness="fake" capabilities={ALL_USAGE_CAPS} />,
    );

    expect(rectFor(container, 'cacheWrite')).toBeNull();
    expect(screen.getByText('—')).not.toBeNull();
    expect(screen.queryByText('n/a')).toBeNull();
  });

  test('medium confidence reduces opacity but never changes the fill color', () => {
    const usage: Usage = {
      uncachedInput: metric({ value: 100 }),
      output: metric({ value: 50, confidence: 'medium' }),
    };
    const { container } = render(
      <TokenCompositionBar usage={usage} harness="fake" capabilities={ALL_USAGE_CAPS} />,
    );

    const rect = rectFor(container, 'output');
    expect(rect).not.toBeNull();
    expect(rect?.getAttribute('fill')).toBe(USAGE_COLOR.output);
    expect(Number(rect?.getAttribute('fill-opacity'))).toBe(CONFIDENCE_OPACITY.medium);
  });

  test('all-absent usage renders the explicit empty state, not a degenerate zero-width bar', () => {
    const { container } = render(
      <TokenCompositionBar usage={{}} harness="fake" capabilities={ALL_USAGE_CAPS} />,
    );

    expect(screen.getByText('No usage recorded')).not.toBeNull();
    expect(screen.getByLabelText('No usage recorded')).not.toBeNull();
    expect(container.querySelectorAll('rect[data-field]').length).toBe(0);
  });

  test('zero-sum present usage (all values 0) also renders the empty state', () => {
    const usage: Usage = {
      uncachedInput: metric({ value: 0 }),
      output: metric({ value: 0 }),
    };
    const { container } = render(
      <TokenCompositionBar usage={usage} harness="fake" capabilities={ALL_USAGE_CAPS} />,
    );

    expect(screen.getByText('No usage recorded')).not.toBeNull();
    expect(container.querySelectorAll('rect[data-field]').length).toBe(0);
  });

  test('fill color comes from the usage-token map, never a hardcoded hex', () => {
    const usage: Usage = {
      uncachedInput: metric({ value: 100 }),
      output: metric({ value: 50 }),
    };
    const { container } = render(
      <TokenCompositionBar usage={usage} harness="fake" capabilities={ALL_USAGE_CAPS} />,
    );

    const rect = rectFor(container, 'output');
    expect(rect?.getAttribute('fill')).toBe(USAGE_COLOR.output);
    expect(rect?.getAttribute('fill')).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
