import { describe, expect, test } from 'bun:test';
import { project } from '@runwire/core';
import { gentleShellAllowlist } from './allowlist';

type Rec = Record<string, unknown>;

// Pi 1.5.0 delta (docs/adapters/gentle-shell.md §7): the three metadata fields
// verified in live 4.7 records. Each test pairs the new field with a content
// hazard from the same record so "metadata in, content out" stays pinned.
describe('gentleShellAllowlist: Pi 1.5 metadata', () => {
  test('assistant rawStopReason survives while prompt and reasoning text stay out', () => {
    const out = project(
      {
        type: 'message',
        message: {
          role: 'assistant',
          rawStopReason: 'end_turn',
          content: [
            { type: 'text', text: 'RUNWIRE_CANARY_TEXT', thinking: 'RUNWIRE_CANARY_THINKING' },
          ],
        },
      },
      gentleShellAllowlist,
    ) as { message: Rec };

    expect(out.message.rawStopReason).toBe('end_turn');
    expect(out.message.content).toEqual([{ type: 'text' }]);
    expect(JSON.stringify(out)).not.toContain('RUNWIRE_CANARY');
  });

  test('cost.totalFromProvider survives on message usage and on entry-level usage', () => {
    const usage = { input: 1, output: 2, cost: { total: 0.5, totalFromProvider: true } };

    const message = project(
      { type: 'message', message: { role: 'assistant', usage } },
      gentleShellAllowlist,
    ) as { message: { usage: unknown } };
    expect(message.message.usage).toEqual(usage);

    const entry = project({ type: 'compaction', usage }, gentleShellAllowlist) as {
      usage: unknown;
    };
    expect(entry.usage).toEqual(usage);
  });

  test('custom_message.display survives while content and details stay unread', () => {
    const out = project(
      {
        type: 'custom_message',
        customType: 'gentle-pi.exploration-budget',
        display: true,
        content: 'RUNWIRE_CANARY_CONTENT',
        details: { note: 'RUNWIRE_CANARY_DETAILS' },
      },
      gentleShellAllowlist,
    ) as Rec;

    expect(out.display).toBe(true);
    expect(out.customType).toBe('gentle-pi.exploration-budget');
    expect(out.content).toBeUndefined();
    expect(out.details).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('RUNWIRE_CANARY');
  });

  test('session_info keeps entry presence but never its user-authored name', () => {
    const out = project(
      { type: 'session_info', name: 'RUNWIRE_CANARY_NAME' },
      gentleShellAllowlist,
    ) as Rec;

    expect(out).toEqual({ type: 'session_info' });
  });
});
