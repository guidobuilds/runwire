import { describe, expect, test } from 'bun:test';
import { project } from '@scout/core';
import { piAllowlist } from './allowlist';

type Rec = Record<string, unknown>;

describe('piAllowlist: presence-only idioms', () => {
  test('retainedTail keeps array presence but drops every element key (the [{}] regression pin)', () => {
    const out = project(
      { type: 'compaction', retainedTail: [{ content: 'CANARY', role: 'user' }] },
      piAllowlist,
    ) as Rec;
    expect(out.retainedTail).toEqual([{}]);
  });
});

describe('piAllowlist: content element projection', () => {
  test('content blocks keep only type/id/name', () => {
    const out = project(
      {
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 't1',
              name: 'read',
              arguments: { path: '/secret' },
              text: 'CANARY',
              thinking: 'CANARY',
              textSignature: 'CANARY',
              mimeType: 'image/png',
              data: 'Q0FOQVJZ',
            },
          ],
        },
      },
      piAllowlist,
    ) as { message: { content: Rec[] } };
    expect(out.message.content).toEqual([{ type: 'toolCall', id: 't1', name: 'read' }]);
  });
});

describe('piAllowlist: top-level content hazards are dropped', () => {
  test('session_info.name, label.label, custom.data, custom_message.content, summary drop; firstKeptEntry stays presence-only', () => {
    const out = project(
      {
        type: 'compaction',
        name: 'CANARY',
        label: 'CANARY',
        data: 'CANARY',
        content: ['CANARY'],
        summary: 'CANARY',
        details: 'CANARY',
        errorMessage: 'CANARY',
        firstKeptEntryId: 'kept-presence-only',
        firstKeptEntryIndex: 3,
      },
      piAllowlist,
    ) as Rec;

    expect(out.name).toBeUndefined();
    expect(out.label).toBeUndefined();
    expect(out.data).toBeUndefined();
    expect(out.content).toBeUndefined();
    expect(out.summary).toBeUndefined();
    expect(out.details).toBeUndefined();
    expect(out.errorMessage).toBeUndefined();
    expect('firstKeptEntryId' in out).toBe(true);
    expect('firstKeptEntryIndex' in out).toBe(true);
  });

  test('message.details / errorMessage / diagnostics are dropped', () => {
    const out = project(
      {
        type: 'message',
        message: {
          role: 'toolResult',
          details: { diff: 'CANARY', patch: 'CANARY' },
          errorMessage: 'CANARY',
          diagnostics: [{ message: 'CANARY' }],
        },
      },
      piAllowlist,
    ) as { message: Rec };
    expect(out.message.details).toBeUndefined();
    expect(out.message.errorMessage).toBeUndefined();
    expect(out.message.diagnostics).toBeUndefined();
  });
});

describe('piAllowlist: usage survives intact', () => {
  const usage = {
    input: 1,
    output: 2,
    cacheRead: 3,
    cacheWrite: 4,
    reasoning: 5,
    totalTokens: 15,
    cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 },
  };

  test('entry-level usage (compaction/branch_summary) keeps all allowlisted fields incl. cost', () => {
    const out = project({ type: 'compaction', usage }, piAllowlist) as { usage: unknown };
    expect(out.usage).toEqual(usage);
  });

  test('message-level usage keeps all allowlisted fields incl. cost', () => {
    const out = project(
      { type: 'message', message: { role: 'assistant', usage } },
      piAllowlist,
    ) as { message: { usage: unknown } };
    expect(out.message.usage).toEqual(usage);
  });
});
