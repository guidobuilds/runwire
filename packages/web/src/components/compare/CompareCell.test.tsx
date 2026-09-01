import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import type { Metric } from '../../api/types';
import { CompareCell } from './CompareCell';

afterEach(() => cleanup());

function metric<T>(value: T, overrides: Partial<Metric<T>> = {}): Metric<T> {
  return { value, confidence: 'high', source: 'harness-reported', note: undefined, ...overrides };
}

describe('CompareCell — D40 exactly two special treatments', () => {
  test('missing (harness does not report this field): "Not reported" text, stripe background, capability-absent title', () => {
    const view = render(
      <CompareCell field="cacheWrite" harness="claude-code" capabilities={['model']} />,
    );
    expect(screen.getByText('Not reported')).not.toBeNull();
    const el = view.container.querySelector('[data-compare-cell="missing"]');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('title')).toBe('Not provided by claude-code');
    // The stripe pattern is a Tailwind arbitrary-value class referencing a
    // token, never a literal hex.
    expect(el?.className).toContain('repeating-linear-gradient');
    expect(el?.className).toContain('var(--border)');
    expect(el?.className).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  test('missing (field absent this session, harness supports it): "Not reported" text, distinct title', () => {
    const view = render(
      <CompareCell
        field="cacheWrite"
        harness="claude-code"
        capabilities={['usage.cacheWrite']}
        displayName="Claude Code"
      />,
    );
    expect(screen.getByText('Not reported')).not.toBeNull();
    const el = view.container.querySelector('[data-compare-cell="missing"]');
    expect(el?.getAttribute('title')).toBe('Missing in this session');
  });

  test('derived (present, confidence !== high): amber text, note visible as text, distinguishable without color', () => {
    const view = render(
      <CompareCell
        field="uncachedInput"
        harness="codex"
        capabilities={['usage.perCall']}
        metric={metric(1234, { confidence: 'medium', note: 'derived from input − cached' })}
      />,
    );
    const el = view.container.querySelector('[data-compare-cell="derived"]');
    expect(el).not.toBeNull();
    expect(el?.className).toContain('var(--confidence-medium)');
    expect(el?.className).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    // The note is real, visible text content -- not only conveyed by color.
    expect(screen.getByText('derived from input − cached')).not.toBeNull();
    expect(screen.getByText('1.2k')).not.toBeNull();
    expect(el?.getAttribute('role')).toBe('note');
  });

  test('derived with no note falls back to a visible generic explanation, never a blank note line', () => {
    render(
      <CompareCell
        field="output"
        harness="codex"
        capabilities={['usage.perCall']}
        metric={metric(500, { confidence: 'low', note: undefined })}
      />,
    );
    expect(screen.getByText('Computed differently from a directly reported value.')).not.toBeNull();
  });

  test('normal (present, high confidence): delegates to MetricCell, no stripe, no amber', () => {
    const view = render(
      <CompareCell
        field="mode"
        harness="claude-code"
        capabilities={['mode']}
        metric={metric('plan')}
      />,
    );
    expect(screen.getByText('plan')).not.toBeNull();
    expect(view.container.querySelector('[data-compare-cell="missing"]')).toBeNull();
    expect(view.container.querySelector('[data-compare-cell="derived"]')).toBeNull();
  });

  test('the three treatments are distinguishable by text/role content alone, not merely by their color class', () => {
    const missing = render(<CompareCell field="cacheWrite" harness="codex" capabilities={[]} />);
    const missingText = missing.baseElement.textContent;
    cleanup();

    const derived = render(
      <CompareCell
        field="output"
        harness="codex"
        capabilities={['usage.perCall']}
        metric={metric(10, { confidence: 'medium', note: 'x' })}
      />,
    );
    const derivedText = derived.baseElement.textContent;
    cleanup();

    const normal = render(
      <CompareCell
        field="output"
        harness="codex"
        capabilities={['usage.perCall']}
        metric={metric(10)}
      />,
    );
    const normalText = normal.baseElement.textContent;

    expect(missingText).not.toBe(derivedText);
    expect(missingText).not.toBe(normalText);
    expect(derivedText).not.toBe(normalText);
  });

  test('a caller-supplied format overrides the derived formatter too', () => {
    render(
      <CompareCell
        field="output"
        harness="codex"
        capabilities={['usage.perCall']}
        metric={metric(10, { confidence: 'medium' })}
        format={(v) => `custom:${String(v)}`}
      />,
    );
    expect(screen.getByText('custom:10')).not.toBeNull();
  });
});
