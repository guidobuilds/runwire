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

  test('a bundle with a tool step carrying skillName validates (the strict schema admits the new field, not strips it)', () => {
    const b = validBundle();
    (b.steps as unknown[]).push({
      sessionId: 'fake:s1',
      seq: 0,
      kind: 'tool',
      toolCategory: 'skill',
      toolName: 'Skill',
      callId: 't1',
      skillName: 'my-skill',
    });
    const r = validateBundle(b);
    expect(r.ok).toBe(true);
  });

  test('a step carrying an unknown key still fails loudly under the strict StepSchema (the .strict() boundary is not weakened)', () => {
    const b = validBundle();
    (b.steps as unknown[]).push({
      sessionId: 'fake:s1',
      seq: 0,
      kind: 'tool',
      toolCategory: 'skill',
      unknownSkillKey: 'SECRET',
    });
    const r = validateBundle(b);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.issues.some((i) => i.includes('unknownSkillKey'))).toBe(true);
  });
});

describe('StepSchema: optional MCP identity (mcpServer/mcpTool)', () => {
  test('a tool step of category mcp carrying both mcpServer and mcpTool validates', () => {
    const b = validBundle();
    (b.steps as unknown[]).push({
      sessionId: 'fake:s1',
      seq: 0,
      kind: 'tool',
      toolCategory: 'mcp',
      toolName: 'mcp__plugin_engram_engram__mem_save',
      mcpServer: 'plugin_engram_engram',
      mcpTool: 'mem_save',
    });
    expect(validateBundle(b).ok).toBe(true);
  });

  test('a tool step of category mcp without identity still validates (unproven name keeps raw only)', () => {
    const b = validBundle();
    (b.steps as unknown[]).push({
      sessionId: 'fake:s1',
      seq: 0,
      kind: 'tool',
      toolCategory: 'mcp',
      toolName: 'mcp__server__tool__extra',
    });
    expect(validateBundle(b).ok).toBe(true);
  });

  test('the fields are admitted (not stripped) and round-trip through validateBundle', () => {
    const b = validBundle();
    (b.steps as unknown[]).push({
      sessionId: 'fake:s1',
      seq: 0,
      kind: 'tool',
      toolCategory: 'mcp',
      toolName: 'mcp__server__tool',
      mcpServer: 'server',
      mcpTool: 'tool',
    });
    const r = validateBundle(b);
    if (!r.ok) throw new Error('unreachable');
    expect(r.bundle.steps[0]).toMatchObject({ mcpServer: 'server', mcpTool: 'tool' });
  });

  test('a non-tool step carrying identity fails', () => {
    const b = validBundle();
    (b.steps as unknown[]).push({
      sessionId: 'fake:s1',
      seq: 0,
      kind: 'call',
      mcpServer: 'server',
      mcpTool: 'tool',
    });
    expect(validateBundle(b).ok).toBe(false);
  });

  test('a tool step of another category carrying identity fails', () => {
    const b = validBundle();
    (b.steps as unknown[]).push({
      sessionId: 'fake:s1',
      seq: 0,
      kind: 'tool',
      toolCategory: 'read',
      toolName: 'Read',
      mcpServer: 'server',
      mcpTool: 'tool',
    });
    expect(validateBundle(b).ok).toBe(false);
  });

  test('an unpaired identity (only one of the pair) fails', () => {
    const b = validBundle();
    (b.steps as unknown[]).push({
      sessionId: 'fake:s1',
      seq: 0,
      kind: 'tool',
      toolCategory: 'mcp',
      toolName: 'mcp__server__tool',
      mcpServer: 'server',
    });
    expect(validateBundle(b).ok).toBe(false);

    const b2 = validBundle();
    (b2.steps as unknown[]).push({
      sessionId: 'fake:s1',
      seq: 0,
      kind: 'tool',
      toolCategory: 'mcp',
      toolName: 'mcp__server__tool',
      mcpTool: 'tool',
    });
    expect(validateBundle(b2).ok).toBe(false);
  });

  test('an empty identity segment fails (a proven identity is never empty)', () => {
    const b = validBundle();
    (b.steps as unknown[]).push({
      sessionId: 'fake:s1',
      seq: 0,
      kind: 'tool',
      toolCategory: 'mcp',
      mcpServer: '',
      mcpTool: 'tool',
    });
    expect(validateBundle(b).ok).toBe(false);
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
