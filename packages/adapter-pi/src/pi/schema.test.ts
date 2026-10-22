import { describe, expect, test } from 'bun:test';
import { piRecordSchema } from './schema';

const COST = { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 };
const USAGE = {
  input: 10,
  output: 20,
  cacheRead: 30,
  cacheWrite: 40,
  reasoning: 5,
  totalTokens: 100,
  cost: COST,
};

describe('piRecordSchema: realistic projected records parse', () => {
  test('session header', () => {
    const r = piRecordSchema.safeParse({
      type: 'session',
      version: 3,
      id: 'a1000000-0000-7000-8000-000000000001',
      timestamp: '2026-01-01T00:00:00.000Z',
      cwd: '/home/u/pi',
      parentSession: '/home/u/pi/.pi/agent/sessions/x/2026-01-01_99000000.jsonl',
    });
    expect(r.success).toBe(true);
  });

  test('assistant message with usage incl. cost', () => {
    const r = piRecordSchema.safeParse({
      type: 'message',
      id: 'abc12345',
      parentId: null,
      timestamp: '2026-01-01T00:00:01.000Z',
      message: {
        role: 'assistant',
        api: 'anthropic',
        provider: 'anthropic',
        model: 'm-a',
        responseModel: 'm-a',
        responseId: 'resp1',
        providerThinkingLevel: 'medium',
        stopReason: 'toolUse',
        timestamp: 1767225601000,
        usage: USAGE,
        content: [{ type: 'toolCall', id: 't1', name: 'read' }],
      },
    });
    expect(r.success).toBe(true);
  });

  test('toolResult message with usage + isError', () => {
    const r = piRecordSchema.safeParse({
      type: 'message',
      timestamp: '2026-01-01T00:00:02.000Z',
      message: {
        role: 'toolResult',
        toolCallId: 't1',
        toolName: 'read',
        isError: true,
        timestamp: 1767225602000,
        usage: USAGE,
      },
    });
    expect(r.success).toBe(true);
  });

  test('compaction with tokensBefore/fromHook/usage/retainedTail [{}]', () => {
    const r = piRecordSchema.safeParse({
      type: 'compaction',
      timestamp: '2026-01-01T00:00:03.000Z',
      tokensBefore: 1234,
      fromHook: true,
      usage: USAGE,
      retainedTail: [{}],
    });
    expect(r.success).toBe(true);
  });

  test('model_change', () => {
    const r = piRecordSchema.safeParse({
      type: 'model_change',
      timestamp: '2026-01-01T00:00:04.000Z',
      provider: 'openai',
      modelId: 'gpt-x',
    });
    expect(r.success).toBe(true);
  });

  test('thinking_level_change', () => {
    const r = piRecordSchema.safeParse({
      type: 'thinking_level_change',
      timestamp: '2026-01-01T00:00:05.000Z',
      thinkingLevel: 'high',
    });
    expect(r.success).toBe(true);
  });

  test('empty-ish presence-only entries', () => {
    for (const type of ['label', 'session_info', 'custom', 'custom_message']) {
      const r = piRecordSchema.safeParse({ type, timestamp: '2026-01-01T00:00:06.000Z' });
      expect(r.success).toBe(true);
    }
  });
});

describe('piRecordSchema: type mismatches fail', () => {
  test('a usage.input of type string fails', () => {
    const r = piRecordSchema.safeParse({ usage: { input: 'not-a-number' } });
    expect(r.success).toBe(false);
  });

  test('a message.timestamp of type string fails (it is epoch ms, a number)', () => {
    const r = piRecordSchema.safeParse({ message: { timestamp: 'not-ms' } });
    expect(r.success).toBe(false);
  });
});
