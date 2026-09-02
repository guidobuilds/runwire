import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { TimelineAxis } from './TimelineAxis';
import { TimelineProvider } from './TimelineContext';

afterEach(() => cleanup());

describe('tick labels', () => {
  test('renders legible mm:ss tick labels, not raw ms numbers', () => {
    const view = render(
      <TimelineProvider domain={[0, 60_000]} width={480}>
        <TimelineAxis />
      </TimelineProvider>,
    );
    const texts = Array.from(view.container.querySelectorAll('text')).map(
      (el) => el.textContent ?? '',
    );
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.some((t) => t.includes(':'))).toBe(true);
    for (const text of texts) {
      expect(text).not.toMatch(/\b\d{4,}\b/);
    }
  });

  test('svg uses the shared viewBox/width convention from context', () => {
    const view = render(
      <TimelineProvider domain={[0, 60_000]} width={480}>
        <TimelineAxis />
      </TimelineProvider>,
    );
    const svg = view.container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 480 24');
    expect(svg?.getAttribute('width')).toBe('100%');
    expect(svg?.getAttribute('preserveAspectRatio')).toBe('none');
  });
});

describe('edge tick clipping', () => {
  test('first/last tick labels anchor inward (start/end) so they never extend past the svg bounds', () => {
    const view = render(
      <TimelineProvider domain={[0, 6_000_000]} width={480}>
        <TimelineAxis />
      </TimelineProvider>,
    );
    const texts = Array.from(view.container.querySelectorAll('text'));
    expect(texts.length).toBeGreaterThan(2);
    expect(texts[0]?.getAttribute('text-anchor')).toBe('start');
    expect(texts[texts.length - 1]?.getAttribute('text-anchor')).toBe('end');
    for (const text of texts.slice(1, -1)) {
      expect(text.getAttribute('text-anchor')).toBe('middle');
    }
  });
});

describe('zero-width domain edge case', () => {
  test('does not throw for a [0, 0] domain', () => {
    expect(() =>
      render(
        <TimelineProvider domain={[0, 0]} width={480}>
          <TimelineAxis />
        </TimelineProvider>,
      ),
    ).not.toThrow();
  });
});
