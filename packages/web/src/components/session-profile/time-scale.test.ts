import { describe, expect, test } from 'vitest';
import { buildTimeDomain, relativeLabel, tickFormatter, toMs } from './time-scale';

describe('toMs', () => {
  test('parses a valid ISO timestamp', () => {
    expect(toMs('2026-09-01T10:00:00.000Z')).toBe(Date.parse('2026-09-01T10:00:00.000Z'));
  });

  test('returns null for null input', () => {
    expect(toMs(null)).toBeNull();
  });

  test('returns null for an unparsable string, never NaN', () => {
    expect(toMs('not-a-date')).toBeNull();
  });
});

describe('buildTimeDomain', () => {
  test('returns null when nothing is usable', () => {
    expect(buildTimeDomain([{ start: null, end: null }])).toBeNull();
    expect(buildTimeDomain([])).toBeNull();
  });

  test('spans the min start and max end across rows', () => {
    const domain = buildTimeDomain([
      { start: '2026-09-01T10:00:00.000Z', end: '2026-09-01T10:10:00.000Z' },
      { start: '2026-09-01T10:05:00.000Z', end: '2026-09-01T10:20:00.000Z' },
    ]);
    expect(domain).toEqual({
      start: Date.parse('2026-09-01T10:00:00.000Z'),
      end: Date.parse('2026-09-01T10:20:00.000Z'),
    });
  });

  test('an open-ended row (endedAt null) still pushes the domain end to its own start', () => {
    const domain = buildTimeDomain([
      { start: '2026-09-01T10:00:00.000Z', end: '2026-09-01T10:05:00.000Z' },
      { start: '2026-09-01T10:20:00.000Z', end: null },
    ]);
    expect(domain).toEqual({
      start: Date.parse('2026-09-01T10:00:00.000Z'),
      end: Date.parse('2026-09-01T10:20:00.000Z'),
    });
  });

  test('a row missing both bounds contributes nothing (never fabricates)', () => {
    const domain = buildTimeDomain([
      { start: '2026-09-01T10:00:00.000Z', end: '2026-09-01T10:05:00.000Z' },
      { start: null, end: null },
    ]);
    expect(domain).toEqual({
      start: Date.parse('2026-09-01T10:00:00.000Z'),
      end: Date.parse('2026-09-01T10:05:00.000Z'),
    });
  });
});

describe('tickFormatter', () => {
  test('uses HH:MM for spans of an hour or more', () => {
    const domain = {
      start: Date.parse('2026-09-01T10:00:00.000Z'),
      end: Date.parse('2026-09-01T12:00:00.000Z'),
    };
    const format = tickFormatter(domain);
    const label = format(Date.parse('2026-09-01T10:30:00.000Z'));
    expect(label).toMatch(/^\d{2}:\d{2}$/);
  });

  test('uses HH:MM:SS for spans under an hour', () => {
    const domain = {
      start: Date.parse('2026-09-01T10:00:00.000Z'),
      end: Date.parse('2026-09-01T10:05:00.000Z'),
    };
    const format = tickFormatter(domain);
    const label = format(Date.parse('2026-09-01T10:01:30.000Z'));
    expect(label).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

describe('relativeLabel', () => {
  const domainStart = Date.parse('2026-09-01T10:00:00.000Z');

  test('formats minutes and seconds', () => {
    expect(relativeLabel(domainStart + 3 * 60_000 + 12_000, domainStart)).toBe('+3m 12s');
  });

  test('formats hours and minutes once past an hour', () => {
    expect(relativeLabel(domainStart + 60 * 60_000 + 4 * 60_000, domainStart)).toBe('+1h 04m');
  });

  test('clamps a negative offset to zero rather than showing a negative label', () => {
    expect(relativeLabel(domainStart - 5_000, domainStart)).toBe('+0m 00s');
  });
});
