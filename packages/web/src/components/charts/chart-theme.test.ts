import { describe, expect, test } from 'vitest';
import {
  CONFIDENCE_COLOR,
  CONFIDENCE_KEYS,
  CONFIDENCE_OPACITY,
  type ComputedStyleLike,
  HOVER_DIM_OPACITY,
  KIND_COLOR,
  KIND_KEYS,
  resolveToken,
  USAGE_COLOR,
  USAGE_KEYS,
} from './chart-theme';

describe('KIND_COLOR / CONFIDENCE_COLOR / USAGE_COLOR', () => {
  test('every kind key maps to its own var() reference, not a literal hex', () => {
    for (const key of KIND_KEYS) {
      expect(KIND_COLOR[key]).toBe(`var(--kind-${key})`);
      expect(KIND_COLOR[key]).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    }
    // 14 tokens (design.md §3 / f1-t3, 'skill' added for the Skill tool).
    expect(KIND_KEYS.length).toBe(14);
  });

  test('every confidence key maps to its own var() reference', () => {
    for (const key of CONFIDENCE_KEYS) {
      expect(CONFIDENCE_COLOR[key]).toBe(`var(--confidence-${key})`);
    }
  });

  test('every usage key maps to its own var() reference', () => {
    for (const key of USAGE_KEYS) {
      expect(USAGE_COLOR[key]).toBe(`var(--usage-${key})`);
    }
    expect(USAGE_KEYS.length).toBe(5);
  });
});

describe('CONFIDENCE_OPACITY', () => {
  test('high confidence is full opacity; medium/low are reduced (D36)', () => {
    expect(CONFIDENCE_OPACITY.high).toBe(1);
    expect(CONFIDENCE_OPACITY.medium).toBeLessThan(1);
    expect(CONFIDENCE_OPACITY.low).toBeLessThan(1);
  });
});

describe('HOVER_DIM_OPACITY', () => {
  test('is a plain numeric constant, distinct from both CONFIDENCE_OPACITY values (timeline-chart-usability f1-t1)', () => {
    expect(typeof HOVER_DIM_OPACITY).toBe('number');
    expect(HOVER_DIM_OPACITY).toBe(0.15);
    expect(HOVER_DIM_OPACITY).not.toBe(CONFIDENCE_OPACITY.high);
    expect(HOVER_DIM_OPACITY).not.toBe(CONFIDENCE_OPACITY.medium);
    expect(HOVER_DIM_OPACITY).not.toBe(CONFIDENCE_OPACITY.low);
    expect(HOVER_DIM_OPACITY).toBeLessThan(CONFIDENCE_OPACITY.low);
  });
});

describe('resolveToken', () => {
  test('reads a live custom property via the injected getComputed', () => {
    const fake: ComputedStyleLike = {
      getPropertyValue: (name) => (name === '--kind-model' ? '#7ea6ff' : ''),
    };
    const value = resolveToken('--kind-model', document.documentElement, () => fake);
    expect(value).toBe('#7ea6ff');
  });

  test('reads a real custom property injected into the document (happy-dom, no stylesheet import)', () => {
    // Confirmed empirically (build-log-f4.md): happy-dom's getComputedStyle
    // DOES resolve a custom property once one is actually present in the
    // document, via a <style> tag or an inline style -- the gap this test
    // guards against is Vitest not applying the *real* styles.css import
    // under test, covered by the fallback test below instead.
    const style = document.createElement('style');
    style.textContent = ':root { --probe-token: #123456; }';
    document.head.appendChild(style);
    try {
      const value = resolveToken('--probe-token');
      expect(value).toBe('#123456');
    } finally {
      style.remove();
    }
  });

  test('falls back to the static token map when the live lookup is empty (e.g. styles.css not applied under test)', () => {
    const empty: ComputedStyleLike = { getPropertyValue: () => '' };
    const value = resolveToken('--kind-model', document.documentElement, () => empty);
    expect(value).toBe('#3d6fd6');
  });

  test('an unknown var name with no live value and no fallback entry resolves to empty string, not undefined/throw', () => {
    const empty: ComputedStyleLike = { getPropertyValue: () => '' };
    const value = resolveToken('--not-a-real-token', document.documentElement, () => empty);
    expect(value).toBe('');
  });
});
