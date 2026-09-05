import { describe, expect, test } from 'bun:test';
import { parseMessageData, parseSessionRow } from './schema';

describe('parseSessionRow', () => {
  test('accepts a current session_v2 row', () => {
    const row = parseSessionRow({
      id: 'ses_a',
      project_id: 'p1',
      directory: '/home/u/proj',
      title: 'My session',
      time_created: 100,
      time_updated: 200,
      version: '0.0.0-beta',
    });
    expect(row).toBeDefined();
    expect(row?.id).toBe('ses_a');
    expect(row?.title).toBe('My session');
  });

  test('accepts a legacy session row (subset, no fork/time_suspended columns)', () => {
    const row = parseSessionRow({
      id: 'ses_b',
      project_id: 'p1',
      directory: '/home/u/proj',
      time_created: 100,
      time_updated: 200,
    });
    expect(row).toBeDefined();
    expect(row?.fork_session_id).toBeUndefined();
    expect(row?.time_suspended).toBeUndefined();
  });

  test('returns undefined for a bad shape (id not a string)', () => {
    expect(parseSessionRow({ id: 42, project_id: 'p1' })).toBeUndefined();
    expect(parseSessionRow(null)).toBeUndefined();
    expect(parseSessionRow('nope')).toBeUndefined();
  });
});

describe('parseMessageData', () => {
  test('accepts the current rich assistant shape', () => {
    const data = parseMessageData({
      time: { created: 100, completed: 200 },
      model: { id: 'gpt-5.6-sol' },
      tokens: { input: 10, output: 5, cache: { read: 2, write: 0 } },
      content: [{ type: 'tool', id: 't1', tool: 'read', state: { status: 'completed' } }],
    });
    expect(data).toBeDefined();
    expect(data?.model?.id).toBe('gpt-5.6-sol');
    expect(data?.tokens?.cache?.read).toBe(2);
  });

  test('accepts a legacy simple assistant shape (no tokens/cache)', () => {
    const data = parseMessageData({ time: { created: 100 }, model: { id: 'gpt-5.6-sol' } });
    expect(data).toBeDefined();
    expect(data?.tokens).toBeUndefined();
  });

  test('returns undefined for a bad shape (model not an object)', () => {
    expect(parseMessageData({ model: 'gpt-5.6-sol' })).toBeUndefined();
    expect(parseMessageData(null)).toBeUndefined();
    expect(parseMessageData([1, 2, 3])).toBeUndefined();
  });
});
