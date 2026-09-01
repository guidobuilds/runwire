import { cleanup, render, screen } from '@testing-library/react';
import { scaleLinear } from '@visx/scale';
import { afterEach, describe, expect, test } from 'vitest';
import { KIND_COLOR } from './chart-theme';
import { Sparkline } from './Sparkline';

const INSET = 2;

function expectedX(width: number, dataLength: number, index: number): number {
  const xScale = scaleLinear({
    domain: [0, dataLength - 1],
    range: [INSET, width - INSET],
  });
  return xScale(index);
}

function expectedY(height: number, data: readonly number[], value: number): number {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const domain: [number, number] = min === max ? [min - 1, min + 1] : [min, max];
  const yScale = scaleLinear({ domain, range: [height - INSET, INSET] });
  return yScale(value);
}

describe('Sparkline', () => {
  afterEach(() => {
    cleanup();
  });

  test('renders one circle per data point at the exact scaled position', () => {
    const data = [1, 5, 3];
    const { container } = render(<Sparkline data={data} width={120} height={28} />);
    const circles = container.querySelectorAll('circle');
    expect(circles).toHaveLength(3);

    circles.forEach((circle, i) => {
      expect(Number(circle.getAttribute('cx'))).toBeCloseTo(expectedX(120, data.length, i));
      expect(Number(circle.getAttribute('cy'))).toBeCloseTo(expectedY(28, data, data[i] as number));
    });

    // Value 5 is the max: its y should be the smallest (highest on screen).
    // Value 1 is the min: its y should be the largest (lowest on screen).
    const cyForMax = Number(circles[1]?.getAttribute('cy'));
    const cyForMin = Number(circles[0]?.getAttribute('cy'));
    expect(cyForMax).toBeLessThan(cyForMin);
  });

  test('empty data renders the "No activity" state, not an svg', () => {
    const { container } = render(<Sparkline data={[]} />);
    expect(screen.getByText('No activity')).not.toBeNull();
    expect(screen.getByRole('img', { name: 'No activity' })).not.toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('path')).toBeNull();
    expect(container.querySelector('circle')).toBeNull();
  });

  test('a single data point also renders the "No activity" state (documented sparse threshold)', () => {
    const { container } = render(<Sparkline data={[7]} />);
    expect(screen.getByText('No activity')).not.toBeNull();
    expect(screen.getByRole('img', { name: 'No activity' })).not.toBeNull();
    expect(container.querySelector('svg')).toBeNull();
  });

  test('exact values are queryable independent of hover: series title and per-point titles', () => {
    const data = [2, 4, 8];
    const { container } = render(<Sparkline data={data} />);

    // The whole series, via the wrapping Tooltip's native `title`.
    expect(screen.getByTitle('2, 4, 8')).not.toBeNull();

    // Each individual point, via its own SVG <title>.
    const titles = Array.from(container.querySelectorAll('circle title')).map((t) => t.textContent);
    expect(titles).toEqual(['2', '4', '8']);
  });

  test('uses the token-based default color, never a hardcoded hex', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} />);
    const path = container.querySelector('path');
    expect(path?.getAttribute('stroke')).toBe(KIND_COLOR.model);
    expect(path?.getAttribute('stroke')).not.toMatch(/#[0-9a-fA-F]{3,6}/);

    const circle = container.querySelector('circle');
    expect(circle?.getAttribute('fill')).toBe(KIND_COLOR.model);
    expect(circle?.getAttribute('fill')).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  test('an explicit color override flows through instead of the default', () => {
    const override = 'var(--usage-output)';
    const { container } = render(<Sparkline data={[1, 2, 3]} color={override} />);
    const path = container.querySelector('path');
    expect(path?.getAttribute('stroke')).toBe(override);

    const circle = container.querySelector('circle');
    expect(circle?.getAttribute('fill')).toBe(override);
  });
});
