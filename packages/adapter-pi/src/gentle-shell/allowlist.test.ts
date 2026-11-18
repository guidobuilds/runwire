import { describe, expect, test } from 'bun:test';
import { project } from '@runwire/core';
import { gentleShellAllowlist } from './allowlist';

type Rec = Record<string, unknown>;

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

const PUBLISHED_STATE = 'gentle-agents.published-state';
const REVIEW_RECEIPT = 'gentle-pi.review-reminder-receipt/v1';

describe('gentleShellAllowlist: 4.x custom metadata', () => {
  test('published-state keeps a bounded presence marker and never its state prose', () => {
    const out = project(
      {
        type: 'custom',
        customType: PUBLISHED_STATE,
        data: {
          schema: 3,
          sessionId: 'b1',
          recordedAt: '2026-01-11T00:00:00.000Z',
          cwd: '/project',
          source: 'subagent',
          ownerReply: 'RUNWIRE_CANARY_OWNER_REPLY',
          authority: 'orchestrator',
          state: { summary: 'RUNWIRE_CANARY_STATE' },
          aliases: {
            initialAlias: 'RUNWIRE_CANARY_ALIAS_A',
            currentAlias: 'RUNWIRE_CANARY_ALIAS_B',
          },
        },
      },
      gentleShellAllowlist,
    ) as Rec;

    expect(out).toEqual({
      type: 'custom',
      customType: PUBLISHED_STATE,
      data: {
        schema: 3,
        recordedAt: '2026-01-11T00:00:00.000Z',
        authority: 'orchestrator',
        source: 'subagent',
        aliases: {},
      },
    });
    expect(JSON.stringify(out)).not.toContain('RUNWIRE_CANARY');
  });

  test('review-reminder receipt keeps only the spawn identity discover corroborates', () => {
    const out = project(
      {
        type: 'custom',
        customType: REVIEW_RECEIPT,
        data: {
          kind: 'review',
          sessionId: 'b1',
          root: '/project',
          id: 'r1',
          source: 'subagent',
          toolName: 'subagent_run',
          toolCallId: 'tc9',
          taskId: 'task-9',
          writerModelId: 'RUNWIRE_CANARY_MODEL',
          writerEffort: 'high',
        },
      },
      gentleShellAllowlist,
    ) as Rec;

    expect(out.data).toEqual({ source: 'subagent', toolCallId: 'tc9', taskId: 'task-9' });
    expect(JSON.stringify(out)).not.toContain('RUNWIRE_CANARY');
  });

  test('every other observed extension customType stays presence-only', () => {
    const driven = project(
      {
        type: 'custom',
        customType: 'synthetic-extension',
        data: { schema: 1, recordedAt: '2026-01-11T00:00:00.000Z' },
      },
      gentleShellAllowlist,
    ) as Rec;
    expect(driven.data).toEqual({ schema: 1, recordedAt: '2026-01-11T00:00:00.000Z' });
    const hazard = {
      title: 'RUNWIRE_CANARY_TITLE',
      text: 'RUNWIRE_CANARY_TEXT',
      prompt: 'RUNWIRE_CANARY_PROMPT',
      result: 'RUNWIRE_CANARY_RESULT',
      before: { content: 'RUNWIRE_CANARY_BEFORE' },
      after: { content: 'RUNWIRE_CANARY_AFTER' },
    };
    for (const customType of [
      'gentle-pi.session-worktree/v1',
      'gentle-pi.session-change/v1',
      'gentle-agents.stale-result',
      'gentle-agents.result',
      'gentle-agents.message',
      'gentle-todo-state',
    ]) {
      const out = project(
        { type: 'custom', customType, data: hazard },
        gentleShellAllowlist,
      ) as Rec;
      expect(out, customType).toEqual({ type: 'custom', customType, data: {} });
      expect(JSON.stringify(out), customType).not.toContain('RUNWIRE_CANARY');
    }

    const budget = project(
      {
        type: 'custom_message',
        customType: 'gentle-pi.exploration-budget',
        display: true,
        content: 'RUNWIRE_CANARY_CONTENT',
        details: hazard,
      },
      gentleShellAllowlist,
    ) as Rec;
    expect(budget).toEqual({
      type: 'custom_message',
      customType: 'gentle-pi.exploration-budget',
      display: true,
    });
    expect(JSON.stringify(budget)).not.toContain('RUNWIRE_CANARY');
  });
});
