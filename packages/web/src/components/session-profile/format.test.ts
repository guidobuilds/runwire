import { describe, expect, it } from 'vitest';
import {
  FIELD_LABELS,
  formatCompact,
  formatCurrency,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatReported,
  formatTime,
  readableAgent,
  readableModel,
  TOKEN_FIELDS,
} from './format';

describe('formatCompact', () => {
  it('renders compact notation with at most 1 fraction digit', () => {
    expect(formatCompact(1200)).toBe('1.2K');
    expect(formatCompact(950)).toBe('950');
  });
});

describe('formatNumber', () => {
  it('renders a plain grouped number', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatNumber(0)).toBe('0');
  });
});

describe('formatReported', () => {
  it('renders "Not reported" for null, else the plain number', () => {
    expect(formatReported(null)).toBe('Not reported');
    expect(formatReported(0)).toBe('0');
    expect(formatReported(42)).toBe('42');
  });
});

describe('formatDateTime', () => {
  it('renders — for null/invalid, else a locale date+time', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('not-a-date')).toBe('—');
    expect(formatDateTime('2026-09-01T10:00:00.000Z')).not.toBe('—');
  });
});

describe('formatTime', () => {
  it('renders a fixed HH:MM:SS shape, — for null/invalid', () => {
    expect(formatTime(null)).toBe('—');
    expect(formatTime('garbage')).toBe('—');
    expect(formatTime('2026-09-01T10:05:09.000Z')).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

describe('formatDuration', () => {
  it('renders —/Ns/Nm Ns/Nh Nm', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(125_000)).toBe('2m 5s');
    expect(formatDuration(3_725_000)).toBe('1h 2m');
  });
});

describe('formatCurrency', () => {
  it('renders USD, — for null', () => {
    expect(formatCurrency(null)).toBe('—');
    expect(formatCurrency(0.42)).toContain('0.42');
  });
});

describe('readableModel', () => {
  it('maps reserved buckets, passes through everything else', () => {
    expect(readableModel('unknown')).toBe('Unknown model');
    expect(readableModel('other')).toBe('Other models');
    expect(readableModel('claude-sonnet-5')).toBe('claude-sonnet-5');
  });
});

describe('readableAgent', () => {
  it('title-cases kebab/snake slugs', () => {
    expect(readableAgent('general-purpose')).toBe('General Purpose');
    expect(readableAgent('main')).toBe('Main');
    expect(readableAgent('forge_worker_leaf')).toBe('Forge Worker Leaf');
  });
});

describe('FIELD_LABELS / TOKEN_FIELDS', () => {
  it('covers every token field with a human label', () => {
    expect(TOKEN_FIELDS).toHaveLength(5);
    for (const field of TOKEN_FIELDS) {
      expect(FIELD_LABELS[field]).toBeTruthy();
    }
  });
});
