import { describe, expect, test } from 'bun:test';
import { project } from '@scout/core';
import { opencodeAllowlist, sessionRowAllowlist } from './allowlist';

describe('opencodeAllowlist (message data projection)', () => {
  const raw = {
    type: 'assistant',
    role: 'assistant',
    model: { id: 'gpt-5.6-sol', providerID: 'openai' },
    time: { created: 100, completed: 200 },
    tokens: { input: 10, output: 5, reasoning: 1, cache: { read: 2, write: 0 } },
    content: [
      { type: 'text', text: 'SECRET_TEXT' },
      {
        type: 'reasoning',
        text: 'SECRET_REASONING',
        state: { reasoningEncryptedContent: 'SECRET_ENCRYPTED' },
      },
      {
        type: 'tool',
        id: 't1',
        tool: 'read',
        state: { status: 'completed', input: { secret: 'io' }, content: 'SECRET_CONTENT' },
      },
    ],
    snapshot: { start: 'a', files: [] },
    summary: 'SECRET_SUMMARY',
    recent: 'SECRET_RECENT',
    metadata: { secret: true },
    reason: 'auto',
  };

  test('keeps metadata fields (model/time/tokens/reason/tool-name/status)', () => {
    const out = project(raw, opencodeAllowlist) as Record<string, unknown>;
    expect(out.type).toBe('assistant');
    expect((out.model as Record<string, unknown>).id).toBe('gpt-5.6-sol');
    expect((out.tokens as Record<string, unknown>).input).toBe(10);
    expect((out as Record<string, unknown>).reason).toBe('auto');
    const content = out.content as Record<string, unknown>[];
    expect(content[2]).toEqual({
      type: 'tool',
      id: 't1',
      tool: 'read',
      state: { status: 'completed' },
    });
  });

  test('drops content: text, reasoning, state.input/content, snapshot, summary, recent, metadata', () => {
    const out = project(raw, opencodeAllowlist) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toContain('SECRET_TEXT');
    expect(JSON.stringify(out)).not.toContain('SECRET_REASONING');
    expect(JSON.stringify(out)).not.toContain('SECRET_ENCRYPTED');
    expect(JSON.stringify(out)).not.toContain('SECRET_CONTENT');
    expect(JSON.stringify(out)).not.toContain('SECRET_SUMMARY');
    expect(JSON.stringify(out)).not.toContain('SECRET_RECENT');
    expect('snapshot' in out).toBe(false);
    expect('summary' in out).toBe(false);
    expect('recent' in out).toBe(false);
    expect('metadata' in out).toBe(false);
  });

  test('a canary sentinel in content never survives the projection', () => {
    const hostile = {
      ...raw,
      content: [
        { type: 'text', text: 'SCOUT_CANARY_1' },
        { type: 'tool', id: 't1', tool: 'read', state: { status: 'completed' } },
      ],
    };
    const out = project(hostile, opencodeAllowlist);
    expect(JSON.stringify(out)).not.toContain('SCOUT_CANARY_');
  });
});

describe('sessionRowAllowlist', () => {
  test('keeps metadata columns and drops content-ish columns', () => {
    const row = {
      id: 'ses_a',
      project_id: 'p1',
      directory: '/home/u/proj',
      title: 't',
      version: '0.0.0',
      summary_diffs: 'SECRET_DIFFS',
      metadata: { secret: true },
      share_url: 'SECRET_URL',
      revert: 'SECRET_REVERT',
    };
    const out = project(row, sessionRowAllowlist) as Record<string, unknown>;
    expect(out.id).toBe('ses_a');
    expect(out.directory).toBe('/home/u/proj');
    expect('summary_diffs' in out).toBe(false);
    expect('metadata' in out).toBe(false);
    expect('share_url' in out).toBe(false);
    expect('revert' in out).toBe(false);
  });
});
