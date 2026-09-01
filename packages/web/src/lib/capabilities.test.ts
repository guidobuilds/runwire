import { describe, expect, test } from 'vitest';
import { absenceKind, type FieldKey, requiredCapabilities } from './capabilities';

describe('requiredCapabilities', () => {
  // Pins the usage/counts subset of this hand-kept map to its expected
  // values — any drift from the reducer's confidence-table requirements is a
  // review signal.
  test('usage/counts requiredCapabilities are pinned to their expected values', () => {
    const usageCounts: Record<
      Extract<
        FieldKey,
        | 'cacheWrite'
        | 'reasoningOutput'
        | 'uncachedInput'
        | 'cachedInput'
        | 'output'
        | 'totalInput'
        | 'apiCalls'
        | 'turns'
        | 'toolCalls'
        | 'compactions'
        | 'subagents'
      >,
      string[]
    > = {
      cacheWrite: ['usage.cacheWrite'],
      reasoningOutput: ['usage.reasoning'],
      uncachedInput: ['usage.perCall', 'usage.cumulative'],
      cachedInput: ['usage.perCall', 'usage.cumulative'],
      output: ['usage.perCall', 'usage.cumulative'],
      totalInput: ['usage.perCall', 'usage.cumulative'],
      apiCalls: ['usage.perCall'],
      turns: ['turns'],
      toolCalls: ['toolCalls'],
      compactions: ['compactions'],
      subagents: ['subagents'],
    };

    for (const [field, expected] of Object.entries(usageCounts)) {
      expect(requiredCapabilities(field as FieldKey)).toEqual(expected);
    }
  });

  test('maps summary fields onto the matching capability', () => {
    expect(requiredCapabilities('startedAt')).toEqual(['timing']);
    expect(requiredCapabilities('endedAt')).toEqual(['timing']);
    expect(requiredCapabilities('durationMs')).toEqual(['timing']);
    expect(requiredCapabilities('model')).toEqual(['model']);
    expect(requiredCapabilities('mode')).toEqual(['mode']);
    expect(requiredCapabilities('effort')).toEqual(['effort']);
    expect(requiredCapabilities('cost')).toEqual(['cost']);
    expect(requiredCapabilities('harnessVersion')).toEqual(['version']);
    expect(requiredCapabilities('title')).toEqual(['title']);
    expect(requiredCapabilities('git')).toEqual(['git']);
  });
});

describe('absenceKind', () => {
  test('not-provided when a non-empty list shares no required capability', () => {
    expect(absenceKind('cacheWrite', ['usage.perCall'])).toBe('not-provided');
    expect(absenceKind('git', ['timing', 'model'])).toBe('not-provided');
  });

  test('missing when the list includes a required capability', () => {
    expect(absenceKind('cacheWrite', ['usage.cacheWrite'])).toBe('missing');
    expect(absenceKind('output', ['usage.cumulative'])).toBe('missing');
    expect(absenceKind('output', ['usage.perCall'])).toBe('missing');
  });

  test('missing when capabilities are undefined or empty', () => {
    expect(absenceKind('cacheWrite', undefined)).toBe('missing');
    expect(absenceKind('cacheWrite', [])).toBe('missing');
  });
});
