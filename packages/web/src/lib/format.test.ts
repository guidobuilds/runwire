import { describe, expect, test } from 'vitest';
import {
  formatDate,
  formatDuration,
  formatRelative,
  formatTokens,
  formatUsd,
  shortId,
} from './format';

describe('formatTokens', () => {
  test('formats thousands, millions, and zero', () => {
    expect(formatTokens(1234)).toBe('1.2k');
    expect(formatTokens(3200000)).toBe('3.2M');
    expect(formatTokens(0)).toBe('0');
  });

  test('leaves sub-thousand values as integers', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1)).toBe('1');
  });
});

describe('formatDuration', () => {
  test('renders minutes, hours with zero-padded minutes, and sub-minute', () => {
    expect(formatDuration(18 * 60_000)).toBe('18 min');
    expect(formatDuration(65 * 60_000)).toBe('1 h 05 min');
    expect(formatDuration(30_000)).toBe('< 1 min');
    expect(formatDuration(0)).toBe('< 1 min');
  });
});

describe('formatRelative', () => {
  const now = '2026-01-01T12:00:00.000Z';

  test('just now and hours ago', () => {
    expect(formatRelative('2026-01-01T12:00:00.000Z', now)).toBe('just now');
    expect(formatRelative('2026-01-01T11:59:30.000Z', now)).toBe('just now');
    expect(formatRelative('2026-01-01T10:00:00.000Z', now)).toBe('2 hours ago');
  });

  test('minutes and days', () => {
    expect(formatRelative('2026-01-01T11:55:00.000Z', now)).toBe('5 minutes ago');
    expect(formatRelative('2025-12-30T12:00:00.000Z', now)).toBe('2 days ago');
  });
});

describe('formatDate', () => {
  test('returns a locale short date-time including the year', () => {
    const out = formatDate('2026-01-15T13:04:00.000Z');
    expect(out.length).toBeGreaterThan(0);
    expect(out).toMatch(/26/);
  });
});

describe('formatUsd', () => {
  test('formats two decimal places with a dollar sign', () => {
    expect(formatUsd({ usd: 1.23 })).toBe('$1.23');
    expect(formatUsd({ usd: 0 })).toBe('$0.00');
    expect(formatUsd({ usd: 1.2 })).toBe('$1.20');
  });
});

describe('shortId', () => {
  test('drops the harness prefix and keeps the first 8 chars of the source id', () => {
    expect(shortId('fake:abcdef123456')).toBe('abcdef12');
    expect(shortId('claude-code:xyz')).toBe('xyz');
    expect(shortId('fake:root')).toBe('root');
  });

  test('treats ids without a colon as the source id', () => {
    expect(shortId('abcdefghij')).toBe('abcdefgh');
  });
});
