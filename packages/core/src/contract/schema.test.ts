import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { SessionBundleSchema, validateBundle } from './schema';

function validBundle() {
  return {
    project: { key: 'k', name: 'n', identity: 'cwd' as const },
    session: {
      id: 'fake:s1',
      harnessId: 'fake',
      projectKey: 'k',
      depth: 0,
      sourcePath: '/fake/s1.jsonl',
      sourceSize: 10,
      sourceMtime: 1,
    },
    steps: [] as unknown[],
    diagnostics: [] as unknown[],
  };
}

describe('validateBundle', () => {
  test('accepts a minimal valid bundle', () => {
    const r = validateBundle(validBundle());
    expect(r.ok).toBe(true);
  });

  test('rejects negative token counts', () => {
    const b = validBundle();
    (b.session as Record<string, unknown>).output = -1;
    const r = validateBundle(b);
    expect(r.ok).toBe(false);
  });

  test('rejects non-integer token counts', () => {
    const b = validBundle();
    (b.session as Record<string, unknown>).output = 1.5;
    const r = validateBundle(b);
    expect(r.ok).toBe(false);
  });

  test('an extra field whose value is a secret yields an issue naming the key, never the value', () => {
    const b = validBundle();
    (b.session as Record<string, unknown>).secretField = 'SECRET';
    const r = validateBundle(b);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    const joined = r.issues.join(' | ');
    expect(joined).toContain('secretField');
    expect(joined).not.toContain('SECRET');
  });

  test('a redacted xxxx timestamp fails with invalid_format, not silently passes', () => {
    const b = validBundle();
    (b.session as Record<string, unknown>).startedAt = 'xxxxxxxxxxxxxxxxxxxxxxxx';
    const r = validateBundle(b);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.issues.some((i) => i.includes('invalid_format'))).toBe(true);
  });

  test('a real ISO timestamp with an offset (not Z) is rejected', () => {
    const b = validBundle();
    (b.session as Record<string, unknown>).startedAt = '2026-09-04T10:30:00+02:00';
    const r = validateBundle(b);
    expect(r.ok).toBe(false);
  });

  test('a real ISO timestamp with millis and Z is accepted', () => {
    const b = validBundle();
    (b.session as Record<string, unknown>).startedAt = '2026-09-04T10:30:00.123Z';
    const r = validateBundle(b);
    expect(r.ok).toBe(true);
  });

  test('unrecognized_keys issue names every offending key when there are several', () => {
    const b = validBundle();
    (b.project as Record<string, unknown>).extra1 = 'v1';
    (b.project as Record<string, unknown>).extra2 = 'v2';
    const r = validateBundle(b);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    const joined = r.issues.join(' | ');
    expect(joined).toContain('extra1');
    expect(joined).toContain('extra2');
  });

  test('each issue is formatted as "path: code"', () => {
    const b = validBundle();
    (b.session as Record<string, unknown>).depth = -1;
    const r = validateBundle(b);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.issues.some((i) => /^session\.depth: /.test(i))).toBe(true);
  });

  test('diagnostics over 200 chars or with a newline are rejected', () => {
    const b = validBundle();
    (b.diagnostics as unknown[]).push({ level: 'info', code: 'x', message: 'a'.repeat(201) });
    expect(validateBundle(b).ok).toBe(false);

    const b2 = validBundle();
    (b2.diagnostics as unknown[]).push({ level: 'info', code: 'x', message: 'line1\nline2' });
    expect(validateBundle(b2).ok).toBe(false);
  });
});

describe('D21 scope: default z.object stripping vs .strict()', () => {
  test('a bare z.object silently strips an unknown key by default (documents the D21-vs-bundle distinction)', () => {
    const Loose = z.object({ a: z.string() });
    const r = Loose.safeParse({ a: 'x', unknownKey: 'SECRET' });
    expect(r.success).toBe(true);
    expect(r.success && 'unknownKey' in r.data).toBe(false);
  });

  test('the bundle schema does NOT silently strip - unknown keys are loud', () => {
    const b = validBundle();
    (b.session as Record<string, unknown>).unknownKey = 'SECRET';
    const r = SessionBundleSchema.safeParse(b);
    expect(r.success).toBe(false);
  });
});
