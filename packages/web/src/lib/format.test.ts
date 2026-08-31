import { describe, expect, test } from 'vitest';
import {
  formatDate,
  formatDuration,
  formatGit,
  formatRelative,
  formatTokens,
  formatUnknownValue,
  formatUsd,
  shortCommit,
  shortId,
  UNFORMATTED,
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

describe('formatGit', () => {
  test('joins the reported parts, shortening the commit', () => {
    expect(formatGit({ repoName: 'scout', branch: 'main', commit: 'a1b2c3d4e5f60718' })).toBe(
      'scout · main · a1b2c3d',
    );
  });

  test('omits the parts the harness did not report', () => {
    expect(formatGit({ branch: 'feature/x' })).toBe('feature/x');
    expect(formatGit({ repoName: 'scout', commit: 'abcdef0123' })).toBe('scout · abcdef0');
  });

  test('an empty or blank object yields the empty string', () => {
    expect(formatGit({})).toBe('');
    expect(formatGit({ branch: '  ' })).toBe('');
  });

  test('shortCommit keeps seven characters', () => {
    expect(shortCommit('a1b2c3d4e5f60718')).toBe('a1b2c3d');
    expect(shortCommit('abc')).toBe('abc');
  });
});

describe('formatUnknownValue', () => {
  // The whole point: this function replaces `String(value)`, which renders
  // `[object Object]` for every non-primitive (BL-1).
  test('never produces [object Object]', () => {
    for (const value of [{}, { a: 1 }, [1, 2], new Date(0), { nested: { deep: true } }]) {
      expect(formatUnknownValue(value)).not.toContain('[object Object]');
    }
  });

  test('primitives render as themselves', () => {
    expect(formatUnknownValue('main')).toBe('main');
    expect(formatUnknownValue(42)).toBe('42');
    expect(formatUnknownValue(true)).toBe('true');
    expect(formatUnknownValue(10n)).toBe('10');
  });

  test('structured values render as compact JSON', () => {
    expect(formatUnknownValue({ a: 1, b: 'x' })).toBe('{"a":1,"b":"x"}');
    expect(formatUnknownValue([{ a: 1 }, 2])).toBe('[{"a":1},2]');
  });

  test('values JSON cannot describe degrade to the on-screen marker', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(formatUnknownValue(cyclic)).toBe(UNFORMATTED);
    expect(formatUnknownValue(undefined)).toBe(UNFORMATTED);
    expect(formatUnknownValue(null)).toBe(UNFORMATTED);
    expect(formatUnknownValue({})).toBe(UNFORMATTED);
    expect(formatUnknownValue([])).toBe(UNFORMATTED);
    expect(formatUnknownValue(() => 1)).toBe(UNFORMATTED);
    expect(UNFORMATTED).toBe('(unformatted)');
  });
});
